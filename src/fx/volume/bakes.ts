// GPU bakes for the launch-cloud volume. OWNER: volume module.
// Everything the frozen scene allows is baked once into 3D render targets, layer by layer with
// renderer.setRenderTarget(rt, layer) (verified in r186: the 2nd argument selects the z layer via
// framebufferTextureLayer, also for multi-attachment 3D targets):
//   shape    128^3 RGBA8   tileable Perlin-Worley + Worley octaves          (never rebaked)
//   detail    32^3 RGBA8   tileable Worley octaves + Perlin                   (never rebaked)
//   density  res   RG16F   R = puff density, G = temperature                  (quality change)
//   occupancy res/8 R8     max density per block, for empty-space skipping   (with density)
//   light    res/2 2x RGBA16F  sun optical depth, plume/fire irradiance, sky/ground visibility
//                                                                        (preset / plume axis / sigma)
// Bakes are generators: each `yield` marks a cheap point to pause, so the module can time-slice a
// rebake over several frames (no hitch) while the previous textures stay in use until the swap.
import * as THREE from 'three';
import { type Puff, packPuffs } from './puffs.ts';
import vertFullscreen from './shaders/fullscreen.vert.glsl?raw';
import noiseLib from './shaders/noise.glsl?raw';
import fragNoiseShape from './shaders/noise-shape.frag.glsl?raw';
import fragNoiseDetail from './shaders/noise-detail.frag.glsl?raw';
import vertSplat from './shaders/splat.vert.glsl?raw';
import fragSplat from './shaders/splat.frag.glsl?raw';
import fragFinalize from './shaders/finalize.frag.glsl?raw';
import fragOccupancy from './shaders/occupancy.frag.glsl?raw';
import fragLight from './shaders/light.frag.glsl?raw';

export const OCC_BLOCK = 4;
/** Rising steam mixes with air: density x mix(1, z, smoothstep(x, y, height)) in the bake (the march undoes it to erode). */
export const DILUTION = new THREE.Vector3(110, 360, 0.5);

export interface LightBakeInputs {
  sunDir: THREE.Vector3;          // toward the sun
  sigma: number;                  // 1/m
  /** Similarity-reduced extinction factor (1 - g-ish) for the fire/plume light transport. */
  fireTauScale: number;
  plumeA: THREE.Vector3;
  plumeB: THREE.Vector3;
  fires: { c: [number, number, number]; r: number; w: number }[];
  plumeSamples: number;
  segSteps: number;
}

function make3D(w: number, h: number, d: number, o: { format?: THREE.PixelFormat; type?: THREE.TextureDataType; filter?: THREE.MagnificationTextureFilter; repeat?: boolean; count?: number } = {}): THREE.WebGL3DRenderTarget {
  const rt = new THREE.WebGL3DRenderTarget(w, h, d, {
    format: o.format ?? THREE.RGBAFormat,
    type: o.type ?? THREE.HalfFloatType,
    minFilter: o.filter ?? THREE.LinearFilter,
    magFilter: o.filter ?? THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    count: o.count ?? 1,
  });
  const wrap = o.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  for (const t of rt.textures) { t.wrapS = t.wrapT = t.wrapR = wrap; t.generateMipmaps = false; }
  return rt;
}

function mat(frag: string, uniforms: Record<string, THREE.IUniform>, extra: Partial<THREE.ShaderMaterialParameters> = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: vertFullscreen,
    fragmentShader: frag.replace('#include <vn_noise>', noiseLib),
    uniforms,
    depthTest: false,
    depthWrite: false,
    ...extra,
  });
}

export class VolumeBaker {
  readonly box: THREE.Box3;
  readonly shape: THREE.WebGL3DRenderTarget;
  readonly detail: THREE.WebGL3DRenderTarget;
  density: THREE.WebGL3DRenderTarget | null = null;
  occupancy: THREE.WebGL3DRenderTarget | null = null;
  light: THREE.WebGL3DRenderTarget | null = null;
  densityRes: [number, number, number] = [0, 0, 0];
  /** Light volume resolution divisor relative to the density (2 = half res per axis). */
  lightDiv = 2;
  lightFilter: THREE.MagnificationTextureFilter = THREE.LinearFilter;
  /** Seconds spent in the last bakes (CPU submit time; GPU work is asynchronous). */
  timings: Record<string, number> = {};

  private readonly renderer: THREE.WebGLRenderer;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly splatScene = new THREE.Scene();
  private splatMesh: THREE.Mesh | null = null;

  private readonly mShape: THREE.ShaderMaterial;
  private readonly mDetail: THREE.ShaderMaterial;
  private readonly mClear: THREE.ShaderMaterial;
  private readonly mSplat: THREE.ShaderMaterial;
  private readonly mFinal: THREE.ShaderMaterial;
  private readonly mOcc: THREE.ShaderMaterial;
  private readonly mLight: THREE.ShaderMaterial;

  constructor(renderer: THREE.WebGLRenderer, box: THREE.Box3) {
    this.renderer = renderer;
    this.box = box.clone();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.shape = make3D(128, 128, 128, { type: THREE.UnsignedByteType, repeat: true });
    this.detail = make3D(32, 32, 32, { type: THREE.UnsignedByteType, repeat: true });

    const boxMin = { value: this.box.min.clone() };
    const boxSize = { value: this.box.getSize(new THREE.Vector3()) };
    this.mShape = mat(fragNoiseShape, { uZ: { value: 0 } });
    this.mDetail = mat(fragNoiseDetail, { uZ: { value: 0 } });
    this.mClear = mat('layout(location = 0) out vec4 o; void main() { o = vec4(1.0, 1.0, 1.0, 0.0); }', {});
    this.mSplat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertSplat,
      fragmentShader: fragSplat,
      uniforms: { uBoxMin: boxMin, uBoxSize: boxSize, uLayerZ: { value: 0 }, uVoxel: { value: 1 }, uShape: { value: this.shape.texture } },
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.OneMinusSrcColorFactor,
      blendEquationAlpha: THREE.MaxEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mFinal = mat(fragFinalize, { uSplat: { value: null }, uLayer: { value: 0 }, uRes: { value: new THREE.Vector3() }, uBoxMin: boxMin, uBoxSize: boxSize, uFaceFade: { value: 14 }, uDilution: { value: DILUTION } });
    this.mOcc = mat(fragOccupancy, { uDensity: { value: null }, uLayer: { value: 0 }, uBlock: { value: OCC_BLOCK } });
    this.mLight = mat(fragLight, {
      uDensity: { value: null }, uLayer: { value: 0 }, uRes: { value: new THREE.Vector3() },
      uBoxMin: boxMin, uBoxSize: boxSize, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSigma: { value: 0.1 }, uBakeScale: { value: 0.72 },
      uPlumeA: { value: new THREE.Vector3() }, uPlumeB: { value: new THREE.Vector3() },
      uFire: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) },
      uFireW: { value: new Array(16).fill(0) }, uFireN: { value: 0 },
      uPlumeN: { value: 10 }, uSegSteps: { value: 12 }, uFireTauScale: { value: 0.3 },
    });
  }

  /** Render `material` into one layer of a 3D target (no clear; bakes overwrite every texel). */
  private layer(rt: THREE.WebGL3DRenderTarget, z: number, material: THREE.Material, scene?: THREE.Scene): void {
    if (!scene) this.quad.material = material;
    this.renderer.setRenderTarget(rt, z);
    this.renderer.render(scene ?? this.quadScene, this.cam);
  }

  private begin(): { rt: THREE.WebGLRenderTarget | null; auto: boolean; face: number; mip: number } {
    const r = this.renderer;
    const s = { rt: r.getRenderTarget(), auto: r.autoClear, face: r.getActiveCubeFace(), mip: r.getActiveMipmapLevel() };
    r.autoClear = false;
    return s;
  }
  private end(s: { rt: THREE.WebGLRenderTarget | null; auto: boolean; face: number; mip: number }): void {
    this.renderer.setRenderTarget(s.rt, s.face, s.mip);
    this.renderer.autoClear = s.auto;
  }

  /** Tileable shape (128^3) and detail (32^3) noise. */
  *noiseJob(): Generator<void> {
    const t0 = performance.now();
    for (const [rt, m, n] of [[this.shape, this.mShape, 128], [this.detail, this.mDetail, 32]] as const) {
      for (let z = 0; z < n; z++) {
        const s = this.begin();
        m.uniforms.uZ.value = (z + 0.5) / n;
        this.layer(rt, z, m);
        this.end(s);
        if ((z & 7) === 7) yield;
      }
    }
    this.timings.noise = (performance.now() - t0) / 1000;
  }

  /**
   * Density (RG16F) + occupancy (R8) from the puff list, at resolution `res` inside the box.
   * The new targets replace the old ones only when complete.
   */
  *densityJob(res: [number, number, number], puffs: Puff[]): Generator<void> {
    const t0 = performance.now();
    const [W, H, D] = res;
    const size = this.box.getSize(new THREE.Vector3());
    const splat = make3D(W, H, D, { type: THREE.HalfFloatType });
    const dens = make3D(W, H, D, { format: THREE.RGFormat, type: THREE.HalfFloatType });

    // instanced splat geometry (rebuilt per job; ~4k instances)
    const { a, b } = packPuffs(puffs);
    const base = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('aPuffA', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aPuffB', new THREE.InstancedBufferAttribute(b, 4));
    g.instanceCount = puffs.length;
    if (this.splatMesh) { this.splatScene.remove(this.splatMesh); this.splatMesh.geometry.dispose(); }
    this.splatMesh = new THREE.Mesh(g, this.mSplat);
    this.splatMesh.frustumCulled = false;
    this.splatScene.add(this.splatMesh);
    this.mSplat.uniforms.uVoxel.value = Math.max(size.x / W, size.y / H, size.z / D) * 0.5;

    this.mFinal.uniforms.uSplat.value = splat.texture;
    this.mFinal.uniforms.uRes.value.set(W, H, D);
    for (let z = 0; z < D; z++) {
      const s = this.begin();
      this.layer(splat, z, this.mClear);
      this.mSplat.uniforms.uLayerZ.value = this.box.min.z + ((z + 0.5) / D) * size.z;
      this.layer(splat, z, this.mSplat, this.splatScene);
      this.end(s);
      if ((z & 7) === 7) yield;
    }
    for (let z = 0; z < D; z++) {
      const s = this.begin();
      this.mFinal.uniforms.uLayer.value = z;
      this.layer(dens, z, this.mFinal);
      this.end(s);
      if ((z & 15) === 15) yield;
    }
    splat.dispose();

    const O = [Math.ceil(W / OCC_BLOCK), Math.ceil(H / OCC_BLOCK), Math.ceil(D / OCC_BLOCK)];
    const occ = make3D(O[0], O[1], O[2], { format: THREE.RedFormat, type: THREE.UnsignedByteType, filter: THREE.NearestFilter });
    this.mOcc.uniforms.uDensity.value = dens.texture;
    for (let z = 0; z < O[2]; z++) {
      const s = this.begin();
      this.mOcc.uniforms.uLayer.value = z;
      this.layer(occ, z, this.mOcc);
      this.end(s);
    }
    yield;
    this.density?.dispose();
    this.occupancy?.dispose();
    this.density = dens;
    this.occupancy = occ;
    this.densityRes = [W, H, D];
    this.timings.density = (performance.now() - t0) / 1000;
  }

  /** Light volume (2 x RGBA16F at half the density resolution). Swaps in when complete. */
  *lightJob(inp: LightBakeInputs): Generator<void> {
    if (!this.density) return;
    const t0 = performance.now();
    const [W, H, D] = this.densityRes.map((v) => Math.max(8, Math.ceil(v / this.lightDiv))) as [number, number, number];
    const rt = make3D(W, H, D, { type: THREE.HalfFloatType, count: 2, filter: this.lightFilter });
    const u = this.mLight.uniforms;
    u.uDensity.value = this.density.texture;
    u.uRes.value.set(W, H, D);
    u.uSunDir.value.copy(inp.sunDir).normalize();
    u.uSigma.value = inp.sigma;
    u.uFireTauScale.value = inp.fireTauScale;
    u.uPlumeA.value.copy(inp.plumeA);
    u.uPlumeB.value.copy(inp.plumeB);
    u.uPlumeN.value = inp.plumeSamples;
    u.uSegSteps.value = inp.segSteps;
    const fires = inp.fires.slice(0, 16);
    fires.forEach((f, i) => { (u.uFire.value as THREE.Vector4[])[i].set(f.c[0], f.c[1], f.c[2], f.r); (u.uFireW.value as number[])[i] = f.w; });
    u.uFireN.value = fires.length;
    for (let z = 0; z < D; z++) {
      const s = this.begin();
      u.uLayer.value = z;
      this.layer(rt, z, this.mLight);
      this.end(s);
      if ((z & 3) === 3) yield;
    }
    this.light?.dispose();
    this.light = rt;
    this.timings.light = (performance.now() - t0) / 1000;
  }

  dispose(): void {
    this.shape.dispose(); this.detail.dispose();
    this.density?.dispose(); this.occupancy?.dispose(); this.light?.dispose();
    this.splatMesh?.geometry.dispose();
    this.quad.geometry.dispose();
    for (const m of [this.mShape, this.mDetail, this.mClear, this.mSplat, this.mFinal, this.mOcc, this.mLight]) m.dispose();
  }
}

/** Run a bake generator to completion, yielding to the event loop every `chunk` steps. */
export async function runJob(job: Generator<void>, chunk = 4): Promise<void> {
  let n = 0;
  for (let r = job.next(); !r.done; r = job.next()) {
    if (++n % chunk === 0) await new Promise<void>((res) => setTimeout(res, 0));
  }
}
