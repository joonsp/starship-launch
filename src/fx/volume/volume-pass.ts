// VolumePass: pmndrs postprocessing Pass that raymarches the launch clouds at reduced resolution,
// accumulates them at FULL resolution while the camera is still, and OWNS THE COMPOSITE
// (contracts frame-graph step 3):
//     out = opaque.rgb * T_total + L_inscatter + plume.rgb * T(plume.a)
// OWNER: volume module. Constructed by VolumeModule; the integrator adds `module.pass` to the
// composer right after the plume pass (it reads the inputBuffer colour, the scene depth and
// ctx.targets.plume).
//
// Per frame (while not converged):
//   1. march   (low res, quality.volumeScale): each low-res pixel traces ONE exact full-res pixel of
//              its footprint, picked by this frame's sub-pixel offset (cycled over the footprint).
//   2. scatter (full res): writes those samples into the full-res accumulation with a per-draw
//              running-mean weight (constant-alpha blending), EMA in drift mode.
//   3. composite (full res): accumulated pixels are exact; not-yet-traced pixels fall back to a
//              depth-aware bilateral upsample of the current low-res frame.
// Once params.maxFrames frames are accumulated (still camera, frozen scene) steps 1-2 are skipped:
// the pass then costs one full-screen composite.
//
// Planar reflections (renderView, called by core's ctx.renderView for the tidal-pool mirror) use the same three
// steps on their own buffers, progressively: env renders the mirror only when the camera moves, so the first call
// snapshots the mirror's opaque colour + depth and camera, and every drawn frame after it marches one more
// sub-pixel offset and re-composites the steam into the mirror target, until REFL_FRAMES are accumulated (or
// forever with EMA in drift mode). `converged` stays false until the final mirror has been drawn once.
import * as THREE from 'three';
import { Pass } from 'postprocessing';
import common from '../../shaders/common.glsl?raw';
import type { AppContext } from '../../contracts.ts';
import vertFullscreen from './shaders/fullscreen.vert.glsl?raw';
import fragMarch from './shaders/march.frag.glsl?raw';
import fragScatter from './shaders/scatter.frag.glsl?raw';
import fragComposite from './shaders/composite.frag.glsl?raw';
import fragReflectCopy from './shaders/reflect-copy.frag.glsl?raw';
import { DILUTION, OCC_BLOCK, type VolumeBaker } from './bakes.ts';
import { DEFAULT_PARAMS, TEMP_KELVIN_MAX, TEMP_KELVIN_MIN, type VolumeParams } from './params.ts';
import { DEFAULT_PAD_YAW } from './puffs.ts';

/** One triangle covering the viewport (clip-space positions; the vertex shader derives vUv). */
const FULLSCREEN_TRIANGLE = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
})();

function screenMaterial(frag: string, uniforms: Record<string, THREE.IUniform>, extra: Partial<THREE.ShaderMaterialParameters> = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: vertFullscreen,
    fragmentShader: frag.replace('#include <sl_common>', common),
    uniforms,
    depthTest: false,
    depthWrite: false,
    ...extra,
  });
}

function mrt(w: number, h: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
}

/** Accumulated frames of a still planar-reflection view (exportStill draws 32 frames: keep it below that). */
export const REFL_FRAMES = 28;

/** Progressive state of the planar-reflection view (see VolumePass.renderView). */
interface ReflView {
  /** The caller's mirror target (opaque scene + depthTexture); the steam is composited into it in place. */
  target: THREE.WebGLRenderTarget;
  /** Frozen copy of the mirror camera at the last renderView call. */
  readonly cam: THREE.PerspectiveCamera;
  /** rgb = the mirror's opaque colour, a = its linear depth (m). */
  readonly copy: THREE.WebGLRenderTarget;
  readonly cur: THREE.WebGLRenderTarget;
  readonly acc: THREE.WebGLRenderTarget;
  order: [number, number][];
  steps: number;
  /** Iterations since the last reset. */
  n: number;
  needsClear: boolean;
  /** The final iteration has been sampled by one drawn main frame (the pools read the mirror in the RenderPass). */
  shown: boolean;
  /** Tick of the last iteration (renderView iterates once itself; render() then skips that tick). */
  tick: number;
}

/** Visit order of the K x K sub-pixel offsets: spatially spread so partial coverage looks even. */
function offsetOrder(K: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let y = 0; y < K; y++) for (let x = 0; x < K; x++) cells.push([x, y]);
  // sort by a radical-inverse key: (0,0),(1,1),(1,0),(0,1)-like spread for K = 2
  const ri = (i: number) => { let r = 0, f = 0.5; while (i) { if (i & 1) r += f; i >>= 1; f *= 0.5; } return r; };
  return cells.map((c, i) => ({ c, k: ri(i * 7 + 3) })).sort((a, b) => a.k - b.k).map((e) => e.c);
}

export class VolumePass extends Pass {
  /** Frames accumulated since the last reset. */
  accumulated = 0;
  /** Debug output: 0 composite, 1 volume radiance only, 2 transmittance, 3 accumulation coverage. */
  debug = 0;
  /** Debug bits for the march: 1 = no empty-space skipping, 2 = white-noise jitter. */
  flags = 0;
  /** Light-term isolation: 0 all, 1 sun, 2 sky+ground ambient, 3 plume+fire light, 4 emission. */
  lightDebug = 0;
  /** Stochastic density-filter width in texels (removes trilinear facets; larger = softer). */
  stochAmp = 0.15;
  /** Set false to bypass the volume (the composite passes the opaque colour + plume through). */
  volumeEnabled = true;
  readonly params: VolumeParams;
  /** Shared (view-independent) march uniforms. */
  readonly shared: Record<string, THREE.IUniform>;

  private ctx: AppContext | null = null;
  private baker: VolumeBaker | null = null;
  private cam: THREE.PerspectiveCamera | null = null;
  private depthTex: THREE.Texture | null = null;
  private scale = 0.5;
  private steps = 96;
  private fullW = 1;
  private fullH = 1;
  private readonly cur: THREE.WebGLRenderTarget;
  private readonly acc: THREE.WebGLRenderTarget;
  private needsClear = true;
  private order: [number, number][] = [[0, 0]];
  private readonly jitter = new THREE.Vector2(0.5, 0.5);
  private readonly lastView = new THREE.Matrix4();
  private readonly lastProj = new THREE.Matrix4();
  private readonly black: THREE.DataTexture;
  private readonly mesh: THREE.Mesh;
  private readonly marchMat: THREE.ShaderMaterial;
  private readonly scatterMat: THREE.ShaderMaterial;
  private readonly clearMat: THREE.ShaderMaterial;
  private readonly compMat: THREE.ShaderMaterial;
  private readonly viewMarchMat: THREE.ShaderMaterial;
  private readonly reflScatterMat: THREE.ShaderMaterial;
  private readonly reflCompMat: THREE.ShaderMaterial;
  private readonly reflCopyMat: THREE.ShaderMaterial;
  private readonly reflJitter = new THREE.Vector2(0.5, 0.5);
  private refl: ReflView | null = null;
  private frame = 0;
  /** Drawn main frames (render() calls). */
  private tick = 0;

  constructor(params: VolumeParams = { ...DEFAULT_PARAMS }) {
    super('VolumePass');
    this.params = params;
    this.needsDepthTexture = true;
    this.needsSwap = true;
    this.cur = mrt(1, 1);
    this.acc = mrt(1, 1);
    this.black = new THREE.DataTexture(new Float32Array([0, 0, 0, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    this.black.needsUpdate = true;

    const V3 = () => ({ value: new THREE.Vector3() });
    this.shared = {
      uDensity: { value: null }, uOccupancy: { value: null }, uShape: { value: null }, uDetail: { value: null },
      uLightA: { value: null }, uLightB: { value: null },
      uBoxMin: V3(), uBoxSize: V3(), uOccRes: V3(), uOccCell: V3(), uFlags: { value: 0 },
      uLightDebug: { value: 0 }, uNearShadow: { value: 2 }, uDensTexel: V3(), uLightTexel: V3(), uStochAmp: { value: 0.35 },
      uSigma: { value: params.sigma }, uAlbedo: { value: params.albedo },
      uPhase: V3(), uMs: V3(), uPowder: { value: params.powder },
      uSunDir: V3(), uSunColor: { value: new THREE.Color() }, uSkyAmb: { value: new THREE.Color() },
      uGroundAmb: { value: new THREE.Color() }, uPlumeLight: { value: new THREE.Color() },
      uFireLight: { value: new THREE.Color() }, uFireCentre: V3(), uGains: { value: new THREE.Vector4(1, 1, 1, 1) },
      uSunTauScale: { value: 1 }, uShapeP: V3(), uDetailP: V3(), uBillowP: V3(), uNearFade: { value: params.nearFade },
      uTrenchAxis: { value: new THREE.Vector2(Math.cos(DEFAULT_PAD_YAW), -Math.sin(DEFAULT_PAD_YAW)) },   // the module sets scene-config's
      uViewMode: { value: 0 }, uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0 },
      uDriftOffset: V3(), uGrowth: { value: new THREE.Vector3(1, 1, 1) },
      uTempRange: { value: new THREE.Vector2(TEMP_KELVIN_MIN, TEMP_KELVIN_MAX) },
      uRedden: { value: new THREE.Vector4() }, uDust: { value: new THREE.Vector4(1, 1, 1, 40) }, uSkyOcc: { value: params.skyOcclusion }, uNormalAmb: { value: params.normalAmbient }, uSunDiff: { value: new THREE.Vector3() }, uDilution: { value: DILUTION },
    };
    const perView = () => ({
      uDepth: { value: null as THREE.Texture | null }, uPlume: { value: null as THREE.Texture | null },
      uCamMatrixWorld: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() },
      uCamPos: V3(), uNear: { value: 0.5 }, uFar: { value: 60000 },
      uFullRes: { value: new THREE.Vector2(1, 1) }, uLowRes: { value: new THREE.Vector2(1, 1) },
      uJitter: { value: new THREE.Vector2(0.5, 0.5) }, uFrame: { value: 0 }, uVisit: { value: 0 }, uSteps: { value: 96 },
      uHasDepth: { value: 0 }, uHasPlume: { value: 0 }, uPixAngle: { value: 0.001 },
    });
    this.marchMat = screenMaterial(fragMarch, { ...this.shared, ...perView() });
    this.viewMarchMat = screenMaterial(fragMarch, { ...this.shared, ...perView() });
    const scatterBlend: Partial<THREE.ShaderMaterialParameters> = {
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendEquationAlpha: THREE.AddEquation,
      blendSrc: THREE.ConstantAlphaFactor, blendDst: THREE.OneMinusConstantAlphaFactor,
      blendSrcAlpha: THREE.ConstantAlphaFactor, blendDstAlpha: THREE.OneMinusConstantAlphaFactor,
    };
    this.scatterMat = screenMaterial(fragScatter, {
      uCur0: { value: this.cur.textures[0] }, uCur1: { value: this.cur.textures[1] },
      uLowRes: { value: new THREE.Vector2(1, 1) }, uFullRes: { value: new THREE.Vector2(1, 1) }, uJitter: { value: this.jitter },
    }, scatterBlend);
    this.reflScatterMat = screenMaterial(fragScatter, {
      uCur0: { value: null }, uCur1: { value: null },
      uLowRes: { value: new THREE.Vector2(1, 1) }, uFullRes: { value: new THREE.Vector2(1, 1) }, uJitter: { value: this.reflJitter },
    }, scatterBlend);
    this.clearMat = screenMaterial('layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; void main() { o0 = vec4(0.0); o1 = vec4(0.0); }', {});
    const compUniforms = (jitter: THREE.Vector2): Record<string, THREE.IUniform> => ({
      uColor: { value: null }, uDepth: { value: null }, uPlume: { value: null },
      uAcc0: { value: null }, uAcc1: { value: null },
      uVol0: { value: this.black }, uVol1: { value: this.black },
      uLowRes: { value: new THREE.Vector2(1, 1) }, uFullRes: { value: new THREE.Vector2(1, 1) }, uJitter: { value: jitter },
      uNear: { value: 0.5 }, uFar: { value: 60000 }, uUseAcc: { value: 0 },
      uHasDepth: { value: 0 }, uHasPlume: { value: 0 }, uDebug: { value: 0 },
    });
    this.compMat = screenMaterial(fragComposite, compUniforms(this.jitter));
    this.compMat.uniforms.uAcc0.value = this.acc.textures[0];
    this.compMat.uniforms.uAcc1.value = this.acc.textures[1];
    this.reflCompMat = screenMaterial('#define REFLECTION\n' + fragComposite, compUniforms(this.reflJitter));
    this.reflCopyMat = screenMaterial(fragReflectCopy, { uSrc: { value: null }, uSrcDepth: { value: null }, uNear: { value: 0.5 }, uFar: { value: 60000 } });
    // Own full-screen mesh (pmndrs' `screen` is not in its public typings).
    this.mesh = new THREE.Mesh(FULLSCREEN_TRIANGLE, this.compMat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /** Wire the app context and the baked volumes (called by VolumeModule.init). */
  attach(ctx: AppContext, baker: VolumeBaker): void {
    this.ctx = ctx;
    this.baker = baker;
    this.cam = ctx.camera;
    this.setQuality(ctx.quality.volumeScale, ctx.quality.volumeSteps);
  }

  set mainCamera(cam: THREE.Camera) {
    if ((cam as THREE.PerspectiveCamera).isPerspectiveCamera) this.cam = cam as THREE.PerspectiveCamera;
  }

  override setDepthTexture(depthTexture: THREE.Texture): void {
    this.depthTex = depthTexture;
  }

  setQuality(scale: number, steps: number): void {
    this.scale = scale;
    this.steps = steps;
    // near-field detailed sun-shadow samples: 1 on low, 2 on medium/high, 3 on ultra
    this.shared.uNearShadow.value = steps < 64 ? 1 : steps < 160 ? 2 : 3;
    this.setSize(this.fullW, this.fullH);
  }

  override setSize(width: number, height: number): void {
    this.fullW = Math.max(1, width);
    this.fullH = Math.max(1, height);
    const w = Math.max(1, Math.round(this.fullW * this.scale)), h = Math.max(1, Math.round(this.fullH * this.scale));
    this.cur.setSize(w, h);
    this.acc.setSize(this.fullW, this.fullH);
    const K = Math.max(1, Math.ceil(Math.max(this.fullW / w, this.fullH / h) - 1e-3));
    this.order = offsetOrder(K);
    this.resetAccumulation();
  }

  resetAccumulation(): void {
    this.accumulated = 0;
    this.needsClear = true;
    const r = this.refl;
    if (r) { r.n = 0; r.needsClear = true; r.shown = false; }
  }

  /** True once the still image has converged (the march is skipped from then on), mirror included. */
  get converged(): boolean {
    return this.accumulated >= this.params.maxFrames && (!this.refl || this.refl.shown) && (this.ctx?.globals.uDrift.value ?? 0) === 0;
  }

  /** Copy per-frame globals + params into the shared uniforms. */
  private syncShared(): void {
    const ctx = this.ctx!, g = ctx.globals, p = this.params, u = this.shared, b = this.baker!;
    u.uDensity.value = b.density?.texture ?? null;
    u.uOccupancy.value = b.occupancy?.texture ?? null;
    u.uShape.value = b.shape.texture;
    u.uDetail.value = b.detail.texture;
    u.uLightA.value = b.light?.textures[0] ?? null;
    u.uLightB.value = b.light?.textures[1] ?? null;
    u.uBoxMin.value.copy(b.box.min);
    b.box.getSize(u.uBoxSize.value);
    if (b.density) u.uDensTexel.value.set(1 / b.density.width, 1 / b.density.height, 1 / b.density.depth);
    if (b.light) u.uLightTexel.value.set(1 / b.light.width, 1 / b.light.height, 1 / b.light.depth);
    const occ = b.occupancy;
    if (occ) {
      u.uOccRes.value.set(occ.width, occ.height, occ.depth);
      const [W, H, D] = b.densityRes;
      u.uOccCell.value.copy(u.uBoxSize.value).multiply(new THREE.Vector3(OCC_BLOCK / W, OCC_BLOCK / H, OCC_BLOCK / D));
    }
    u.uFlags.value = this.flags;
    u.uLightDebug.value = this.lightDebug;
    u.uStochAmp.value = this.stochAmp;
    u.uSigma.value = p.sigma;
    u.uAlbedo.value = p.albedo;
    u.uPhase.value.set(p.hgForward, p.hgBack, p.hgMix);
    u.uMs.value.set(p.msA, p.msB, p.msC);
    u.uPowder.value = p.powder;
    u.uSunDir.value.copy(g.uSunDir.value).normalize();
    u.uSunColor.value.copy(g.uSunColor.value);
    u.uSkyAmb.value.copy(g.uSkyAmbient.value);
    u.uGroundAmb.value.copy(g.uGroundAmbient.value);
    u.uPlumeLight.value.copy(g.uPlumeLight.value);
    u.uGains.value.set(p.sunGain, p.ambientGain, p.plumeGain, p.emissionGain);
    u.uSunTauScale.value = p.sunTauScale;
    u.uShapeP.value.set(p.shapeAmount, 1 / p.shapeScale, 0);
    u.uDetailP.value.set(p.detailAmount, 1 / p.detailScale, p.crisp);
    u.uBillowP.value.set(p.billowAmount, 1 / Math.max(1, p.billowScale), 0);
    u.uNearFade.value = p.nearFade;
    u.uRedden.value.set(p.reddenR, p.reddenG, p.reddenB, p.reddenHaze);
    u.uDust.value.set(p.dustR, p.dustG, p.dustB, Math.max(1, p.dustHeight));
    u.uSkyOcc.value = p.skyOcclusion;
    u.uNormalAmb.value = p.normalAmbient;
    u.uSunDiff.value.set(p.sunDiffuse, p.sunAbsorb, p.reddenCloud);
    u.uViewMode.value = g.uViewMode.value;
    u.uFogColor.value.copy(g.uFogColor.value);
    u.uFogDensity.value = g.uFogDensity.value;
  }

  /** Fire light colour (linear, x intensity) and fireball centroid, set by the module. */
  setFireLight(c: THREE.Color, centre?: THREE.Vector3): void {
    this.shared.uFireLight.value.copy(c);
    if (centre) this.shared.uFireCentre.value.copy(centre);
  }

  /** Drift state from the module (noise advection offset, growth scale). */
  setDrift(offset: THREE.Vector3, growth: THREE.Vector3): void {
    this.shared.uDriftOffset.value.copy(offset);
    this.shared.uGrowth.value.copy(growth);
  }

  private setViewUniforms(m: THREE.ShaderMaterial, cam: THREE.PerspectiveCamera, fullW: number, fullH: number, lowW: number, lowH: number, depth: THREE.Texture | null, plume: THREE.Texture | null): void {
    const u = m.uniforms;
    cam.updateMatrixWorld();
    u.uCamMatrixWorld.value.copy(cam.matrixWorld);
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    u.uFullRes.value.set(fullW, fullH);
    u.uLowRes.value.set(lowW, lowH);
    // angular size of one full-res pixel (projection[5] = 1 / tan(vfov / 2)): the march's noise LOD
    u.uPixAngle.value = 2 / (Math.max(1e-6, cam.projectionMatrix.elements[5]) * Math.max(1, fullH));
    u.uDepth.value = depth;
    u.uHasDepth.value = depth ? 1 : 0;
    u.uPlume.value = plume;
    u.uHasPlume.value = plume ? 1 : 0;
  }

  private draw(renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.mesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget): void {
    const ctx = this.ctx, cam = this.cam;
    const depth = this.depthTex ?? ctx?.targets.sceneDepth ?? null;
    const plume = ctx?.targets.plume ?? null;
    const ready = !!(ctx && cam && this.baker?.density && this.baker.light && this.volumeEnabled);
    const cu = this.compMat.uniforms;
    cu.uColor.value = inputBuffer.texture;
    cu.uDepth.value = depth;
    cu.uHasDepth.value = depth ? 1 : 0;
    cu.uPlume.value = plume;
    cu.uHasPlume.value = plume ? 1 : 0;
    cu.uFullRes.value.set(inputBuffer.width, inputBuffer.height);
    cu.uDebug.value = this.debug;
    if (cam) { cu.uNear.value = cam.near; cu.uFar.value = cam.far; }
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;

    if (ready) {
      this.syncShared();
      if (this.acc.width !== inputBuffer.width || this.acc.height !== inputBuffer.height) this.setSize(inputBuffer.width, inputBuffer.height);
      // robust camera-change detection (in addition to the 'camera-moved' event)
      cam!.updateMatrixWorld();
      if (!this.lastView.equals(cam!.matrixWorld) || !this.lastProj.equals(cam!.projectionMatrix)) {
        this.lastView.copy(cam!.matrixWorld);
        this.lastProj.copy(cam!.projectionMatrix);
        this.resetAccumulation();
      }
      if (this.needsClear) { this.draw(renderer, this.clearMat, this.acc); this.needsClear = false; }
      const drift = ctx!.globals.uDrift.value > 0;
      // planar reflection: one more progressive iteration of the mirror (unless renderView already ran one this tick)
      const r = this.refl;
      if (r && r.tick !== this.tick) {
        if (r.n < REFL_FRAMES || drift) this.reflIterate(renderer);
        else r.shown = true;   // this frame's RenderPass has sampled the final mirror
      }
      if (this.accumulated < this.params.maxFrames || drift) {
        const n = this.accumulated, N = this.order.length;
        const [ox, oy] = this.order[n % N];
        const K = Math.round(Math.sqrt(N));
        this.jitter.set((ox + 0.5) / K, (oy + 0.5) / K);
        // 1. march (low res)
        const m = this.marchMat;
        this.setViewUniforms(m, cam!, inputBuffer.width, inputBuffer.height, this.cur.width, this.cur.height, depth, plume);
        m.uniforms.uJitter.value.copy(this.jitter);
        m.uniforms.uFrame.value = this.frame++ % 4096;
        m.uniforms.uVisit.value = Math.floor(n / N) + (drift ? this.frame * 0.37 : 0);
        m.uniforms.uSteps.value = this.steps;
        this.draw(renderer, m, this.cur);
        // 2. scatter into the full-res accumulation: running mean per offset (EMA while drifting)
        const visits = Math.floor(n / N);
        this.scatterMat.blendAlpha = drift ? Math.max(1 / (visits + 1), 0.15) : 1 / (visits + 1);
        this.scatterMat.uniforms.uLowRes.value.set(this.cur.width, this.cur.height);
        this.scatterMat.uniforms.uFullRes.value.set(this.acc.width, this.acc.height);
        this.draw(renderer, this.scatterMat, this.acc);
        this.accumulated++;
      }
      cu.uVol0.value = this.cur.textures[0];
      cu.uVol1.value = this.cur.textures[1];
      cu.uLowRes.value.set(this.cur.width, this.cur.height);
      cu.uUseAcc.value = 1;
    } else {
      cu.uVol0.value = this.black;
      cu.uVol1.value = this.black;
      cu.uLowRes.value.set(1, 1);
      cu.uUseAcc.value = 0;
    }
    this.draw(renderer, this.compMat, this.renderToScreen ? null : outputBuffer);
    renderer.autoClear = prevAuto;
    this.tick++;
  }

  /**
   * The launch clouds in an arbitrary view: core's ctx.renderView uses it for the planar (tidal-pool) reflection.
   * Call after the view's opaque scene has been rendered into `target` (which must carry a depthTexture); the steam is
   * composited into `target` in place (out = opaque * T + L).
   *
   * The caller renders its mirror only when the main camera moves, so this call snapshots the view (opaque colour +
   * linear depth, camera) and then refines it progressively: every drawn frame after it marches one more sub-pixel
   * offset at `scale` of the target with `steps` steps, accumulates at the target's full resolution and re-composites,
   * until REFL_FRAMES are accumulated (EMA in drift mode, so the mirrored steam drifts with the real one). Pixels not yet
   * traced use the depth-aware bilateral upsample of the current low-res frame, as in the main view.
   */
  renderView(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, target: THREE.WebGLRenderTarget, opts: { scale?: number; steps?: number } = {}): void {
    if (!this.ctx || !this.baker?.density || !this.baker.light || !target.depthTexture) return;
    const scale = THREE.MathUtils.clamp(opts.scale ?? 0.5, 0.2, 1), steps = Math.max(8, Math.round(opts.steps ?? 40));
    const W = target.width, H = target.height;
    const w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
    let r = this.refl;
    if (!r) {
      const cam = new THREE.PerspectiveCamera();
      cam.matrixAutoUpdate = false;
      const copy = new THREE.WebGLRenderTarget(W, H, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      });
      r = this.refl = { target, cam, copy, cur: mrt(w, h), acc: mrt(W, H), order: [[0, 0]], steps, n: 0, needsClear: true, shown: false, tick: -1 };
    }
    r.target = target;
    r.steps = steps;
    if (r.copy.width !== W || r.copy.height !== H) { r.copy.setSize(W, H); r.acc.setSize(W, H); }
    if (r.cur.width !== w || r.cur.height !== h) r.cur.setSize(w, h);
    r.order = offsetOrder(Math.max(1, Math.ceil(Math.max(W / w, H / h) - 1e-3)));
    // snapshot the mirror camera (the caller may move its camera before the refinement ends)
    camera.updateMatrixWorld();
    r.cam.matrix.copy(camera.matrixWorld);
    r.cam.matrixWorld.copy(camera.matrixWorld);
    r.cam.matrixWorldInverse.copy(camera.matrixWorld).invert();
    r.cam.projectionMatrix.copy(camera.projectionMatrix);
    r.cam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    r.cam.near = camera.near;
    r.cam.far = camera.far;
    r.n = 0; r.needsClear = true; r.shown = false;

    const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    const cu = this.reflCopyMat.uniforms;
    cu.uSrc.value = target.texture;
    cu.uSrcDepth.value = target.depthTexture;
    cu.uNear.value = camera.near;
    cu.uFar.value = camera.far;
    this.draw(renderer, this.reflCopyMat, r.copy);
    this.syncShared();
    this.reflIterate(renderer);
    renderer.setRenderTarget(prevRT);
    renderer.autoClear = prevAuto;
  }

  /** One progressive iteration of the planar-reflection view: march, scatter, composite into the mirror target. */
  private reflIterate(renderer: THREE.WebGLRenderer): void {
    const r = this.refl!;
    const drift = (this.ctx?.globals.uDrift.value ?? 0) > 0;
    if (r.needsClear) { this.draw(renderer, this.clearMat, r.acc); r.needsClear = false; }
    const n = r.n, N = r.order.length, K = Math.round(Math.sqrt(N));
    const [ox, oy] = r.order[n % N];
    this.reflJitter.set((ox + 0.5) / K, (oy + 0.5) / K);
    const visits = Math.floor(n / N);
    // 1. march (low res), jitter indexed by the iteration so a still mirror converges deterministically
    const m = this.viewMarchMat;
    this.setViewUniforms(m, r.cam, r.acc.width, r.acc.height, r.cur.width, r.cur.height, r.target.depthTexture ?? null, null);
    m.uniforms.uJitter.value.copy(this.reflJitter);
    m.uniforms.uFrame.value = n % 4096;
    m.uniforms.uVisit.value = visits + (drift ? this.frame * 0.37 : 0);
    m.uniforms.uSteps.value = r.steps;
    this.draw(renderer, m, r.cur);
    // 2. scatter into the full-res mirror accumulation (running mean; EMA while drifting)
    const su = this.reflScatterMat.uniforms;
    su.uCur0.value = r.cur.textures[0];
    su.uCur1.value = r.cur.textures[1];
    su.uLowRes.value.set(r.cur.width, r.cur.height);
    su.uFullRes.value.set(r.acc.width, r.acc.height);
    this.reflScatterMat.blendAlpha = drift ? Math.max(1 / (visits + 1), 0.15) : 1 / (visits + 1);
    this.draw(renderer, this.reflScatterMat, r.acc);
    // 3. composite over the opaque copy into the mirror target (no depth test / write: its depth stays for the march)
    const cu = this.reflCompMat.uniforms;
    cu.uColor.value = r.copy.texture;
    cu.uAcc0.value = r.acc.textures[0];
    cu.uAcc1.value = r.acc.textures[1];
    cu.uVol0.value = r.cur.textures[0];
    cu.uVol1.value = r.cur.textures[1];
    cu.uLowRes.value.set(r.cur.width, r.cur.height);
    cu.uFullRes.value.set(r.acc.width, r.acc.height);
    cu.uNear.value = r.cam.near;
    cu.uFar.value = r.cam.far;
    cu.uUseAcc.value = 1;
    this.draw(renderer, this.reflCompMat, r.target);
    r.n++;
    r.tick = this.tick;
  }

  override dispose(): void {
    this.cur.dispose();
    this.acc.dispose();
    if (this.refl) { this.refl.copy.dispose(); this.refl.cur.dispose(); this.refl.acc.dispose(); this.refl = null; }
    this.black.dispose();
    for (const m of [this.marchMat, this.scatterMat, this.clearMat, this.compMat, this.viewMarchMat, this.reflScatterMat, this.reflCompMat, this.reflCopyMat]) m.dispose();
    super.dispose();
  }
}
