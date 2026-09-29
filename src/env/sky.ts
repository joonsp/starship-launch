// Sky bake + dome. The sky (single-scatter atmosphere), cirrus and raymarched background cumulus are baked into a
// HalfFloat cubemap once per lighting preset (the scene is frozen) and displayed on a camera-locked dome.
import * as THREE from 'three';
import common from '../shaders/common.glsl?raw';
import atmosphere from './glsl/atmosphere.glsl?raw';
import bakeFrag from './glsl/sky_bake.frag.glsl?raw';
import domeVert from './glsl/sky_dome.vert.glsl?raw';
import domeFrag from './glsl/sky_dome.frag.glsl?raw';
import {
  CIRRUS_PATCHES, CLOUD_BASE, CLOUD_TOP, CONTRAIL, COVER_DIN, COVER_DOUT, COVER_EXTENT, VOL_DY, VOL_EXTENT, VOL_LAYERS, VOL_RANGE, VOL_Y0,
  buildEnvelopeVolume,
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
  /** Edge softness (m): the displaced surface ramps to full density over this distance. */
  edge: 8,
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
};

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
}

export interface CloudTextures {
  cover: THREE.Texture;
  shape: THREE.Data3DTexture;
  detail: THREE.Data3DTexture;
}

/** Rows per bake tile: large faces are baked in horizontal strips, one strip per generator step. */
const STRIP_ROWS = 256;

export class SkyBaker {
  private mat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
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
    u.uAmbTop.value.copy(p.ambTop); u.uAmbBottom.value.copy(p.ambBottom);
    u.uCloud.value.set(CLOUD_BASE, CLOUD_TOP, o.cloudSteps, o.clouds && L.cumulus > 0 ? 1 : 0);
    u.uCirrus.value.set(o.clouds ? p.cirrus * L.cirrus : 0, L.cirrusAlt, p.cirrusAngle, (Math.PI / 2) / size);
    u.uCirrusLit.value.set(L.cirrusSun, L.cirrusSky, L.cirrusPeak, L.cirrusCover);
    u.uWeather.value.set(p.cloudDensity * L.cumulus, p.cloudCoarse, p.hazePerMetre, p.stars);
    u.uHorizonTint.value.copy(p.horizonTint);
    u.uSkyFloor.value.copy(p.skyFloor); u.uGround.value.copy(p.ground); u.uBelow.value = o.below ? 1 : 0;
    u.uAtmo.value.copy(p.atmo); u.uBetaR.value.copy(p.betaR); u.uWarm.value = p.warmth; u.uFar.value = p.farCap;
    u.uLook.value.set(L.sat, L.satY0, L.satY1, L.tintK);
    u.uAeroH.value = L.aeroH; u.uAeroPhase.value.set(L.aeroFwd, L.aeroBroadG);
    // small cubes (the 128^2 environment cube) march with proportionally longer steps and fewer light samples
    const k = Math.max(1, 1024 / size);
    u.uShape.value.set(L.billow, L.fineBillow, L.edge * Math.min(k, 3), L.sigma);
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
   */
  *bake(rt: THREE.WebGLCubeRenderTarget, p: SkyParams, o: BakeOptions): Generator<number> {
    const r = this.renderer;
    const size = rt.width;
    this.setUniforms(p, o, size);
    const strips = Math.max(1, Math.ceil(size / STRIP_ROWS));
    const rows = Math.ceil(size / strips);
    const mips = rt.texture.generateMipmaps;
    for (let f = 0; f < 6; f++) {
      for (let s = 0; s < strips; s++) {
        // Renderer state is saved/restored around every strip, so other code may render between two yields.
        const prevRT = r.getRenderTarget();
        const prevAC = r.autoClear;
        const prevActive = r.getActiveCubeFace();
        const prevXR = r.xr.enabled;
        r.xr.enabled = false;
        r.autoClear = false;
        this.mat.uniforms.uFace.value = f;
        const y0 = s * rows;
        rt.scissor.set(0, y0, size, Math.min(rows, size - y0));
        rt.scissorTest = strips > 1;
        // the mip chain is built once, after the very last strip
        rt.texture.generateMipmaps = mips && f === 5 && s === strips - 1;
        try {
          r.setRenderTarget(rt, f);
          r.render(this.scene, this.cam);
        } finally {
          rt.scissorTest = false;
          rt.scissor.set(0, 0, size, size);
          rt.texture.generateMipmaps = mips;
          r.setRenderTarget(prevRT, prevActive);
          r.autoClear = prevAC;
          r.xr.enabled = prevXR;
        }
        yield f * strips + s;
      }
    }
  }

  dispose(): void { this.mat.dispose(); this.envelope.dispose(); }
}

/** Camera-locked sky dome that displays a baked sky cube. */
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
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'env.skyDome';
  }

  setParams(p: SkyParams, camAlt: number): void {
    const u = this.material.uniforms;
    u.uSunDir.value.copy(p.sunDir); u.uE0.value.copy(p.e0); u.uCamAlt.value = camAlt; u.uSunDisc.value = p.sunDisc;
    u.uAtmo.value.copy(p.atmo); u.uBetaR.value.copy(p.betaR); u.uWarm.value = p.warmth; u.uFar.value = p.farCap;
    u.uAeroH.value = SKY_LOOK.aeroH; u.uAeroPhase.value.set(SKY_LOOK.aeroFwd, SKY_LOOK.aeroBroadG);
  }
}
