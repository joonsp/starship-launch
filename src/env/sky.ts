// Sky bake + dome. The sky (single-scatter atmosphere), cirrus and raymarched background cumulus are baked into a
// HalfFloat cubemap once per lighting preset (the scene is frozen) and displayed on a camera-locked dome.
import * as THREE from 'three';
import common from '../shaders/common.glsl?raw';
import atmosphere from './glsl/atmosphere.glsl?raw';
import bakeFrag from './glsl/sky_bake.frag.glsl?raw';
import domeVert from './glsl/sky_dome.vert.glsl?raw';
import domeFrag from './glsl/sky_dome.frag.glsl?raw';
import {
  CIRRUS_PATCHES, CLOUD_ABOVE, CLOUD_BASE, CLOUD_BELOW, CLOUD_TOP, CONTRAIL, COVER_DIN, COVER_DOUT, COVER_EXTENT, VOL_DY, VOL_EXTENT, VOL_LAYERS, VOL_RANGE,
  VOL_Y0, buildEnvelopeVolume,
} from './cloud-layout.ts';

/**
 * Look knobs of the sky bake that SkyParams (EnvironmentModule.presetToSky) has no field for. They are the same for
 * every preset; the preset-dependent physics (sun, E0, aerosol amount, ambient) still comes from SkyParams.
 * Tuned against research/reference.jpeg through the frozen post chain.
 */
export const SKY_LOOK = {
  // ── clear sky ──
  /** Aerosol scale height (m): a shallow humid marine layer, so the haze whitens the horizon but not the upper sky. */
  aeroH: 350,
  /** Weight of the sharp forward aureole lobe in the aerosol phase function, and g of the broad humid lobe. */
  aeroFwd: 0.1, aeroBroadG: 0.2,
  /** Chroma gain of the clear sky aloft (luminance preserving) and the rd.y range over which it ramps in. */
  sat: 0.75, satY0: 0.08, satY1: 0.35,
  /** Fall-off (per unit rd.y) of the humid horizon tint (SkyParams.horizonTint). */
  tintK: 5.8,
  // ── cirrus ──
  /** Cirrus opacity gain (on top of SkyParams.cirrus), deck altitude (m), sun and sky gains, forward peak, and the
   *  coverage of the broad random patches (the authored ones are in cloud-layout.ts). */
  cirrus: 1.0, cirrusAlt: 9200, cirrusSun: 0.55, cirrusSky: 0.9, cirrusPeak: 2.5, cirrusCover: 0.2,
  // ── cumulus shape ──
  /** Cumulus density gain (on top of SkyParams.cloudDensity); 0 removes the cumulus. */
  cumulus: 1.0,
  /** Billow (cauliflower) displacement amplitude (m) of a tall tower, and of the small billow octave. */
  billow: 170, fineBillow: 16,
  /** Weights of the large, medium and small billow octaves (Worley 4/8/16 cells per shape tile). */
  billowW0: 0.35, billowW1: 0.4, billowW2: 0.25,
  /** Edge width (m): behind the displaced surface the density ramps in over this distance, on a dense tower (crowns
   *  are crisper, flanks softer) and on a fully ragged fragment (cloud-layout.ts CloudCell.rag). */
  edge: 14, edgeRag: 32,
  /** Fringe erosion depth (m) by the smallest detail cells: torn, wispy edges (dense tower, ragged fragment). */
  erode: 16, erodeRag: 110,
  /** Soft base: the density fades in over this height (m), centred on the condensation level (dense, ragged cell). */
  baseSoft: 60, baseSoftRag: 150,
  /** Billow strength kept on the flanks just above the base (1 = as strong as on the crown). */
  flank: 0.55,
  /** Density of a fully ragged fragment relative to a dense tower, and how deep (m) it is torn apart at ~0.5 km scale. */
  thin: 0.4, breakup: 220,
  /** Long-range cloud-on-cloud shadow toward the true sun: optical-depth gain (relative to the cloud interior, the
   *  envelope is undisplaced and coarsely sampled) and reach (m). At sunrise a 1 km tower shadows ~10 km downsun. */
  farShadow: 0.3, farReach: 16000,
  /** Sunlight re-scattered into a cloud shadow by the sunlit cloud field and haze around it (fraction of the sun). */
  shadowFill: 0.05,
  /** Extinction (1/m) of the cloud interior (real cumulus: 0.05-0.1). */
  sigma: 0.06,
  /** Tile sizes (m) of the shape (Worley 4/8/16 cells) and detail (3/6/12 cells) noise, and the base wander (m). */
  shapeTile: 2200, detailTile: 450, baseWander: 50,
  /** In-cloud view step: metres per metre of range, min and max (m), scaled up for small cubes. */
  stepK: 0.002, stepMin: 7, stepMax: 55,
  /** Light march toward the sun: first step (m, grows x1.9) and step count. */
  lightStep0: 18, lightSteps: 5,
  // ── cumulus light ──
  /** Sun, sky-ambient and ground-ambient gains; skylight diffusion length into the cloud (m). The sun gain is art
   *  directed: sunlit crowns land at ~1.3-1.8 linear (peaks ~3.7 on silver linings at sunrise, ~2.5 at noon). */
  sunGain: 2.2, skyAmb: 0.3, gndAmb: 0.2, ambDepth: 120,
  /** Dual-lobe HG phase: forward g, backward g, backward weight. */
  phaseF: 0.7, phaseB: -0.25, phaseBW: 0.3,
  /** Sunlight reaching shaded flanks after bouncing off sunlit neighbours and deep multiple scattering (fraction). */
  bounce: 0.035,
  /** Wrenninge multiple-scattering octaves: extinction, contribution and eccentricity factors, octave count. */
  msA: 0.45, msB: 0.6, msC: 0.5, msOct: 4,
  /** Cloud light direction: 0 = the true sun, 1 = the preset's lifted cloudSunDir, > 1 extrapolates the lift. The low
   *  sunrise sun grazes the towers; multiple scattering lights their crowns far more than a grazing ray would. */
  sunLift: 1.5,
  /** Saturation of the sun colour on the clouds (1 = the full sun colour, 0 = grey of the same luminance). */
  sunSat: 1.0,
  // ── night ──
  /** Moon (the clouds' key light when the sun is off): compass azimuth and elevation (deg), and its light on the clouds
   *  relative to the capped daylight sun (sky.ts SkyParams.sunLight ~2.6 luma). */
  moonAz: 235, moonEl: 38, moonLight: 0.012,
  /** Launch glow on the cloud bases at night: radiance x m^2 of a point source at the pad (a base 4 km away gets
   *  ~glow / 1.6e7), its height (m) and colour (the ~2300 K fire light of the steam banks). */
  glow: 4.0e5, glowY: 150, glowR: 1.0, glowG: 0.55, glowB: 0.25,
  // ── camera motion ──
  /** 1 = bake a depth cube with the sky so the dome can reproject the cumulus for a moving camera (SkyDome). */
  reproject: 1,
};

/** Direction toward the moon (SKY_LOOK.moonAz / moonEl; three.js frame: -z north, +x east). */
export function moonDir(): THREE.Vector3 {
  const az = SKY_LOOK.moonAz * Math.PI / 180, el = SKY_LOOK.moonEl * Math.PI / 180;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/** Everything the bake shader needs, derived from a LightingPreset by the module. */
export interface SkyParams {
  sunDir: THREE.Vector3;
  cloudSunDir: THREE.Vector3; // sun direction used to light clouds
  sunLight: THREE.Color;      // ground-level sun colour * intensity (linear)
  e0: THREE.Color;            // extraterrestrial irradiance fed to the atmosphere
  msGain: number;
  atmo: THREE.Vector4;        // rayleigh scale, aerosol scale, mie g, ozone scale
  betaR: THREE.Vector3;       // Rayleigh coefficients (per m)
  horizonTint: THREE.Color;   // humid coastal haze: multiplies the sky near the horizon (teal-grey instead of violet-white)
  farCap: number;             // view-ray length cap (m)
  warmth: number;             // how much of the sun's reddening survives in scattered light (0..1)
  ambTop: THREE.Color;        // cloud ambient radiance from above
  ambBottom: THREE.Color;     // cloud ambient radiance from below
  cloudDensity: number;
  cloudCoarse: number;
  hazePerMetre: number;
  cirrus: number;             // 0..1 strength
  cirrusAngle: number;        // radians
  stars: number;              // 0..1
  skyFloor: THREE.Color;      // night airglow
  ground: THREE.Color;        // ground hemisphere radiance (env cube)
  sunDisc: number;
}

export interface BakeOptions {
  pos: THREE.Vector3;
  clouds: boolean;
  cloudSteps: number;
  below: boolean;             // paint the ground hemisphere (env cube) instead of clamping to the horizon
  /** Draw the cirrus (default: `clouds`). */
  cirrus?: boolean;
}

/**
 * What a sky cube needs to be shown from somewhere else than where it was baked (SkyDome reprojects it with this).
 * SkyBaker.bake puts it on the cube's `texture.userData.sky` once the bake is complete.
 */
export interface SkyCubeInfo {
  /** Bake position (world, m). */
  pos: THREE.Vector3;
  /** Half-size cube: distance (km) from `pos` to where the cumulus seen in each direction becomes half opaque, 0 = none
   *  (R16F, nearest). */
  depth: THREE.Texture;
  /** Small cube of the clear sky with its cirrus but without cumulus: what is behind a cumulus. */
  clear: THREE.Texture;
}

/** Face size of the clear-sky cube that fills disoccluded sky behind reprojected cumulus. */
const CLEAR_RES = 128;
/** Altitude range (m) the cumulus can occupy: the soft base below CLOUD_BASE up to the billows above CLOUD_TOP. */
export const CLOUD_SLAB: [number, number] = [CLOUD_BASE - CLOUD_BELOW - 10, CLOUD_TOP + CLOUD_ABOVE];

/**
 * When to re-bake the sky cube as the camera moves. The dome reprojects the cube with its depth (SkyDome), so the
 * cumulus keep their true parallax in between; a re-bake only refreshes what the bake point could not see (sky behind
 * a cloud, the far sides of cells). The parallax scale is the camera's clearance to the cumulus slab: travel is
 * compared with it. A long move re-bakes while moving; a short one once the camera has rested for a moment, so a
 * still view always ends up exact.
 */
export class SkyRebakePolicy {
  /** Re-bake while moving once travel exceeds this fraction of the clearance (the reprojection is still clean at ~0.4)... */
  moving = 0.5;
  /** ...and after `restSeconds` at rest once it exceeds this fraction. */
  resting = 0.1;
  restSeconds = 0.35;
  private last = new THREE.Vector3(Infinity, 0, 0);
  private rest = 0;

  /** Distance (m) from `p` to the altitude band the cumulus can occupy (at least 250 m). */
  static clearance(p: THREE.Vector3): number {
    const [lo, hi] = CLOUD_SLAB;
    return Math.max(250, p.y < lo ? lo - p.y : p.y > hi ? p.y - hi : 0);
  }

  /** Call every tick; true when a re-bake at `cam` should start now. */
  due(cam: THREE.Vector3, bakePos: THREE.Vector3, dt: number): boolean {
    if (this.last.distanceToSquared(cam) > 1e-4) { this.rest = 0; this.last.copy(cam); } else this.rest += dt;
    const travel = cam.distanceTo(bakePos);
    const c = SkyRebakePolicy.clearance(cam);
    if (travel > this.moving * c) return true;
    return this.rest >= this.restSeconds && travel > this.resting * c + 2;
  }
}

export interface CloudTextures {
  cover: THREE.Texture;
  shape: THREE.Data3DTexture;
  detail: THREE.Data3DTexture;
}

/** Rows per bake tile: large faces are baked in horizontal strips, one strip per generator step (a background re-bake
 *  advances one step per frame, so this bounds its cost in any one frame). */
const STRIP_ROWS = 128;

export class SkyBaker {
  private mat: THREE.ShaderMaterial;
  private depthMat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private depthScene = new THREE.Scene();
  private aux = new WeakMap<THREE.WebGLCubeRenderTarget, { depth: THREE.WebGLCubeRenderTarget; clear: THREE.WebGLCubeRenderTarget }>();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** Signed-distance volume of the cumulus cells (built once; the layout is fixed). */
  private envelope: THREE.Data3DTexture;

  constructor(private renderer: THREE.WebGLRenderer, tex: CloudTextures, debug = 0) {
    this.envelope = buildEnvelopeVolume();
    const coverRes = (tex.cover.image as { width?: number } | undefined)?.width ?? 2048;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `${common}\n${atmosphere}\n${bakeFrag}`,
      depthTest: false, depthWrite: false,
      uniforms: {
        uDebug: { value: debug }, uHorizonTint: { value: new THREE.Color(1, 1, 1) }, uFace: { value: 0 }, uBakePos: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uCloudSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uE0: { value: new THREE.Color() }, uMsGain: { value: 1 }, uSunLight: { value: new THREE.Color() },
        uAmbTop: { value: new THREE.Color() }, uAmbBottom: { value: new THREE.Color() },
        uCloud: { value: new THREE.Vector4(CLOUD_BASE, CLOUD_TOP, 96, 1) },
        uCirrus: { value: new THREE.Vector4(1, 9200, 0.6, 0) },
        uWeather: { value: new THREE.Vector4(1, 0.9, 2.2e-5, 0) },
        uSkyFloor: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uBelow: { value: 0 },
        uAtmo: { value: new THREE.Vector4(1, 1, 0.8, 1) }, uBetaR: { value: new THREE.Vector3(5.8e-6, 13.5e-6, 33e-6) }, uWarm: { value: 0.55 }, uFar: { value: 60000 },
        uCover: { value: tex.cover }, uNoiseS: { value: tex.shape }, uNoiseD: { value: tex.detail },
        uLook: { value: new THREE.Vector4() }, uAeroH: { value: 1200 }, uAeroPhase: { value: new THREE.Vector2(0.32, 0.2) },
        uCoverInfo: { value: new THREE.Vector4(COVER_EXTENT, COVER_DIN, COVER_DOUT, (2 * COVER_EXTENT) / coverRes) },
        uShape: { value: new THREE.Vector4() }, uShapeScale: { value: new THREE.Vector4() }, uStep: { value: new THREE.Vector4() },
        uShapeW: { value: new THREE.Vector3() },
        uEdge: { value: new THREE.Vector4() }, uBaseShape: { value: new THREE.Vector4() }, uCloudX: { value: new THREE.Vector4() }, uCloudX2: { value: new THREE.Vector4() },
        uGlow: { value: new THREE.Vector4() }, uGlowColor: { value: new THREE.Color() },
        uCloudLit: { value: new THREE.Vector4() }, uCloudPhase: { value: new THREE.Vector4() }, uCloudMs: { value: new THREE.Vector4() },
        uEnv: { value: this.envelope }, uVolInfo: { value: new THREE.Vector4(VOL_EXTENT, VOL_Y0, VOL_LAYERS * VOL_DY, VOL_RANGE) },
        uCirrusLit: { value: new THREE.Vector4() },
        uCirrusPatch: { value: Array.from({ length: 6 }, (_, i) => new THREE.Vector4(...(CIRRUS_PATCHES[i] ?? [0, 0, 1, 0]))) },
        uContrail: { value: new THREE.Vector4(...CONTRAIL) },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
    // depth pass: the same march without lighting (shares every uniform with the colour pass)
    this.depthMat = new THREE.ShaderMaterial({
      vertexShader: this.mat.vertexShader,
      fragmentShader: `#define SKY_DEPTH\n${this.mat.fragmentShader}`,
      depthTest: false, depthWrite: false,
      uniforms: this.mat.uniforms,
    });
    const dq = new THREE.Mesh(quad.geometry, this.depthMat);
    dq.frustumCulled = false;
    this.depthScene.add(dq);
  }

  /** Depth and clear-sky cubes that go with a sky cube (created on its first cumulus bake, freed with it). */
  private auxFor(rt: THREE.WebGLCubeRenderTarget): { depth: THREE.WebGLCubeRenderTarget; clear: THREE.WebGLCubeRenderTarget } {
    let aux = this.aux.get(rt);
    if (aux && aux.depth.width === rt.width / 2) return aux;
    aux?.depth.dispose(); aux?.clear.dispose();
    aux = {
      depth: new THREE.WebGLCubeRenderTarget(rt.width / 2, {
        type: THREE.HalfFloatType, format: THREE.RedFormat, generateMipmaps: false,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false,
      }),
      clear: this.createCube(CLEAR_RES),
    };
    aux.depth.texture.name = 'env.skyDepth'; aux.clear.texture.name = 'env.skyClear';
    this.aux.set(rt, aux);
    const a = aux;
    rt.addEventListener('dispose', () => { a.depth.dispose(); a.clear.dispose(); this.aux.delete(rt); });
    return aux;
  }

  createCube(size: number): THREE.WebGLCubeRenderTarget {
    const rt = new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    return rt;
  }

  private setUniforms(p: SkyParams, o: BakeOptions, size: number): void {
    const u = this.mat.uniforms;
    const L = SKY_LOOK;
    u.uBakePos.value.copy(o.pos);
    u.uSunDir.value.copy(p.sunDir);
    u.uCloudSunDir.value.copy(p.sunDir).lerp(p.cloudSunDir, L.sunLift).normalize();
    u.uE0.value.copy(p.e0); u.uMsGain.value = p.msGain;
    const luma = 0.2126 * p.sunLight.r + 0.7152 * p.sunLight.g + 0.0722 * p.sunLight.b;
    u.uSunLight.value.setRGB(luma, luma, luma).lerp(p.sunLight, L.sunSat);
    if (luma < 1e-3 && p.stars > 0) {
      // night: the moon is the clouds' key light (a faint, slightly blue-white light from high in the west)
      u.uCloudSunDir.value.copy(moonDir());
      u.uSunLight.value.setRGB(0.75, 0.85, 1.0).multiplyScalar(2.6 * L.moonLight * p.stars);
    }
    u.uGlow.value.set(0, L.glowY, 0, L.glow * p.stars);
    u.uGlowColor.value.setRGB(L.glowR, L.glowG, L.glowB);
    u.uAmbTop.value.copy(p.ambTop); u.uAmbBottom.value.copy(p.ambBottom);
    u.uCloud.value.set(CLOUD_BASE, CLOUD_TOP, o.cloudSteps, o.clouds && L.cumulus > 0 ? 1 : 0);
    u.uCirrus.value.set((o.cirrus ?? o.clouds) ? p.cirrus * L.cirrus : 0, L.cirrusAlt, p.cirrusAngle, (Math.PI / 2) / size);
    u.uCirrusLit.value.set(L.cirrusSun, L.cirrusSky, L.cirrusPeak, L.cirrusCover);
    u.uWeather.value.set(p.cloudDensity * L.cumulus, p.cloudCoarse, p.hazePerMetre, p.stars);
    u.uHorizonTint.value.copy(p.horizonTint);
    u.uSkyFloor.value.copy(p.skyFloor); u.uGround.value.copy(p.ground); u.uBelow.value = o.below ? 1 : 0;
    u.uAtmo.value.copy(p.atmo); u.uBetaR.value.copy(p.betaR); u.uWarm.value = p.warmth; u.uFar.value = p.farCap;
    u.uLook.value.set(L.sat, L.satY0, L.satY1, L.tintK);
    u.uAeroH.value = L.aeroH; u.uAeroPhase.value.set(L.aeroFwd, L.aeroBroadG);
    // small cubes (the 128^2 environment cube) march with proportionally longer steps and fewer light samples
    const k = Math.max(1, 1024 / size);
    u.uShape.value.set(L.billow, L.fineBillow, Math.min(k, 3), L.sigma);
    u.uEdge.value.set(L.edge, L.edgeRag, L.erode, L.erodeRag);
    u.uBaseShape.value.set(L.baseSoft, L.baseSoftRag, CLOUD_BELOW, L.flank);
    u.uCloudX.value.set(L.thin, L.farShadow, L.farReach, L.breakup);
    u.uCloudX2.value.set(L.shadowFill, 0, 0, 0);
    u.uShapeScale.value.set(L.shapeTile, L.detailTile, L.baseWander, L.lightStep0);
    const wsum = L.billowW0 + L.billowW1 + L.billowW2;
    u.uShapeW.value.set(L.billowW0 / wsum, L.billowW1 / wsum, L.billowW2 / wsum);
    u.uStep.value.set(L.stepK * k, L.stepMin * k, L.stepMax * k, k > 2 ? Math.min(5, L.lightSteps) : L.lightSteps);
    u.uCloudLit.value.set(L.sunGain, L.skyAmb, L.gndAmb, L.ambDepth);
    u.uCloudPhase.value.set(L.phaseF, L.phaseB, L.phaseBW, L.bounce);
    u.uCloudMs.value.set(L.msA, L.msB, L.msC, L.msOct);
  }

  /**
   * Bake all six faces of `rt`. A generator: faces up to 256 px are one step each, larger faces are split into
   * 256-row strips (one step per strip), so a caller that advances one step per frame never stalls a frame for a whole
   * face. Drive with `for (const _ of bake(...))` for a synchronous bake. Only ONE generator may be in flight at a time
   * (the uniforms are shared), so finish or drop the previous one before starting another.
   * A full-size sky cube with cumulus (not the ground-hemisphere environment cube) also gets a depth cube (baked strip by
   * strip alongside) and a small clear-sky cube; when the bake completes, `rt.texture.userData.sky` (SkyCubeInfo) says
   * where it was baked, so SkyDome can reproject it for a camera elsewhere.
   */
  *bake(rt: THREE.WebGLCubeRenderTarget, p: SkyParams, o: BakeOptions): Generator<number> {
    const size = rt.width;
    const aux = o.clouds && !o.below && size >= 256 && SKY_LOOK.reproject > 0 ? this.auxFor(rt) : null;
    if (!aux) delete rt.texture.userData.sky;
    if (aux) {
      // the clear sky with its cirrus (tiny: done in the first step)
      this.setUniforms(p, { ...o, clouds: false, cirrus: true }, CLEAR_RES);
      for (let f = 0; f < 6; f++) this.renderStrip(aux.clear, this.scene, f, 0, CLEAR_RES, false, f === 5);
    }
    this.setUniforms(p, o, size);
    const strips = Math.max(1, Math.ceil(size / STRIP_ROWS));
    const rows = Math.ceil(size / strips);
    for (let f = 0; f < 6; f++) {
      for (let s = 0; s < strips; s++) {
        const last = f === 5 && s === strips - 1;
        this.renderStrip(rt, this.scene, f, s * rows, rows, strips > 1, last);
        if (aux) this.renderStrip(aux.depth, this.depthScene, f, Math.floor((s * rows) / 2), Math.ceil(rows / 2) + 1, strips > 1, false);
        yield f * strips + s;
      }
    }
    if (aux) rt.texture.userData.sky = { pos: o.pos.clone(), depth: aux.depth.texture, clear: aux.clear.texture } satisfies SkyCubeInfo;
  }

  /** Render rows [y0, y0 + rows) of face `f` of `rt`; the renderer state is saved and restored, so other code may
   *  render between two strips. The mip chain (if any) is built only when `mips` is set (after the last strip). */
  private renderStrip(rt: THREE.WebGLCubeRenderTarget, scene: THREE.Scene, f: number, y0: number, rows: number, scissor: boolean, mips: boolean): void {
    const r = this.renderer;
    const size = rt.width;
    const prevRT = r.getRenderTarget();
    const prevAC = r.autoClear;
    const prevActive = r.getActiveCubeFace();
    const prevXR = r.xr.enabled;
    const gen = rt.texture.generateMipmaps;
    r.xr.enabled = false;
    r.autoClear = false;
    this.mat.uniforms.uFace.value = f;
    rt.scissor.set(0, y0, size, Math.min(rows, size - y0));
    rt.scissorTest = scissor;
    rt.texture.generateMipmaps = gen && mips;
    try {
      r.setRenderTarget(rt, f);
      r.render(scene, this.cam);
    } finally {
      rt.scissorTest = false;
      rt.scissor.set(0, 0, size, size);
      rt.texture.generateMipmaps = gen;
      r.setRenderTarget(prevRT, prevActive);
      r.autoClear = prevAC;
      r.xr.enabled = prevXR;
    }
  }

  dispose(): void { this.mat.dispose(); this.depthMat.dispose(); this.envelope.dispose(); }
}

/**
 * Camera-locked sky dome that displays a baked sky cube. When the cube carries a SkyCubeInfo (texture.userData.sky) and
 * the camera is away from its bake point, the dome REPROJECTS it: each view ray is marched through the cumulus slab
 * against the cube's depth, so the cumulus keep their true parallax (they do not slide with the camera) between two
 * re-bakes; sky uncovered behind a cloud comes from the clear-sky cube.
 */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(cube: THREE.CubeTexture, viewModeUniform: THREE.IUniform<number>) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: domeVert,
      fragmentShader: `${common}\n${atmosphere}\n${domeFrag}`,
      side: THREE.DoubleSide, depthWrite: false, depthTest: true,
      uniforms: {
        uSky: { value: cube }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uE0: { value: new THREE.Color() },
        uCamAlt: { value: 100 }, uSunDisc: { value: 1 }, uViewMode: viewModeUniform,
        uAtmo: { value: new THREE.Vector4(1, 1, 0.8, 1) }, uBetaR: { value: new THREE.Vector3(5.8e-6, 13.5e-6, 33e-6) }, uWarm: { value: 0.55 }, uFar: { value: 60000 },
        uAeroH: { value: 1200 }, uAeroPhase: { value: new THREE.Vector2(0.32, 0.2) },
        uSkyDepth: { value: null }, uSkyClear: { value: null }, uBakePos: { value: new THREE.Vector3() },
        uReproj: { value: new THREE.Vector4(0, CLOUD_SLAB[0], CLOUD_SLAB[1], 0) }, uProj: { value: new THREE.Matrix4() },
        uMoon: { value: new THREE.Vector4() },
      },
    });
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'env.skyDome';
    // the displayed cube can be swapped at any time (background re-bake): follow its bake info at draw time
    this.mesh.onBeforeRender = () => this.syncCube();
    // below-horizon cumulus for a camera inside or above the slab: drawn after the opaque scene at the clouds' own
    // depth, premultiplied (it shares the dome's uniforms; its vertex shader collapses it for a lower camera)
    this.overlayMaterial = new THREE.ShaderMaterial({
      vertexShader: `#define SKY_OVERLAY\n${domeVert}`,
      fragmentShader: `#define SKY_OVERLAY\n${common}\n${atmosphere}\n${domeFrag}`,
      side: THREE.BackSide, depthWrite: false, depthTest: true, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: this.material.uniforms,
    });
    const overlay = new THREE.Mesh(geo, this.overlayMaterial);
    overlay.frustumCulled = false;
    overlay.renderOrder = 10;
    overlay.name = 'env.skyOverlay';
    overlay.onBeforeRender = (_r, _s, camera) => { this.material.uniforms.uProj.value.copy(camera.projectionMatrix); };
    this.mesh.add(overlay);
  }

  readonly overlayMaterial: THREE.ShaderMaterial;

  private syncCube(): void {
    const u = this.material.uniforms;
    const info = (u.uSky.value as THREE.Texture | null)?.userData?.sky as SkyCubeInfo | undefined;
    if (info) {
      u.uSkyDepth.value = info.depth; u.uSkyClear.value = info.clear; u.uBakePos.value.copy(info.pos);
      u.uReproj.value.x = 1;
    } else u.uReproj.value.x = 0;
  }

  setParams(p: SkyParams, camAlt: number): void {
    const u = this.material.uniforms;
    u.uSunDir.value.copy(p.sunDir); u.uE0.value.copy(p.e0); u.uCamAlt.value = camAlt; u.uSunDisc.value = p.sunDisc;
    u.uAtmo.value.copy(p.atmo); u.uBetaR.value.copy(p.betaR); u.uWarm.value = p.warmth; u.uFar.value = p.farCap;
    u.uAeroH.value = SKY_LOOK.aeroH; u.uAeroPhase.value.set(SKY_LOOK.aeroFwd, SKY_LOOK.aeroBroadG);
    const m = moonDir();
    u.uMoon.value.set(m.x, m.y, m.z, p.stars);
  }
}
