// VolumeModule: the launch clouds (deluge steam, smoke and the ground fireball). THE HERO ELEMENT.
// OWNER: volume module (src/fx/volume/**).
//
// ── What it does ─────────────────────────────────────────────────────────────
//  - Authors the cloud density from hierarchical puff spheres fitted to the reference photo
//    (puffs.ts), bakes it ONCE into a 3D texture inside anchors.volumeBounds (bakes.ts), plus
//    tileable shape/detail noise, an occupancy volume for empty-space skipping and a light volume
//    (sun optical depth, plume + fireball irradiance, sky/ground visibility).
//  - VolumePass (volume-pass.ts) raymarches it at quality.volumeScale, accumulates while the camera
//    is still (stops marching after params.maxFrames), and composites
//        out = opaque * T_total + L_inscatter + plume.rgb * T(plume.a)
//  - Rebakes the light volume (time-sliced, no hitch) when the sun direction, the plume axis or
//    sigma change; rebakes the density when quality.volumeBakeRes changes.
//  - Honours uViewMode (Photo / Thermal / Clay) and uDrift (slow advection + billow growth).
//
// ── Wiring (see the integrator notes in the final report) ────────────────────
//    const volume = new VolumeModule();
//    await volume.init(ctx);                 // bakes (async, yields to the event loop)
//    composer.addPass(renderPass); composer.addPass(plumePass); composer.addPass(volume.pass); ...
//    per frame: volume.update(dt, t) before composer.render()
//    reflections: volume.renderReflection(camera, target) after the view's opaque render
import * as THREE from 'three';
import type { AppContext, LightingPreset, Module, QualitySettings } from '../../contracts.ts';
import { VolumeBaker, runJob, type LightBakeInputs } from './bakes.ts';
import { L0_SPECS, buildPuffs, fireSources, photoFrameFrom, type PhotoFrame, type Puff, type Vec3 } from './puffs.ts';
import { DEFAULT_PARAMS, type VolumeParams } from './params.ts';
import { VolumePass } from './volume-pass.ts';

export { VolumePass } from './volume-pass.ts';
export { DEFAULT_PARAMS, type VolumeParams } from './params.ts';

/** Linear-sRGB colour of a blackbody (normalised to max channel 1); JS twin of sl_blackbody(). */
export function blackbodyColor(kelvin: number, out = new THREE.Color()): THREE.Color {
  const T = Math.min(Math.max(kelvin, 1000), 40000) / 100;
  const r = T <= 66 ? 1 : Math.min(1, Math.max(0, 1.29293618606 * Math.pow(T - 60, -0.1332047592)));
  const g = T <= 66 ? Math.min(1, Math.max(0, 0.39008157876 * Math.log(T) - 0.63184144378))
    : Math.min(1, Math.max(0, 1.12989086089 * Math.pow(T - 60, -0.0755148492)));
  const b = T >= 66 ? 1 : T <= 19 ? 0 : Math.min(1, Math.max(0, 0.54320678911 * Math.log(T - 10) - 1.19625408914));
  const c = [r, g, b].map((v) => Math.pow(v, 2.2));
  const m = Math.max(...c, 1e-4);
  return out.setRGB(c[0] / m, c[1] / m, c[2] / m);
}

type BakeKind = 'density' | 'light';

export class VolumeModule implements Module {
  readonly name = 'volume';
  readonly params: VolumeParams;
  readonly pass: VolumePass;
  /** World-space puff list (after init). */
  puffs: Puff[] = [];
  /** Resolves when the initial bake is done. */
  ready: Promise<void> = Promise.resolve();

  private ctx: AppContext | null = null;
  baker: VolumeBaker | null = null;
  private frame: PhotoFrame | null = null;
  private job: Generator<void> | null = null;
  private jobKind: BakeKind | null = null;
  private pending = new Set<BakeKind>();
  private bakedSun = new THREE.Vector3();
  private bakedA = new THREE.Vector3();
  private bakedB = new THREE.Vector3();
  private bakedSigma = 0;
  private bakedFireTau = 0;
  private bakedRes = '';
  private driftT = 0;
  private lastSig = '';
  private offs: (() => void)[] = [];
  private readonly driftOffset = new THREE.Vector3();
  private readonly growth = new THREE.Vector3(1, 1, 1);
  private readonly fireColor = new THREE.Color();
  private readonly fireCentre = new THREE.Vector3(20, 18, 5);

  constructor(params: Partial<VolumeParams> = {}) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.pass = new VolumePass(this.params);
  }

  async init(ctx: AppContext): Promise<void> {
    this.ctx = ctx;
    const a = ctx.anchors;
    const pc = a.photoCamera;
    this.frame = photoFrameFrom(pc.pos.toArray() as Vec3, pc.target.toArray() as Vec3, pc.fovDeg, pc.rollDeg);
    this.puffs = buildPuffs(this.frame);
    this.baker = new VolumeBaker(ctx.renderer, a.volumeBounds);
    this.pass.attach(ctx, this.baker);

    // hotspots: steam on the east bank, fireball at the deflector
    const fires = fireSources(this.frame).slice(0, L0_SPECS.filter((s) => s.g === 'F').length);
    const fc = fires.reduce((s, f) => s.add(new THREE.Vector3(...f.c).multiplyScalar(f.w)), new THREE.Vector3());
    this.fireCentre.copy(fc);
    ctx.hotspots.push(
      { id: 'steam', position: new THREE.Vector3(210, 150, 175), contentKey: 'edu.hotspot.steam', category: 'fx', priority: 6 },
      { id: 'fireball', position: fc.setY(Math.max(fc.y, 12)), contentKey: 'edu.hotspot.fireball', category: 'fx', priority: 7 },
    );

    const reset = () => this.pass.resetAccumulation();
    this.offs.push(
      ctx.events.on('camera-moved', reset),
      ctx.events.on('reset-accumulation', reset),
      ctx.events.on('drift', reset),
      ctx.events.on('preset', (e) => this.onPreset(e.preset)),
      ctx.events.on('quality', (e) => this.onQuality(e.quality)),
    );
    this.ready = this.bake();
    await this.ready;
  }

  /** Full (re)bake: noise (first time), density + occupancy, light. Yields to the event loop. */
  async bake(): Promise<void> {
    const ctx = this.ctx!, b = this.baker!;
    const t0 = performance.now();
    this.job = null; this.jobKind = null; this.pending.clear();
    if (!b.timings.noise) await runJob(b.noiseJob());
    await runJob(b.densityJob(this.bakeRes(ctx.quality), this.puffs));
    this.bakedRes = ctx.quality.volumeBakeRes.join('x');
    await runJob(b.lightJob(this.lightInputs()), 2);
    this.pass.resetAccumulation();
    console.info(`[volume] baked ${this.puffs.length} puffs at ${this.bakedRes} in ${((performance.now() - t0) / 1000).toFixed(2)} s`, b.timings);
  }

  /** Density bake resolution for a quality level (clamped to sane GPU limits). */
  private bakeRes(q: QualitySettings): [number, number, number] {
    const [x, y, z] = q.volumeBakeRes;
    return [Math.max(16, x | 0), Math.max(8, y | 0), Math.max(16, z | 0)];
  }

  private lightInputs(): LightBakeInputs {
    const g = this.ctx!.globals, q = this.ctx!.quality;
    this.bakedSun.copy(g.uSunDir.value);
    this.bakedA.copy(g.uPlumeAxisA.value);
    this.bakedB.copy(g.uPlumeAxisB.value);
    this.bakedSigma = this.params.sigma;
    this.bakedFireTau = this.params.fireTauScale;
    const low = q.id === 'low';
    return {
      sunDir: g.uSunDir.value.clone(),
      sigma: this.params.sigma,
      fireTauScale: this.params.fireTauScale,
      plumeA: g.uPlumeAxisA.value.clone(),
      plumeB: g.uPlumeAxisB.value.clone(),
      fires: fireSources(this.frame!),
      plumeSamples: low ? 6 : 10,
      segSteps: low ? 8 : 12,
    };
  }

  /** Queue a time-sliced rebake ('light' after sun/plume/sigma changes; 'density' after quality). */
  requestRebake(kind: BakeKind): void {
    this.pending.add(kind);
    if (kind === 'density') this.pending.add('light');
  }

  update(dt: number, _t: number): void {
    const ctx = this.ctx, b = this.baker;
    if (!ctx || !b || !b.light) return;
    const g = ctx.globals, p = this.params;

    // change detection -> light rebake (dedupes onPreset + 'preset' event)
    if (g.uSunDir.value.angleTo(this.bakedSun) > 1e-3 || g.uPlumeAxisA.value.distanceTo(this.bakedA) > 0.5 ||
        g.uPlumeAxisB.value.distanceTo(this.bakedB) > 0.5 || Math.abs(p.sigma - this.bakedSigma) > 1e-6 ||
        Math.abs(p.fireTauScale - this.bakedFireTau) > 1e-6) {
      if (this.jobKind !== 'light') this.requestRebake('light');
    }
    // any lighting/view change resets the accumulation
    // (the plume light flickers slightly in drift mode: the drift EMA absorbs that, so it is left out
    //  of the signature while drifting; otherwise every frame would restart the accumulation)
    const drifting = g.uDrift.value > 0;
    const col = (c: THREE.Color) => `${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)}`;
    const sig = [col(g.uSunColor.value), col(g.uSkyAmbient.value), col(g.uGroundAmbient.value), drifting ? '' : col(g.uPlumeLight.value),
      g.uViewMode.value, drifting ? 1 : 0, col(g.uFogColor.value), g.uFogDensity.value, JSON.stringify(p)].join('|');
    if (sig !== this.lastSig) { this.lastSig = sig; this.pass.resetAccumulation(); }

    // time-sliced rebakes: a few chunks per frame; textures swap when a job completes
    if (!this.job && this.pending.size) {
      const kind: BakeKind = this.pending.has('density') ? 'density' : 'light';
      this.pending.delete(kind);
      this.jobKind = kind;
      this.job = kind === 'density' ? b.densityJob(this.bakeRes(ctx.quality), this.puffs) : b.lightJob(this.lightInputs());
      if (kind === 'density') this.bakedRes = ctx.quality.volumeBakeRes.join('x');
    }
    if (this.job) {
      for (let i = 0; i < 3; i++) {
        if (this.job.next().done) { this.job = null; this.jobKind = null; this.pass.resetAccumulation(); break; }
      }
    }

    // fire light colour: blackbody at params.fireLightKelvin x gain (irradiance units of the bake)
    blackbodyColor(p.fireLightKelvin, this.fireColor).multiplyScalar(p.fireLightGain * 1.4);
    this.pass.setFireLight(this.fireColor, this.fireCentre);

    // drift: slow advection + billow growth about the mount; frozen when uDrift = 0
    // (turning drift off returns to the photo-matched frozen state: a still must match the photo)
    if (g.uDrift.value > 0) this.driftT += dt * g.uDrift.value;
    else this.driftT = 0;
    const dtT = this.driftT;
    this.driftOffset.set(p.windX * dtT, -p.riseSpeed * dtT, p.windZ * dtT);
    const gr = p.growth * (1 - Math.exp(-dtT / 240));
    this.growth.set(1 + gr, 1 + gr * 1.3, 1 + gr);
    this.pass.setDrift(this.driftOffset, this.growth);
  }

  onPreset(_p: LightingPreset): void {
    // Globals are refreshed by core from the preset; update() notices the new sun direction and
    // rebakes the light volume. Reset now so the first frame with the new colours is not blended.
    this.pass.resetAccumulation();
  }

  onQuality(q: QualitySettings): void {
    this.pass.setQuality(q.volumeScale, q.volumeSteps);
    if (q.volumeBakeRes.join('x') !== this.bakedRes) this.requestRebake('density');
  }

  /**
   * Low-quality volume over an arbitrary view, for core's renderView (planar reflections).
   * Call after rendering the view's opaque scene into `target` (with target.depthTexture set).
   */
  renderReflection(camera: THREE.PerspectiveCamera, target: THREE.WebGLRenderTarget, opts?: { scale?: number; steps?: number }): void {
    if (!this.ctx) return;
    this.pass.renderView(this.ctx.renderer, camera, target, opts);
  }

  /** Baked textures, e.g. for cloud shadows on the terrain: lightA.r = sun optical depth (x sigma). */
  getTextures(): { density: THREE.Texture | null; lightA: THREE.Texture | null; box: THREE.Box3 } | null {
    const b = this.baker;
    if (!b) return null;
    return { density: b.density?.texture ?? null, lightA: b.light?.textures[0] ?? null, box: b.box };
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.pass.dispose();
    this.baker?.dispose();
  }
}
