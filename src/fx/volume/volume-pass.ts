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
import * as THREE from 'three';
import { Pass } from 'postprocessing';
import common from '../../shaders/common.glsl?raw';
import type { AppContext } from '../../contracts.ts';
import vertFullscreen from './shaders/fullscreen.vert.glsl?raw';
import fragMarch from './shaders/march.frag.glsl?raw';
import fragScatter from './shaders/scatter.frag.glsl?raw';
import fragComposite from './shaders/composite.frag.glsl?raw';
import fragViewComposite from './shaders/view-composite.frag.glsl?raw';
import { OCC_BLOCK, type VolumeBaker } from './bakes.ts';
import { DEFAULT_PARAMS, TEMP_KELVIN_MAX, TEMP_KELVIN_MIN, type VolumeParams } from './params.ts';

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
  stochAmp = 0.35;
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
  private readonly viewCompMat: THREE.ShaderMaterial;
  private viewRT: THREE.WebGLRenderTarget | null = null;
  private readonly orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private frame = 0;

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
      uSunTauScale: { value: 1 }, uShapeP: V3(), uDetailP: V3(), uNearFade: { value: params.nearFade },
      uViewMode: { value: 0 }, uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0 },
      uDriftOffset: V3(), uGrowth: { value: new THREE.Vector3(1, 1, 1) },
      uTempRange: { value: new THREE.Vector2(TEMP_KELVIN_MIN, TEMP_KELVIN_MAX) },
      uRedden: { value: new THREE.Vector4() }, uDust: { value: new THREE.Vector4(1, 1, 1, 40) }, uSkyOcc: { value: params.skyOcclusion }, uNormalAmb: { value: params.normalAmbient }, uSunDiff: { value: new THREE.Vector2() },
    };
    const perView = () => ({
      uDepth: { value: null as THREE.Texture | null }, uPlume: { value: null as THREE.Texture | null },
      uCamMatrixWorld: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() },
      uCamPos: V3(), uNear: { value: 0.5 }, uFar: { value: 60000 },
      uFullRes: { value: new THREE.Vector2(1, 1) }, uLowRes: { value: new THREE.Vector2(1, 1) },
      uJitter: { value: new THREE.Vector2(0.5, 0.5) }, uFrame: { value: 0 }, uVisit: { value: 0 }, uSteps: { value: 96 },
      uHasDepth: { value: 0 }, uHasPlume: { value: 0 },
    });
    this.marchMat = screenMaterial(fragMarch, { ...this.shared, ...perView() });
    this.viewMarchMat = screenMaterial(fragMarch, { ...this.shared, ...perView() });
    this.scatterMat = screenMaterial(fragScatter, {
      uCur0: { value: this.cur.textures[0] }, uCur1: { value: this.cur.textures[1] },
      uLowRes: { value: new THREE.Vector2(1, 1) }, uFullRes: { value: new THREE.Vector2(1, 1) }, uJitter: { value: this.jitter },
    }, {
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendEquationAlpha: THREE.AddEquation,
      blendSrc: THREE.ConstantAlphaFactor, blendDst: THREE.OneMinusConstantAlphaFactor,
      blendSrcAlpha: THREE.ConstantAlphaFactor, blendDstAlpha: THREE.OneMinusConstantAlphaFactor,
    });
    this.clearMat = screenMaterial('layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; void main() { o0 = vec4(0.0); o1 = vec4(0.0); }', {});
    this.compMat = screenMaterial(fragComposite, {
      uColor: { value: null }, uDepth: { value: null }, uPlume: { value: null },
      uAcc0: { value: this.acc.textures[0] }, uAcc1: { value: this.acc.textures[1] },
      uVol0: { value: this.black }, uVol1: { value: this.black },
      uLowRes: { value: new THREE.Vector2(1, 1) }, uFullRes: { value: new THREE.Vector2(1, 1) }, uJitter: { value: this.jitter },
      uNear: { value: 0.5 }, uFar: { value: 60000 }, uUseAcc: { value: 0 },
      uHasDepth: { value: 0 }, uHasPlume: { value: 0 }, uDebug: { value: 0 },
    });
    this.viewCompMat = screenMaterial(fragViewComposite, { uVol0: { value: null } }, {
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
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
  }

  /** True once the still image has converged (the march is skipped from then on). */
  get converged(): boolean {
    return this.accumulated >= this.params.maxFrames && (this.ctx?.globals.uDrift.value ?? 0) === 0;
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
    u.uNearFade.value = p.nearFade;
    u.uRedden.value.set(p.reddenR, p.reddenG, p.reddenB, p.reddenHaze);
    u.uDust.value.set(p.dustR, p.dustG, p.dustB, Math.max(1, p.dustHeight));
    u.uSkyOcc.value = p.skyOcclusion;
    u.uNormalAmb.value = p.normalAmbient;
    u.uSunDiff.value.set(p.sunDiffuse, p.sunAbsorb);
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
      if (!this.converged) {
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
  }

  /**
   * Low-quality volume for an arbitrary view (planar reflections). Call after the view's opaque scene
   * has been rendered into `target` (which should carry a depthTexture). Marches at `scale` of the
   * target size with `steps` steps and no accumulation, then blends dst = L + dst * T into target.
   */
  renderView(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, target: THREE.WebGLRenderTarget, opts: { scale?: number; steps?: number } = {}): void {
    if (!this.ctx || !this.baker?.density || !this.baker.light) return;
    const scale = opts.scale ?? 0.25, steps = opts.steps ?? 40;
    const w = Math.max(1, Math.round(target.width * scale)), h = Math.max(1, Math.round(target.height * scale));
    if (!this.viewRT) {
      this.viewRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    } else if (this.viewRT.width !== w || this.viewRT.height !== h) this.viewRT.setSize(w, h);
    this.syncShared();
    const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    const m = this.viewMarchMat;
    this.setViewUniforms(m, camera, target.width, target.height, w, h, target.depthTexture ?? null, null);
    m.uniforms.uJitter.value.set(0.5, 0.5);
    m.uniforms.uFrame.value = this.frame;
    m.uniforms.uVisit.value = this.frame;
    m.uniforms.uSteps.value = steps;
    this.mesh.material = m;
    renderer.setRenderTarget(this.viewRT);
    renderer.render(this.scene, this.orthoCam);
    this.viewCompMat.uniforms.uVol0.value = this.viewRT.texture;
    this.mesh.material = this.viewCompMat;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.orthoCam);
    this.mesh.material = this.compMat;
    renderer.setRenderTarget(prevRT);
    renderer.autoClear = prevAuto;
  }

  override dispose(): void {
    this.cur.dispose();
    this.acc.dispose();
    this.viewRT?.dispose();
    this.black.dispose();
    for (const m of [this.marchMat, this.scatterMat, this.clearMat, this.compMat, this.viewMarchMat, this.viewCompMat]) m.dispose();
    super.dispose();
  }
}
