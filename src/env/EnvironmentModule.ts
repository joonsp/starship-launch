// ENVIRONMENT module: sky, background cumulus/cirrus, terrain, tidal pools, ocean, OSM surroundings.
// See the header of each sibling file for details. Public surface:
//   new EnvironmentModule(opts?) -> init(ctx) -> update(dt, t) / onPreset(p) / onQuality(q) -> environmentScene()
import * as THREE from 'three';
import type { AppContext, LightingPreset, Module, QualitySettings } from '../contracts.ts';
import { makeCellNoise, makeCloudDetailNoise, makeCloudShapeNoise, makeNoise2D, makeWaveSlopes } from './noise.ts';
import { loadSite, type SiteData } from './site-data.ts';
import { buildSplats, disposeSplats, type SplatSet } from './splat.ts';
import { Terrain } from './terrain.ts';
import { Ocean } from './ocean.ts';
import { PlanarReflection } from './reflection.ts';
import { Roads } from './roads.ts';
import { Buildings } from './buildings.ts';
import { Vegetation } from './vegetation.ts';
import { buildCoverTexture } from './cloud-layout.ts';
import { SkyBaker, SkyDome, SkyRebakePolicy, type SkyParams } from './sky.ts';

export interface EnvironmentOptions {
  /** Sandbox pages have a no-op ctx.renderView; set this so the planar reflection renders through renderer.render. */
  sandboxReflection?: boolean;
  /** Override the sky cube face size (sandbox uses ~512 because SwiftShader is slow). */
  bakeRes?: number;
  /** Skip parts while developing: 'sky' | 'terrain' | 'ocean' | 'osm'. Default all. */
  parts?: string[];
  /** Dev: 1 = noise, 2 = coverage map, 3 = cloud density painted on the sky instead of the sky. */
  debugSky?: number;
}

const BAKE_RES: Record<QualitySettings['id'], number> = { low: 768, medium: 1024, high: 1536, ultra: 2048 };
const ENV_CUBE_RES = 128;
const HAZE_CUBE_RES = 64;
const SPLAT_RES: Record<QualitySettings['id'], number> = { low: 2048, medium: 3072, high: 4096, ultra: 4096 };

export class EnvironmentModule implements Module {
  readonly name = 'env';
  /** True once the first full sky bake has finished. */
  bakeDone = false;

  private ctx!: AppContext;
  private opts: EnvironmentOptions;
  readonly root = new THREE.Group();
  private baker!: SkyBaker;
  private cube!: THREE.WebGLCubeRenderTarget;      // full-quality sky cube for the dome
  private hazeCube!: THREE.WebGLCubeRenderTarget;   // 64^2 cloud-free sky for aerial perspective
  private envCube!: THREE.WebGLCubeRenderTarget;   // 128^2 cube (with ground hemisphere) for the PMREM environment scene
  private dome!: SkyDome;
  private envDome!: SkyDome;
  private spare?: THREE.WebGLCubeRenderTarget;     // second full-size cube: baked in the background, then swapped in
  private skyJob: Generator<number> | null = null;
  private skyJobTarget?: THREE.WebGLCubeRenderTarget;
  private envScene = new THREE.Scene();
  private bakePos = new THREE.Vector3(1e9, 0, 0);
  /** When to re-bake the sky as the camera moves (the dome reprojects the cube in between; see sky.ts). */
  private rebake = new SkyRebakePolicy();
  private skyParams!: SkyParams;
  private site: SiteData = { features: [] };
  private splats?: SplatSet;
  private noise2D!: THREE.DataTexture;
  private cellNoise!: THREE.DataTexture;
  private waveSlopes!: THREE.DataTexture;
  terrain?: Terrain;
  ocean?: Ocean;
  roads?: Roads;
  buildings?: Buildings;
  vegetation?: Vegetation;
  private refl = new PlanarReflection();
  private reflCamM = new THREE.Matrix4();
  private reflProj = new THREE.Matrix4();
  private reflDirty = true;
  private reflOn = false;
  cloudTex!: { cover: THREE.Texture; shape: THREE.Data3DTexture; detail: THREE.Data3DTexture };

  constructor(opts: EnvironmentOptions = {}) { this.opts = opts; }

  private has(part: string): boolean { return !this.opts.parts || this.opts.parts.includes(part); }

  async init(ctx: AppContext): Promise<void> {
    this.ctx = ctx;
    this.root.name = 'env';
    ctx.scene.add(this.root);

    this.site = await loadSite();
    this.noise2D = makeNoise2D(512);
    this.cellNoise = makeCellNoise(256);
    this.waveSlopes = makeWaveSlopes(512);
    this.cloudTex = { cover: buildCoverTexture(1024), shape: makeCloudShapeNoise(64), detail: makeCloudDetailNoise(32) };
    this.baker = new SkyBaker(ctx.renderer, this.cloudTex, this.opts.debugSky ?? 0);
    this.cube = this.baker.createCube(this.bakeSize(ctx.quality));
    this.envCube = this.baker.createCube(ENV_CUBE_RES);
    this.hazeCube = this.baker.createCube(HAZE_CUBE_RES);
    this.dome = new SkyDome(this.cube.texture as unknown as THREE.CubeTexture, ctx.globals.uViewMode);
    this.envDome = new SkyDome(this.envCube.texture as unknown as THREE.CubeTexture, ctx.globals.uViewMode);
    this.envDome.material.uniforms.uSunDisc.value = 0;
    this.envScene.add(this.envDome.mesh);
    if (this.has('sky')) this.root.add(this.dome.mesh);

    this.skyParams = presetToSky(ctx.preset);
    this.bakePos.copy(ctx.camera.position);
    if (ctx.camera.position.lengthSq() < 1) this.bakePos.copy(ctx.anchors.photoCamera.pos);
    this.bakeEnvCube();
    this.bakeHazeCube();
    await this.bakeSkyProgressive();
    this.applySkyUniforms();

    if (this.has('terrain') || this.has('ocean')) {
      this.splats = buildSplats(this.site, SPLAT_RES[ctx.quality.id]);
      const sky = this.cube.texture;
      this.terrain = new Terrain(ctx.globals, this.site, this.splats, this.noise2D, this.cellNoise, this.waveSlopes, sky, this.hazeCube.texture);
      if (this.has('terrain')) this.root.add(this.terrain.mesh);
      if (this.has('terrain')) {
        this.vegetation = new Vegetation(ctx.globals);
        this.vegetation.setSplatCanvas(this.splats.innerA.image as HTMLCanvasElement);
        this.root.add(this.vegetation.mesh);
      }
      this.ocean = new Ocean(ctx.globals, this.site, this.terrain.coastTex, this.noise2D, this.waveSlopes, sky, this.hazeCube.texture);
      if (this.has('ocean')) this.root.add(this.ocean.mesh);
    }
    if (this.has('osm')) {
      this.roads = new Roads(ctx.globals, this.site, this.noise2D, this.hazeCube.texture);
      if (this.roads.mesh) this.root.add(this.roads.mesh);
      this.buildings = new Buildings(ctx.globals, this.site);
      this.root.add(this.buildings.group);
    }
    this.applyBounce(ctx.preset);
    this.reflDirty = true;
  }

  update(dt: number, _t: number): void {
    this.terrain?.follow(this.ctx.camera.position);
    this.vegetation?.update(this.ctx.camera.position);
    this.updateReflection();
    // Re-bake the sky when the camera has moved far enough from the bake point that the reprojected cube would show
    // disocclusions (SkyRebakePolicy): one strip per frame into the spare cube, swapped in when all six faces are done,
    // so there is never a frame-time spike.
    const cam = this.ctx.camera.position;
    if (this.bakeDone && !this.skyJob && this.rebake.due(cam, this.bakePos, dt)) {
      this.bakePos.copy(cam);
      this.startSkyJob();
    }
    this.stepSkyJob();
  }

  onPreset(p: LightingPreset): void {
    this.skyParams = presetToSky(p);
    this.bakeEnvCube();
    this.bakeHazeCube();
    this.bakeSkyNow();
    this.applySkyUniforms();
    this.applyBounce(p);
    this.reflDirty = true;
  }

  private applyBounce(p: LightingPreset): void {
    // warm fill from the orange steam banks (they are lit by sun + fireball); scaled by the preset's plume light scale
    const nightK = THREE.MathUtils.smoothstep(-p.sun.dir.y, 0.04, 0.30);
    const k = 0.5 * p.plumeLightScale * (1 - 0.88 * nightK);
    this.terrain?.setBounce(new THREE.Color(1.0, 0.56, 0.28).multiplyScalar(k), 650);
  }

  onQuality(q: QualitySettings): void {
    // The sky cube size follows the quality; resize by recreating (WebGLCubeRenderTarget.setSize does not refresh the
    // six face descriptors) and re-point every user of the texture.
    const size = this.bakeSize(q);
    if (size !== this.cube.width) {
      this.skyJob = null;
      const old = this.cube;
      this.cube = this.baker.createCube(size);
      this.bakeSkyNow();
      old.dispose();
      this.spare?.dispose(); this.spare = undefined;
    } else {
      this.bakeSkyNow();
    }
    if (this.splats && this.terrain) {
      disposeSplats(this.splats);
      this.splats = buildSplats(this.site, SPLAT_RES[q.id]);
      this.terrain.setSplats(this.splats);
      this.vegetation?.setSplatCanvas(this.splats.innerA.image as HTMLCanvasElement);
    }
    this.reflDirty = true;
  }

  /** Cheap scene (sky dome sampling a 128^2 cube incl. ground hemisphere) for core's PMREM environment map. */
  environmentScene(): THREE.Scene { return this.envScene; }

  /** Dev/QA helper: read the baked sky radiance (linear rgb + cloud alpha) for world directions. */
  sampleSky(dirs: Array<[number, number, number]>, lod = 0): number[][] {
    const r = this.ctx.renderer;
    const n = dirs.length;
    const rt = new THREE.WebGLRenderTarget(n, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
    const arr = dirs.map((d) => new THREE.Vector3(...d).normalize());
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCube: { value: this.cube.texture }, uDirs: { value: arr } },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform samplerCube uCube; uniform vec3 uDirs[${n}];
        void main(){ int i = int(gl_FragCoord.x); vec3 d = vec3(0.0); for (int k=0;k<${n};k++) if (k==i) d = uDirs[k]; gl_FragColor = textureLod(uCube, normalize(d), ${lod.toFixed(1)}); }`,
    });
    const scene = new THREE.Scene(); const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false; scene.add(quad);
    const prev = r.getRenderTarget();
    r.setRenderTarget(rt); r.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    const buf = new Float32Array(n * 4);
    r.readRenderTargetPixels(rt, 0, 0, n, 1, buf);
    r.setRenderTarget(prev);
    rt.dispose(); mat.dispose();
    return dirs.map((_, i) => [buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2], buf[i * 4 + 3]]);
  }

  dispose(): void {
    this.ctx.scene.remove(this.root);
    this.baker.dispose();
    this.terrain?.dispose(); this.ocean?.dispose(); this.roads?.dispose(); this.buildings?.dispose(); this.vegetation?.dispose(); this.refl.dispose();
    if (this.splats) disposeSplats(this.splats);
    this.noise2D.dispose(); this.cellNoise.dispose(); this.waveSlopes.dispose();
    this.cube.dispose(); this.envCube.dispose(); this.hazeCube.dispose();
    this.cloudTex.cover.dispose(); this.cloudTex.shape.dispose(); this.cloudTex.detail.dispose();
  }

  // ------------------------------------------------------------------------------------------------ sky

  private bakeSize(q: QualitySettings): number { return this.opts.bakeRes ?? BAKE_RES[q.id]; }

  private bakeEnvCube(): void {
    for (const _ of this.baker.bake(this.envCube, this.skyParams, { pos: this.bakePos, clouds: true, cloudSteps: 24, below: true })) void _;
  }

  private bakeHazeCube(): void {
    for (const _ of this.baker.bake(this.hazeCube, this.skyParams, { pos: this.bakePos, clouds: false, cloudSteps: 0, below: false })) void _;
  }

  private cloudSteps(): number { return this.ctx.quality.cumulusSteps * 3; }

  /** Synchronous full bake into the CURRENT cube (preset / quality change: one hitch is fine there). */
  private bakeSkyNow(): void {
    this.skyJob = null;
    for (const _ of this.baker.bake(this.cube, this.skyParams, { pos: this.bakePos, clouds: true, cloudSteps: this.cloudSteps(), below: false })) void _;
    this.setSkyTexture(this.cube.texture);
  }

  /** Start a background bake into the spare cube; `stepSkyJob` advances it one face per frame. */
  private startSkyJob(): void {
    const size = this.cube.width;
    if (!this.spare || this.spare.width !== size) { this.spare?.dispose(); this.spare = this.baker.createCube(size); }
    this.skyJobTarget = this.spare;
    this.skyJob = this.baker.bake(this.spare, this.skyParams, { pos: this.bakePos, clouds: true, cloudSteps: this.cloudSteps(), below: false });
  }

  private stepSkyJob(): void {
    if (!this.skyJob || !this.skyJobTarget) return;
    if (!this.skyJob.next().done) return;
    // all six faces are done: swap
    const done = this.skyJobTarget;
    this.spare = this.cube;
    this.cube = done;
    this.skyJob = null; this.skyJobTarget = undefined;
    this.setSkyTexture(this.cube.texture);
    this.dome.setParams(this.skyParams, this.bakePos.y);
    this.reflDirty = true;
  }

  /** Point every consumer of the full sky cube (dome, reflections fallback, ocean) at `tex`. */
  private setSkyTexture(tex: THREE.Texture): void {
    this.dome.material.uniforms.uSky.value = tex;
    if (this.terrain) this.terrain.u.uSkyCube.value = tex;
    if (this.ocean) this.ocean.material.uniforms.uSkyCube.value = tex;
  }

  private async bakeSkyProgressive(): Promise<void> {
    for (const _ of this.baker.bake(this.cube, this.skyParams, { pos: this.bakePos, clouds: true, cloudSteps: this.cloudSteps(), below: false })) {
      void _;
      await new Promise<void>((r) => setTimeout(r, 0));   // yield between faces so loading UI stays responsive
    }
    this.bakeDone = true;
  }

  // ------------------------------------------------------------------------------------------------ planar reflection

  /** Render the mirror view when the camera moved (the scene is frozen, so nothing else invalidates it). */
  private updateReflection(): void {
    const ctx = this.ctx;
    if (!this.terrain) return;
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    const buf = ctx.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.refl.resize(buf.x, buf.y, ctx.quality.reflectionScale)) this.reflDirty = true;
    const moved = !this.reflCamM.equals(cam.matrixWorld) || !this.reflProj.equals(cam.projectionMatrix);
    if (!moved && !this.reflDirty) return;
    this.reflCamM.copy(cam.matrixWorld); this.reflProj.copy(cam.projectionMatrix);
    this.reflDirty = false;
    if (!this.refl.prepare(cam)) { this.setReflection(false); return; }
    // hide the ground layers: they face up and are drawn by the pools/ocean shaders themselves (and sampling the
    // target being written would be a feedback loop)
    const hide = [this.terrain?.mesh, this.ocean?.mesh, this.roads?.mesh].filter(Boolean) as THREE.Object3D[];
    const prev = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    if (this.opts.sandboxReflection) {
      const r = ctx.renderer;
      const prevRT = r.getRenderTarget();
      r.setRenderTarget(this.refl.target);
      r.clear();
      r.render(ctx.scene, this.refl.camera);
      r.setRenderTarget(prevRT);
    } else {
      ctx.renderView(this.refl.camera, this.refl.target, { volume: true });
    }
    hide.forEach((o, i) => (o.visible = prev[i]));
    this.setReflection(true);
  }

  private setReflection(on: boolean): void {
    this.reflOn = on;
    const tex = on ? this.refl.target.texture : null;
    this.terrain?.setReflection(tex, this.refl.textureMatrix);
    this.ocean?.setReflection(tex, this.refl.textureMatrix);
  }

  private applySkyUniforms(): void {
    this.dome.setParams(this.skyParams, this.bakePos.y);
    this.envDome.setParams(this.skyParams, this.bakePos.y);
    this.envDome.material.uniforms.uSunDisc.value = 0;
  }
}

/** Map a LightingPreset to the sky bake parameters (see comments for the tuning intent). */
/** Sky look knobs (tuned against research/palette.json); the sandbox can override them from the URL. */
export const SKY_TUNE = { solar: 10.5, aerosol: 25, ms: 0.22, warmth: 0.4, farCap: 30000, rayleighR: 0.5625e-6, rayleighG: 9.9e-6, rayleighB: 25.2e-6, hazeR: 2.85, hazeG: 3.45, hazeB: 3.5 };

export function presetToSky(p: LightingPreset): SkyParams {
  const sunDir = p.sun.dir.clone().normalize();
  // Clouds are lit with the sun colour, but a high sun (intensity 5) would blow them out to flat white: cap the luma
  // so lit cloud tops stay in the ~1.5-2.5 range the photo preset produces.
  const sunLuma = 0.2126 * p.sun.color.r + 0.7152 * p.sun.color.g + 0.0722 * p.sun.color.b;
  const sunLight = p.sun.color.clone().multiplyScalar(p.sun.intensity * Math.min(1, 2.6 / Math.max(sunLuma * p.sun.intensity, 1e-3)));
  // The tuned E0 matches the low-sun photo. A real sky is several times brighter with a high sun, but the presets
  // trade that off through post exposure, so keep the sky radiance in the same range across sun heights.
  const solar = SKY_TUNE.solar * p.sky.brightness / (1 + 1.1 * THREE.MathUtils.smoothstep(sunDir.y, 0.1, 0.8));
  const alt = sunDir.y;
  const night = THREE.MathUtils.smoothstep(-alt, 0.04, 0.30);           // 0 by day, 1 when the sun is >~17 deg below
  const ambTop = p.ambient.sky.clone().lerp(new THREE.Color(0.5, 0.55, 0.65), 0.45 * (1 - night)).multiplyScalar(p.ambient.intensity * 0.55);
  const ambBottom = p.ambient.ground.clone().lerp(new THREE.Color(0.2, 0.19, 0.18), 0.6 * (1 - night)).multiplyScalar(p.ambient.intensity * 1.1);
  const albedo = new THREE.Color(0.16, 0.13, 0.1);
  const ground = albedo.clone().multiply(
    sunLight.clone().multiplyScalar(Math.max(alt, 0) / Math.PI).add(p.ambient.sky.clone().multiplyScalar(p.ambient.intensity / Math.PI)),
  ).add(new THREE.Color(0.004, 0.006, 0.012));
  // Low sun: lift the cloud light direction (multiple scattering makes tops glow far more than a grazing ray would).
  const lift = 0.30 * (1 - THREE.MathUtils.smoothstep(alt, 0.05, 0.45)) * THREE.MathUtils.smoothstep(alt, -0.05, 0.03);
  const cloudSunDir = sunDir.clone().add(new THREE.Vector3(0, lift, 0)).normalize();
  return {
    sunDir, cloudSunDir, sunLight,
    e0: new THREE.Color(solar, solar, solar),
    msGain: SKY_TUNE.ms, warmth: SKY_TUNE.warmth, farCap: SKY_TUNE.farCap,
    horizonTint: new THREE.Color(SKY_TUNE.hazeR, SKY_TUNE.hazeG, SKY_TUNE.hazeB),
    atmo: new THREE.Vector4(p.sky.rayleigh, SKY_TUNE.aerosol * (p.sky.mieCoefficient / 0.004) * (p.sky.turbidity / 3.5), p.sky.mieDirectionalG, 1.0),
    betaR: new THREE.Vector3(SKY_TUNE.rayleighR, SKY_TUNE.rayleighG, SKY_TUNE.rayleighB),
    ambTop, ambBottom,
    cloudDensity: 1.0, cloudCoarse: 0.85, hazePerMetre: 2.2e-5,
    cirrus: 1.0, cirrusAngle: 1.31,
    stars: night,
    skyFloor: new THREE.Color(0.010, 0.020, 0.046).multiplyScalar(night),
    ground,
    sunDisc: THREE.MathUtils.smoothstep(alt, -0.03, 0.0),
  };
}
