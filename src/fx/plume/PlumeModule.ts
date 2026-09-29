// THE ROCKET PLUME: 33 Raptor 3 methalox jets merging into one column, from the engine plane
// (anchors.vehicleBase) down through the OLM deck opening to the deflector (anchors.plumeImpact).
// OWNER: plume module (src/fx/plume/**).
//
// Frame graph step 2 (contracts.ts): the plume renders its OWN scene into its OWN HalfFloat RGBA
// target, after the opaque RenderPass and before the volume composite:
//   rgb = premultiplied additive emission (linear HDR). Tuned to the reference photo under AgX:
//         column top ≈ 5-8, merged column ≈ 8-15 with fibres to ~25, deflector base ≈ 30.
//         (The contract's rough 20-60 would clip the whole column flat white; the photo's column
//         is NOT clipped: display 204-249. look.intensity is the single scale knob.)
//   a   = luminance-weighted mean view distance of that emission along the ray (m); 0 = no plume.
//         For a side view this is the distance to the jet axis point closest to the ray; for rays
//         running along the axis it stays meaningful where "closest point" is not.
// It occludes manually against ctx.targets.sceneDepth (perspective depth 0..1).
//
// Technique: one convex BackSide proxy (capped frustum) per plume, so every covered pixel is shaded
// exactly once (NoBlending, cleared to 0). The fragment shader intersects the ray with the analytic
// frustum, clips it at the opaque depth and raymarches an emission volume in two segments:
//   near field (s < 26 m): 33 individual jets (engine-layout.ts positions), each with a translucent
//     violet-blue envelope, a hot core and Mach diamonds (shock-cell spacing L_s = 1.3·D·√(M²−1)
//     ≈ 6.2 m ≈ 5.2 D): bright reheated knots over the dimmer expanded core, fading over 3-5 cells
//     and averaging out to a gentle axial modulation once unresolved. Only the 2 nearest engines
//     per ring (+ the 3 centre engines when near the axis) are evaluated per sample;
//   far field: the merged column, pink-white chemiluminescent core with flow-aligned streaks, an
//     orange afterburning mixing layer, and a yellow-white brightening toward the deflector.
// Turbulence is a baked tileable 3D noise texture (noise3d.ts), frozen unless globals.uDrift = 1.
//
// It also sets globals.uPlumeLight / uPlumeAxisA / uPlumeAxisB, the plume's line light
// (src/core/material-hooks.ts applies it to every lit material).
import * as THREE from 'three';
import type { AppContext, Hotspot, LightingPreset, Module, QualitySettings } from '../../contracts.ts';
import common from '../../shaders/common.glsl?raw';
import vert from './plume.vert.glsl?raw';
import frag from './plume.frag.glsl?raw';
import { bakeNoise3D } from './noise3d.ts';
import {
  BOUND_SPREAD, BOUND_TOP_R, COLOURS, COLUMN_R0, COLUMN_SPREAD, EXIT_D, EXIT_DROP, JET_CORE_LENGTH,
  JET_NECK, JET_SPREAD, KELVIN, LIGHT_COLOUR, LIGHT_INTENSITY, NEAR_FIELD_END, PLUME_QUALITY,
  SHOCK_CELL_LENGTH, engineRings,
} from './plume-params.ts';

const DEG = Math.PI / 180;
const RADIAL_SEGMENTS = 40;

/** Tunable look parameters (exposed for a debug GUI; defaults match the reference photo). */
export interface PlumeLook {
  intensity: number;      // global emission multiplier
  envelope: number;       // near-field jet envelope radiance (per metre)
  core: number;           // near-field jet core radiance (per metre)
  diamondAmp: number;     // Mach-diamond knot gain (bright shock-heated knots over a dimmer core)
  column: number;         // merged-column core radiance (per metre)
  sheath: number;         // afterburning mixing-layer radiance (per metre)
  base: number;           // extra brightening toward the ground impingement
  lightIntensity: number; // plume line-light intensity (before preset.plumeLightScale)
}

export const DEFAULT_LOOK: PlumeLook = {
  intensity: 1.0,
  envelope: 0.5,
  core: 22,
  diamondAmp: 1.5,
  column: 4.1,
  sheath: 2.0,
  base: 1.6,
  lightIntensity: LIGHT_INTENSITY,
};

export class PlumeModule implements Module {
  readonly name = 'plume';
  /** The plume's own scene (just the proxy mesh). Rendered by render(), never by the main RenderPass. */
  readonly scene = new THREE.Scene();
  /** HalfFloat RGBA: rgb = additive emission, a = view distance (m). Also published as ctx.targets.plume. */
  readonly target: THREE.WebGLRenderTarget;
  readonly look: PlumeLook = { ...DEFAULT_LOOK };

  private ctx!: AppContext;
  private mesh!: THREE.Mesh;
  private material!: THREE.ShaderMaterial;
  private noise: THREE.WebGL3DRenderTarget | null = null;
  private preset!: LightingPreset;
  private resScale = 1;
  private dynScale = 1;
  private boundPts: THREE.Vector3[] = [];
  private readonly tmpM4 = new THREE.Matrix4();
  private readonly tmpV4 = new THREE.Vector4();
  private off: Array<() => void> = [];
  private readonly tmpV2 = new THREE.Vector2();
  private readonly tmpV3 = new THREE.Vector3();
  private readonly prevClear = new THREE.Color();

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.target.texture.name = 'plume';
  }

  init(ctx: AppContext): void {
    this.ctx = ctx;
    this.preset = ctx.preset;
    const { anchors, globals } = ctx;

    this.noise = bakeNoise3D(ctx.renderer, 64);

    // ── plume frame: origin = engine-plane centre, local -y toward the impingement point,
    //    rotated about the axis by the vehicle yaw (same as the vehicle GLB) ──
    const A = anchors.vehicleBase, B = anchors.plumeImpact;
    const axis = B.clone().sub(A);
    const axisLen = axis.length();
    const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), axis.clone().normalize());
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), anchors.vehicleYawDeg * DEG);

    // ── bounding proxy: capped frustum from the engine plane (y = 0) to the impingement point.
    //    The polygon is scaled up so it encloses the analytic frustum the shader intersects. ──
    const H = axisLen;
    const botR = BOUND_TOP_R + BOUND_SPREAD * H;
    const polyScale = 1 / Math.cos(Math.PI / RADIAL_SEGMENTS) + 0.01;
    const geo = new THREE.CylinderGeometry(BOUND_TOP_R * polyScale, botR * polyScale, H, RADIAL_SEGMENTS, 1, false);
    geo.translate(0, -H / 2, 0);
    // rim points of the bound (local frame) for the screen-coverage estimate
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.boundPts.push(new THREE.Vector3(Math.cos(a) * BOUND_TOP_R, 0, Math.sin(a) * BOUND_TOP_R));
      this.boundPts.push(new THREE.Vector3(Math.cos(a) * botR, -H, Math.sin(a) * botR));
    }

    const rings = engineRings();
    const c = COLOURS;
    this.material = new THREE.ShaderMaterial({
      name: 'PlumeRaymarch',
      glslVersion: THREE.GLSL3,
      vertexShader: vert,
      fragmentShader: frag.replace('#include <sl_common>', common),
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      transparent: false,
      toneMapped: false,
      uniforms: {
        uTime: globals.uTime,
        uDrift: globals.uDrift,
        uViewMode: globals.uViewMode,
        uFrame: globals.uFrame,
        uNoise: { value: this.noise.texture },
        uSceneDepth: { value: null },
        uHasDepth: { value: 0 },
        uNear: { value: 0.5 },
        uFar: { value: 60000 },
        uTargetSize: { value: new THREE.Vector2(1, 1) },
        uPixelAngle: { value: 0.001 },
        uLocalCam: { value: new THREE.Vector3() },
        uStepsNear: { value: 48 },
        uStepsFar: { value: 40 },
        uExitDrop: { value: EXIT_DROP },
        uExitR: { value: EXIT_D / 2 },
        uLs: { value: SHOCK_CELL_LENGTH },
        uNeck: { value: JET_NECK },
        uJetSpread: { value: JET_SPREAD },
        uCoreLen: { value: JET_CORE_LENGTH },
        uNearEnd: { value: NEAR_FIELD_END },
        uLen: { value: axisLen - EXIT_DROP },
        uColR0: { value: COLUMN_R0 },
        uColSpread: { value: COLUMN_SPREAD },
        uBoundTopR: { value: BOUND_TOP_R },
        uBoundSpread: { value: BOUND_SPREAD },
        uBoundH: { value: H },
        uCentreJets: { value: rings.centre },
        uMidRing: { value: new THREE.Vector3(rings.mid.radius, rings.mid.count, rings.mid.offset) },
        uOuterRing: { value: new THREE.Vector3(rings.outer.radius, rings.outer.count, rings.outer.offset) },
        uColChemi: { value: c.chemi.clone() },
        uColHot: { value: c.hot.clone() },
        uColEnv: { value: c.envelope.clone() },
        uColDiamond: { value: c.diamond.clone() },
        uColSheathHot: { value: c.sheathHot.clone() },
        uColSheathCool: { value: c.sheathCool.clone() },
        uColBase: { value: c.base.clone() },
        uIntensity: { value: 1 },
        uEnvI: { value: 1 },
        uCoreI: { value: 1 },
        uDiamondAmp: { value: DEFAULT_LOOK.diamondAmp },
        uColumnI: { value: 1 },
        uSheathI: { value: 1 },
        uBaseI: { value: 1 },
        uKelvin: { value: new THREE.Vector3(KELVIN.sheath, KELVIN.core, KELVIN.diamond) },
      },
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'plume.proxy';
    this.mesh.position.copy(A);
    this.mesh.quaternion.copy(align).multiply(yaw);
    this.scene.add(this.mesh);

    ctx.targets.plume = this.target.texture;
    this.onQuality(ctx.quality);

    // hotspots: the column (mid-height) and the Mach diamonds (a few cells below the outer ring)
    const along = (t: number) => A.clone().lerp(B, t);
    const hs: Hotspot[] = [
      { id: 'plume', position: along(0.42), contentKey: 'edu.hotspot.plume', category: 'fx', priority: 60 },
      {
        id: 'machdiamonds',
        position: new THREE.Vector3(0, -(EXIT_DROP + 1.55 * SHOCK_CELL_LENGTH), -rings.outer.radius)
          .applyQuaternion(this.mesh.quaternion).add(A),
        contentKey: 'edu.hotspot.machdiamonds', category: 'fx', priority: 45,
      },
    ];
    ctx.hotspots.push(...hs);

    this.off.push(
      ctx.events.on('preset', (e) => this.onPreset(e.preset)),
      ctx.events.on('quality', (e) => this.onQuality(e.quality)),
    );
    this.update(0, 0);
  }

  update(_dt: number, t: number): void {
    const g = this.ctx.globals;
    g.uPlumeAxisA.value.copy(this.ctx.anchors.vehicleBase);
    g.uPlumeAxisB.value.copy(this.ctx.anchors.plumeImpact);
    // flicker only in slow-drift mode (frozen = perfectly still)
    const flick = 1 + g.uDrift.value * 0.045 * Math.sin(t * 29.0) * Math.sin(t * 13.7 + 1.3);
    g.uPlumeLight.value.copy(LIGHT_COLOUR).multiplyScalar(this.look.lightIntensity * this.preset.plumeLightScale * this.look.intensity * flick);

    const u = this.material.uniforms, L = this.look;
    u.uIntensity.value = L.intensity;
    u.uEnvI.value = L.envelope;
    u.uCoreI.value = L.core;
    u.uDiamondAmp.value = L.diamondAmp;
    u.uColumnI.value = L.column;
    u.uSheathI.value = L.sheath;
    u.uBaseI.value = L.base;
  }

  /**
   * Render the plume into this.target. Call once per frame AFTER the opaque RenderPass (so
   * ctx.targets.sceneDepth holds this frame's depth) and BEFORE the volume composite.
   * Restores the renderer's render target, clear colour/alpha and autoClear.
   */
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    const u = this.material.uniforms;
    camera.updateMatrixWorld();
    this.mesh.updateMatrixWorld();
    // Coverage-adaptive resolution: full quality-scale while the plume is small on screen (the
    // photo view, where the column is ~15-20 px wide), down to 0.75x when it fills the screen
    // (close-ups: large features, and the expensive near field on every pixel).
    const cov = this.screenCoverage(camera);
    const target = this.resScale * (1 - 0.25 * THREE.MathUtils.smoothstep(cov, 0.08, 0.45));
    // quantised with a dead-band, so a slow orbit across a step boundary cannot reallocate the
    // target every frame; small plumes (the photo view) always snap back to the full scale
    const q = Math.round(target * 16) / 16;
    if (target >= this.resScale - 1e-6) this.dynScale = this.resScale;
    else if (Math.abs(target - this.dynScale) >= 1.5 / 16) this.dynScale = q;
    renderer.getDrawingBufferSize(this.tmpV2);
    const w = Math.max(1, Math.round(this.tmpV2.x * this.dynScale));
    const h = Math.max(1, Math.round(this.tmpV2.y * this.dynScale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    u.uTargetSize.value.set(w, h);

    const cam = camera as THREE.PerspectiveCamera;
    u.uNear.value = cam.near ?? 0.5;
    u.uFar.value = cam.far ?? 60000;
    const fov = cam.isPerspectiveCamera ? cam.getEffectiveFOV() : 45;
    u.uPixelAngle.value = (2 * Math.tan((fov * DEG) / 2)) / h;

    u.uLocalCam.value.copy(this.mesh.worldToLocal(camera.getWorldPosition(this.tmpV3)));
    const depth = this.ctx.targets.sceneDepth;
    u.uSceneDepth.value = depth;
    u.uHasDepth.value = depth ? 1 : 0;

    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.getClearColor(this.prevClear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.autoClear = false;
    renderer.render(this.scene, camera);
    renderer.autoClear = prevAuto;
    renderer.setClearColor(this.prevClear, prevAlpha);
    renderer.setRenderTarget(prevTarget);
  }

  /** Approximate fraction of the screen covered by the plume bound (1 if the camera is inside or points are behind it). */
  private screenCoverage(camera: THREE.Camera): number {
    const pts = this.boundPts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    this.tmpM4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.mesh.matrixWorld);
    for (const p of pts) {
      this.tmpV4.set(p.x, p.y, p.z, 1).applyMatrix4(this.tmpM4);
      if (this.tmpV4.w <= 0.5) return 1;
      const nx = this.tmpV4.x / this.tmpV4.w, ny = this.tmpV4.y / this.tmpV4.w;
      x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
    }
    const cw = Math.max(0, Math.min(1, x1) - Math.max(-1, x0)), ch = Math.max(0, Math.min(1, y1) - Math.max(-1, y0));
    return (cw * ch) / 4;
  }

  onPreset(p: LightingPreset): void {
    this.preset = p;
  }

  onQuality(q: QualitySettings): void {
    const pq = PLUME_QUALITY[q.id] ?? PLUME_QUALITY.high;
    this.resScale = pq.scale;
    this.dynScale = pq.scale;
    this.material.uniforms.uStepsFar.value = pq.steps;
    this.material.uniforms.uStepsNear.value = Math.round(pq.steps * 1.2);
  }

  dispose(): void {
    this.off.forEach((f) => f());
    this.off = [];
    this.target.dispose();
    this.noise?.dispose();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
    if (this.ctx?.targets.plume === this.target.texture) this.ctx.targets.plume = null;
  }
}
