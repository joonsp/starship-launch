// The render pipeline: renderer, lights, shadows, PMREM environment and the frame graph.
// OWNER: integrator (src/core). Implements the "Frame graph" section of src/contracts.ts:
//
//   0. update()      main.ts runs the module updates, then Pipeline.render()
//   1. RenderPass    ctx.scene -> composer inputBuffer (HalfFloat) + depth; the composer blits the
//                    depth into its STABLE depth target, published as ctx.targets.sceneDepth
//   2. PlumePass     plume.render(renderer, camera) -> the plume's own target (ctx.targets.plume)
//   3. volume.pass   raymarch + THE composite: opaque * T + L_inscatter + plume * T(plume.a)
//   4. OverlayPass   UI annotations in 3D (EduModule.overlayGroup: force arrows, sound-front sphere),
//                    depth-tested against the scene depth, drawn after the clouds so steam never
//                    dims them, and before the post chain so bloom / AgX / SMAA apply to them too
//   5. post chain    heat haze -> bloom + AgX + grade + LUT -> tilt-shift -> SMAA -> CA/vignette/grain
//
// Lighting owned here (contracts: "Nobody adds THREE lights except core"):
//  - the SUN: a DirectionalLight with a tightly fitted orthographic shadow frustum aligned to the sun
//    (fitShadowFrustum). The scene is frozen, so the shadow map is rendered ONCE per preset / quality and
//    again only after the camera settles (LOD switches); shadowMap.autoUpdate is off.
//  - hemisphere ambient at half the preset's ambient intensity (the PMREM carries the rest of the sky
//    light; this matches the convention the env module's terrain was tuned with),
//  - scene.environment = PMREM of env.environmentScene(), rebuilt on every preset.
//
// Depth: the composer's depth attachments are FLOAT (DEPTH_COMPONENT32F) because stencil is off, so a
// standard (non-reversed) projection with near 1 m / far 60 km keeps ~6 cm precision at 1 km. Walk mode
// pulls near in to 0.12 m (the controller does that). Reversed depth is NOT used: the plume and volume
// shaders linearise a standard 0..1 depth.
import * as THREE from 'three';
import { EffectComposer, Pass, RenderPass } from 'postprocessing';
import type { AppContext, LightingPreset, QualitySettings } from '../contracts.ts';

/** Near plane outside walk mode (the controller snapshots this as its base near plane). */
export const CAMERA_NEAR = 1.0;
export const CAMERA_FAR = 60000;

/** What the pipeline needs from the plume module (fx/plume). */
export interface PlumeLike { render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void }
/** What the pipeline needs from the volume module (fx/volume). */
export interface VolumeLike {
  pass: Pass;
  renderReflection(camera: THREE.PerspectiveCamera, target: THREE.WebGLRenderTarget, opts?: { scale?: number; steps?: number }): void;
}
/** What the pipeline needs from the environment module (env). */
export interface EnvLike { environmentScene(): THREE.Scene }

/**
 * Options of ctx.renderView. The contract only has `volume`; `clipPlane` (a WORLD-space plane; geometry on its
 * negative side is clipped) is an integrator extension for mirror views. It may also be passed as
 * `camera.userData.clipPlane` so callers typed against the contract need no cast.
 */
export interface RenderViewOptions { volume?: boolean; clipPlane?: THREE.Plane | null }

// ── renderer ────────────────────────────────────────────────────────────────────────────────────

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,             // everything renders into composer targets; SMAA is in the post chain
    alpha: false,
    stencil: false,
    depth: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false, // exportStill reads the canvas in the same task as the final render
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;   // AgX + grade live in the post chain
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186 removed PCFSoftShadowMap; PCF + radius = soft Vogel-disk PCF
  renderer.shadowMap.autoUpdate = false;        // frozen scene: the pipeline decides when to re-render it
  renderer.setClearColor(0x000000, 1);
  return renderer;
}

// ── passes ──────────────────────────────────────────────────────────────────────────────────────

/** Frame-graph step 2: the plume renders its own scene into its own target (no swap). */
class PlumePass extends Pass {
  constructor(private readonly plume: PlumeLike, private readonly cam: THREE.Camera) {
    super('PlumePass');
    this.needsSwap = false;
  }
  override render(renderer: THREE.WebGLRenderer): void {
    this.plume.render(renderer, this.cam);
  }
}

/** Copy the depth buffer of `src` into `dst` (both FLOAT depth attachments, same size). */
function blitDepth(renderer: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget, dst: THREE.WebGLRenderTarget): void {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const props = renderer.properties as unknown as { get(o: object): { __webglFramebuffer?: WebGLFramebuffer } };
  renderer.setRenderTarget(src);   // make sure both framebuffers exist
  renderer.setRenderTarget(dst);
  const srcFbo = props.get(src).__webglFramebuffer ?? null;
  const dstFbo = props.get(dst).__webglFramebuffer ?? null;
  if (!srcFbo || !dstFbo) return;
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFbo);
  gl.blitFramebuffer(0, 0, src.width, src.height, 0, 0, dst.width, dst.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  renderer.setRenderTarget(null);  // resync three's framebuffer state tracker (as pmndrs does)
}

/**
 * Frame-graph step 4: 3D annotations over the composited HDR image. After the volume pass swapped, the current
 * buffer's depth attachment is stale, so the stable scene depth is blitted in first; the overlay then depth-tests
 * against the real opaque scene (the sound-front sphere) or ignores depth (the force arrows, depthTest off).
 */
class OverlayPass extends Pass {
  constructor(private readonly overlay: THREE.Scene, private readonly cam: THREE.Camera, private readonly depthSrc: () => THREE.WebGLRenderTarget | null) {
    super('OverlayPass');
    this.needsSwap = false;
  }
  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget): void {
    if (!this.overlay.visible || !this.overlay.children.some((c) => c.visible)) return;
    const src = this.depthSrc();
    if (src && src.width === inputBuffer.width && src.height === inputBuffer.height) blitDepth(renderer, src, inputBuffer);
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(inputBuffer);
    renderer.render(this.overlay, this.cam);
    renderer.autoClear = prevAuto;
  }
}

// ── the pipeline ────────────────────────────────────────────────────────────────────────────────

/** Region whose shadows matter: Pad 2 (apron, tower, tank farm) and Pad 1, in world metres. */
const SHADOW_REGION = { minX: -120, maxX: 385, minZ: -135, maxZ: 115, minY: -12, maxY: 152 };
/** The vehicle column (self-shadowing of fins, flaps and engines needs it in the map). */
const VEHICLE_COLUMN = { r: 12, minY: 150, maxY: 290 };
/** Tallest caster whose ground shadow must not be cut off by the frustum (the towers + masts). */
const SHADOW_CASTER_H = 150;
/** Camera still this long (s) after moving -> re-render the shadow map once (LOD levels may have changed). */
const SHADOW_SETTLE_S = 0.35;

export class Pipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly renderPass: RenderPass;
  /** Rendered after the volume composite, depth-tested against the opaque scene (edu annotations). */
  readonly overlayScene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  /** Scale of the volume march in planar-reflection views (relative to the reflection target). */
  reflectionVolumeScale = 0.25;
  reflectionVolumeSteps = 32;

  private readonly ctx: AppContext;
  private plume: PlumeLike | null = null;
  private volume: VolumeLike | null = null;
  private env: EnvLike | null = null;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private inView = false;
  private shadowDirty = true;
  private movedAt = -1;         // performance.now() of the last camera move (-1 = settled)
  private readonly prevClear = new THREE.Color();
  private readonly tmpV2 = new THREE.Vector2();
  private built = false;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
    this.renderer = ctx.renderer;
    const r = this.renderer;
    r.info.autoReset = false;

    // ── lights ──
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.name = 'core.sun';
    this.sun.castShadow = true;   // kept on in every preset (night = intensity 0) so shader programs never change per preset
    this.sun.shadow.radius = 1.5; // Vogel-disk PCF radius in texels (biases are derived from it in fitShadowFrustum)
    this.sun.shadow.intensity = 1;
    this.sun.shadow.mapSize.set(ctx.quality.shadowMapSize, ctx.quality.shadowMapSize);
    this.sun.target.name = 'core.sun.target';
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.5);
    this.hemi.name = 'core.hemi';
    ctx.scene.add(this.sun, this.sun.target, this.hemi);

    this.pmrem = new THREE.PMREMGenerator(r);

    // ── composer ── (stencil off => FLOAT depth textures on both sides of every depth blit)
    this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0, stencilBuffer: false, depthBuffer: true });
    this.renderPass = new RenderPass(ctx.scene, ctx.camera);
    this.composer.addPass(this.renderPass);

    ctx.renderView = (camera, target, opts) => this.renderView(camera, target, opts as RenderViewOptions | undefined);

    // ── accumulation / shadow bookkeeping ──
    const ev = ctx.events;
    ev.on('camera-moved', () => { this.movedAt = performance.now(); });
    ev.on('preset', (e) => this.applyPreset(e.preset));
    this.applyPreset(ctx.preset);
    this.fitShadowFrustum();
  }

  /** Attach the plume, volume and post passes (frame-graph steps 2-5). Call once, after those modules' init. */
  build(parts: { plume: PlumeLike; volume: VolumeLike; post: Pass[] }): void {
    if (this.built) throw new Error('Pipeline.build called twice');
    this.built = true;
    const { ctx, composer } = this;
    this.plume = parts.plume;
    this.volume = parts.volume;
    composer.addPass(new PlumePass(parts.plume, ctx.camera));
    composer.addPass(parts.volume.pass);   // needsDepthTexture -> the composer creates its stable depth target now
    const depthRT = (): THREE.WebGLRenderTarget | null => (composer as unknown as { depthRenderTarget: THREE.WebGLRenderTarget | null }).depthRenderTarget;
    ctx.targets.sceneDepth = (depthRT()?.depthTexture as THREE.DepthTexture | undefined) ?? null;
    composer.addPass(new OverlayPass(this.overlayScene, ctx.camera, depthRT));
    for (const p of parts.post) composer.addPass(p);
    this.resize();
  }

  /** Environment map source (env module). The PMREM is (re)built now and on every preset. */
  setEnvironment(env: EnvLike): void {
    this.env = env;
    this.rebuildEnvironment();
  }

  rebuildEnvironment(): void {
    if (!this.env) return;
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.env.environmentScene(), 0, 0.1, 100);
    this.ctx.scene.environment = this.envRT.texture;
    this.ctx.scene.environmentIntensity = 1;
    old?.dispose();
  }

  /** Core's part of a preset change: sun, hemisphere, shadow frustum. (The PMREM is rebuilt by rebuildEnvironment after env.onPreset.) */
  applyPreset(p: LightingPreset): void {
    const sun = this.sun;
    sun.color.copy(p.sun.color);
    sun.intensity = p.sun.intensity;
    this.hemi.color.copy(p.ambient.sky);
    this.hemi.groundColor.copy(p.ambient.ground);
    this.hemi.intensity = p.ambient.intensity * 0.5;
    this.fitShadowFrustum();
  }

  /** Quality: pixel ratio, shadow map size and every canvas-sized target. Modules get their own onQuality from main.ts. */
  applyQuality(q: QualitySettings): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    const s = this.sun.shadow;
    if (s.mapSize.x !== q.shadowMapSize) {
      s.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      s.map?.dispose();
      (s as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
    this.reflectionVolumeScale = q.id === 'low' ? 0.2 : 0.25;
    this.reflectionVolumeSteps = q.id === 'low' ? 24 : q.id === 'ultra' ? 40 : 32;
    this.fitShadowFrustum();   // the biases scale with the shadow texel size
    this.resize();
  }

  /** Resize to the window (or explicit CSS size); keeps uResolution and the camera aspect in step. */
  resize(cssW = window.innerWidth, cssH = window.innerHeight): void {
    const { ctx, composer } = this;
    composer.setSize(Math.max(1, cssW), Math.max(1, cssH), false);
    ctx.camera.aspect = Math.max(1, cssW) / Math.max(1, cssH);
    ctx.camera.updateProjectionMatrix();
    this.renderer.getDrawingBufferSize(this.tmpV2);
    ctx.globals.uResolution.value.copy(this.tmpV2);
    ctx.events.emit({ type: 'camera-moved' });
  }

  /** Resize to an exact drawing-buffer size (exportStill). pixelRatio is what the CSS size is derived with. */
  resizeDrawingBuffer(width: number, height: number, pixelRatio: number): void {
    this.renderer.setPixelRatio(pixelRatio);
    this.composer.setSize(Math.round(width / pixelRatio), Math.round(height / pixelRatio), false);
    this.renderer.getDrawingBufferSize(this.tmpV2);
    this.ctx.globals.uResolution.value.copy(this.tmpV2);
  }

  /** Force a shadow-map refresh on the next frame. */
  invalidateShadows(): void { this.shadowDirty = true; }

  /** Per-frame globals that depend on the camera / canvas. Call right after the camera controller's update. */
  refreshGlobals(t: number): void {
    const g = this.ctx.globals;
    g.uTime.value = t;
    this.ctx.camera.updateMatrixWorld();
    g.uCameraPos.value.setFromMatrixPosition(this.ctx.camera.matrixWorld);
    this.renderer.getDrawingBufferSize(this.tmpV2);
    if (!g.uResolution.value.equals(this.tmpV2)) g.uResolution.value.copy(this.tmpV2);
  }

  /**
   * Start of a frame, BEFORE the module updates: arms the shadow-map refresh when needed. Whichever render comes
   * first this frame renders it (the env module's planar reflection runs inside its update), so no draw ever
   * samples a missing shadow map. Refreshes once when dirty and once after the camera settles (LOD levels follow
   * the camera).
   */
  beginFrame(t: number): void {
    this.renderer.info.reset();   // info.autoReset is off: the stats cover the whole frame (all passes)
    const now = performance.now();
    if (this.movedAt >= 0 && now - this.movedAt > SHADOW_SETTLE_S * 1000) { this.movedAt = -1; this.shadowDirty = true; }
    if (this.shadowDirty || !this.sun.shadow.map) { this.renderer.shadowMap.needsUpdate = true; this.shadowDirty = false; }
    this.refreshGlobals(t);
  }

  /** Frame-graph steps 1-5. beginFrame() and the module updates must already have run this frame. */
  render(dt: number): void {
    this.composer.render(dt);
  }

  /**
   * ctx.renderView: the full scene (sky, opaques, the launch clouds at low quality) into `target`. Used by the
   * env module's planar reflection. Re-entrancy safe (a nested call is a no-op). `clipPlane` (world space; via
   * opts or camera.userData.clipPlane) clips everything on its negative side, e.g. below the water plane.
   */
  renderView(camera: THREE.Camera, target: THREE.WebGLRenderTarget, opts: RenderViewOptions = {}): void {
    if (this.inView) return;
    this.inView = true;
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevAuto = r.autoClear;
    const prevClip = r.clippingPlanes;
    const prevAlpha = r.getClearAlpha();
    r.getClearColor(this.prevClear);
    const plane = opts.clipPlane ?? ((camera.userData as { clipPlane?: THREE.Plane }).clipPlane ?? null);
    try {
      r.autoClear = false;
      r.setRenderTarget(target);
      r.setClearColor(0x000000, 1);
      r.clear(true, true, false);
      if (plane) r.clippingPlanes = [plane];
      r.render(this.ctx.scene, camera);
      r.clippingPlanes = prevClip;
      const cam = camera as THREE.PerspectiveCamera;
      if (opts.volume !== false && this.volume && cam.isPerspectiveCamera && target.depthTexture) {
        this.volume.renderReflection(cam, target, { scale: this.reflectionVolumeScale, steps: this.reflectionVolumeSteps });
      }
    } finally {
      r.clippingPlanes = prevClip;
      r.setClearColor(this.prevClear, prevAlpha);
      r.setRenderTarget(prevRT);
      r.autoClear = prevAuto;
      this.inView = false;
    }
  }

  /**
   * Compile every material of the scene ahead of the first frame (both the normal variant and the clipped
   * mirror-view variant), so the loading screen absorbs the shader compile instead of the first frames.
   */
  async precompile(withClipVariant = true): Promise<void> {
    const r = this.renderer, { scene, camera } = this.ctx;
    await r.compileAsync(scene, camera);
    if (withClipVariant) {
      // program keys depend on the NUMBER of clipping planes, not on the camera, so the main camera will do
      const prev = r.clippingPlanes;
      r.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.03)];
      try { await r.compileAsync(scene, camera); } finally { r.clippingPlanes = prev; }
    }
    if (this.overlayScene.children.length) {
      const vis = this.overlayScene.children.map((c) => c.visible);
      this.overlayScene.children.forEach((c) => { c.visible = true; });
      await r.compileAsync(this.overlayScene, camera);
      this.overlayScene.children.forEach((c, i) => { c.visible = vis[i]; });
    }
  }

  /**
   * Fit the sun's orthographic shadow camera around the pad region (+ the vehicle column), in light space.
   * The box is extended along the ground shadow direction far enough that a tower's shadow is never cut off
   * (at the photo's 5.7 deg sun a 150 m tower throws a ~1.5 km shadow). Light-space fitting keeps the map
   * dense: the flat region projects to a thin sliver seen from a grazing sun.
   */
  fitShadowFrustum(): void {
    const sun = this.sun, cam = sun.shadow.camera as THREE.OrthographicCamera;
    const dir = this.ctx.preset.sun.dir.clone().normalize();
    // below ~3 deg (or a night sun under the horizon) clamp to a sane grazing light; night has intensity 0 anyway
    const minEl = Math.sin(3 * Math.PI / 180);
    if (dir.y < minEl) { const h = Math.hypot(dir.x, dir.z) || 1; dir.set(dir.x / h, 0, dir.z / h).multiplyScalar(Math.cos(3 * Math.PI / 180)).setY(minEl); }
    const R = SHADOW_REGION;
    const centre = new THREE.Vector3((R.minX + R.maxX) / 2, 40, (R.minZ + R.maxZ) / 2);
    sun.target.position.copy(centre);
    sun.position.copy(centre).addScaledVector(dir, 3000);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    // same view transform three uses in DirectionalLightShadow.updateMatrices
    cam.position.copy(sun.position);
    cam.lookAt(centre);
    cam.updateMatrixWorld();
    const view = cam.matrixWorldInverse;

    const pts: THREE.Vector3[] = [];
    for (const x of [R.minX, R.maxX]) for (const z of [R.minZ, R.maxZ]) for (const y of [R.minY, R.maxY]) pts.push(new THREE.Vector3(x, y, z));
    const V = VEHICLE_COLUMN;
    for (const x of [-V.r, V.r]) for (const z of [-V.r, V.r]) for (const y of [V.minY, V.maxY]) pts.push(new THREE.Vector3(x, y, z));
    // ground receivers of the long shadows: the region footprint pushed away from the sun
    const hor = new THREE.Vector3(-dir.x, 0, -dir.z).normalize();
    const L = Math.min(SHADOW_CASTER_H / Math.max(dir.y / Math.hypot(dir.x, dir.z), 1e-3), 2200);
    for (const x of [R.minX, R.maxX]) for (const z of [R.minZ, R.maxZ]) pts.push(new THREE.Vector3(x, 0, z).addScaledVector(hor, L));

    const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of pts) { p.applyMatrix4(view); lo.min(p); hi.max(p); }
    const pad = 4;
    cam.left = lo.x - pad; cam.right = hi.x + pad;
    cam.bottom = lo.y - pad; cam.top = hi.y + pad;
    cam.near = Math.max(1, -hi.z - 50);    // extra room toward the sun for casters just outside the region
    cam.far = -lo.z + 50;
    cam.updateProjectionMatrix();

    // Grazing-sun acne control. For flat ground the stored depth changes by texel / tan(el) per shadow texel, and
    // the PCF disc reaches `radius` texels, so the lookup needs that much margin. A normal offset nb (world m,
    // along the surface normal) buys nb / sin(el) of margin on flat ground; the constant bias covers the bilinear
    // footprint of the hardware PCF (half a texel). Both scale with the map resolution (quality).
    const el = Math.asin(THREE.MathUtils.clamp(dir.y, minEl, 1));
    const texel = (cam.top - cam.bottom) / Math.max(1, sun.shadow.mapSize.y);
    const radius = sun.shadow.radius;
    sun.shadow.normalBias = 1.15 * texel * radius * Math.cos(el);
    sun.shadow.bias = -(0.6 * texel / Math.tan(el) + 0.05) / (cam.far - cam.near);
    this.shadowDirty = true;
  }

  dispose(): void {
    this.composer.dispose();
    this.envRT?.dispose();
    this.pmrem.dispose();
    this.ctx.scene.remove(this.sun, this.sun.target, this.hemi);
  }
}
