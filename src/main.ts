// Application entry: the Starship Flight 14 freeze-frame (B21/S41, Starbase Pad 2, T+7.2 s).
// OWNER: integrator. Builds the AppContext, the UI shell, every module and the render pipeline
// (src/core/pipeline.ts), wires the UI / camera / post / edu together and runs the frame loop.
//
// Start-up order (each step's requirement in brackets):
//   renderer + quality guess -> ctx (preset globals applied) -> Pipeline (lights, composer, renderView)
//   -> CameraController.init [canvas, camera at the calibrated photo pose; snapshots camera.near]
//   -> UiShell (the loading screen shows at once)
//   -> env + vehicle + pad in parallel [env bakes the sky at the camera pose] -> PMREM from env
//   -> plume [renderer] -> volume bakes [quality, globals] -> post chain -> Pipeline.build (frame graph)
//   -> edu (overlay reparented into the pipeline's overlay scene) -> precompile -> warm frames -> hideLoading
//   -> auto-quality frame-time probe.
// Per frame: controls.update -> globals (time, camera, resolution) -> module updates -> [idle gate] -> pipeline.render -> uFrame++.
// Idle gate: the scene is frozen, so once the cloud accumulation has converged, the shadow map has settled and nothing
// else changed, the frame is NOT drawn at all (near-idle GPU; the DOM UI keeps running). See needsFrame() below.
// Anything that changes the image without going through an event (a QA script poking a module) must call
// window.app.invalidate(); ?idle=0 turns the gate off.
//
// URL parameters (QA / deep links):
//   ?preset=photo|noon|night|thermal|clay  ?mode=orbit|photo|walk|fly  ?quality=auto|low|medium|high|ultra
//   ?edu=1  ?lang=en|fi  ?ui=0 (hide all chrome)  ?drift=1  ?loop=1 (open the Slow drift loop panel + framing guide)
//   ?probe=0 (no auto-quality probe)
//   ?bake=512 (sky cube face size override; for software-rendered QA only)  ?idle=0 (draw every frame, no idle gate)
// window.app = { ctx, controller, modules, pipeline, ui, setPreset, setQuality, setMode, setEdu, setLang, setDrift,
//                exportStill, recordLoop, invalidate, stats, ready, frames, drawn } for scripted screenshots (scripts/qa-*.mjs)
// and the headless wallpaper-loop recorder (scripts/record-loop.mjs).
//
// Slow drift loop (recordLoop): an OFFLINE render, not a screen capture. The frame loop is paused (like exportStill), the
// drawing buffer is resized to the output size, the camera takes the output aspect (and, for a wider target, a narrower
// vertical fov: the recording is exactly the crop the framing guide shows), drift is switched on, and src/record/recorder.ts
// (lazy-loaded with mediabunny) steps the scene with a fixed dt = 1/fps through step() and encodes each frame.
import './styles/tokens.css';
import './styles/app.css';
import * as THREE from 'three';
import type { AppContext, CameraModeId, Lang, LightingPresetId, Module, QualityChoice, QualityId } from './contracts.ts';
import { createEmitter, createGlobals } from './core/context.ts';
import { CAMERA_FAR, CAMERA_NEAR, Pipeline, createRenderer } from './core/pipeline.ts';
import { FrameProbe, QUALITY_LEVELS, WARM_FRAMES_MAX, guessQuality, lowerQuality } from './core/quality.ts';
import { probeStale, shouldDraw } from './core/idle.ts';
import { evenDims, framingCrop, recordFovDeg, screenDims } from './record/loop-schedule.ts';
import type { RecordOptions, RecordProgress, RecordResult } from './record/recorder.ts';
import { ANCHORS, QUALITY, T_F } from './scene-config.ts';
import { registerStrings, setLang as i18nSetLang, t } from './i18n.ts';
import { PRESET_ORDER, UiShell, saveBlob, type LoopSettings, type UiHandlers } from './ui/index.ts';
import { CameraController } from './controls/index.ts';
import { EnvironmentModule } from './env/EnvironmentModule.ts';
import { VehicleModule } from './vehicle/index.ts';
import { PadModule } from './pad/index.ts';
import { PlumeModule } from './fx/plume/PlumeModule.ts';
import { VolumeModule } from './fx/volume/index.ts';
import { EduModule } from './edu/index.ts';
import { PRESETS, applyPresetToGlobals, createPostChain, exportStill, type ExportResult, type PostChain } from './post/index.ts';

registerStrings({
  en: {
    'app.toast.saved': 'Saved {file} ({w} × {h})',
    'app.toast.exportFailed': 'Could not save the still',
    'app.toast.qualityDown': 'Quality lowered to {q} to keep the frame rate smooth',
    'app.error.title': 'This view could not start',
    'app.error.webgl': 'WebGL 2 is not available in this browser.',
  },
  fi: {
    'app.toast.saved': 'Tallennettu {file} ({w} × {h})',
    'app.toast.exportFailed': 'Kuvan tallennus epäonnistui',
    'app.toast.qualityDown': 'Laatu laskettiin tasolle {q}, jotta kuva pysyy sulavana',
    'app.error.title': 'Näkymää ei voitu käynnistää',
    'app.error.webgl': 'Tämä selain ei tue WebGL 2:ta.',
  },
});

// ── URL parameters ──────────────────────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  const v = params.get(key) as T | null;
  return v && allowed.includes(v) ? v : fallback;
};
const MODES: CameraModeId[] = ['orbit', 'photo', 'walk', 'fly'];
const initialPreset = pick<LightingPresetId>('preset', PRESET_ORDER, 'photo');
const initialMode = pick<CameraModeId>('mode', MODES, 'photo');
let qualityChoice = pick<QualityChoice>('quality', ['auto', ...QUALITY_LEVELS], 'auto');
const initialLang = pick<Lang>('lang', ['en', 'fi'], 'en');
const initialEdu = params.get('edu') === '1';
const initialDrift = params.get('drift') === '1';
const hideUi = params.get('ui') === '0';
const openLoop = params.get('loop') === '1';   // the Omarchy bar's "Record a new loop" opens <app>?loop=1
const probeEnabled = params.get('probe') !== '0';
const idleGate = params.get('idle') !== '0';
const bakeOverride = Number(params.get('bake')) || undefined;

// ── DOM ─────────────────────────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
i18nSetLang(initialLang);

function fatal(err: unknown): void {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'app-fatal';
  const h = document.createElement('h1');
  h.textContent = t('app.error.title');
  const p = document.createElement('p');
  p.textContent = err instanceof Error ? err.message : String(err);
  box.append(h, p);
  document.body.append(box);
}

let renderer: THREE.WebGLRenderer;
try {
  renderer = createRenderer(canvas);
} catch (e) {
  fatal(new Error(t('app.error.webgl')));
  throw e;
}

// A GPU reset loses every bake (sky cube, cloud volumes, splats); the simplest correct recovery is a reload.
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.warn('[app] WebGL context lost'); });
canvas.addEventListener('webglcontextrestored', () => { console.warn('[app] WebGL context restored: reloading'); location.reload(); });

// ── context ─────────────────────────────────────────────────────────────────────────────────────
const guess = guessQuality(renderer);
let autoLevel: QualityId = guess.id;
const effective = (): QualityId => (qualityChoice === 'auto' ? autoLevel : qualityChoice);
console.info(`[app] GPU "${guess.gpu}" -> ${guess.id} (${guess.reason}); quality choice ${qualityChoice}`);

const camera = new THREE.PerspectiveCamera(ANCHORS.photoCamera.fovDeg, innerWidth / Math.max(1, innerHeight), CAMERA_NEAR, CAMERA_FAR);
const ctx: AppContext = {
  renderer,
  scene: new THREE.Scene(),
  camera,
  canvas,
  uiRoot,
  globals: createGlobals(),
  anchors: ANCHORS,
  quality: QUALITY[effective()],
  preset: PRESETS[initialPreset],
  lang: initialLang,
  events: createEmitter(),
  targets: { sceneDepth: null, plume: null },
  colliders: [],
  hotspots: [],
  renderView: () => {},
};
ctx.scene.name = 'main';
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ctx.quality.pixelRatio));
// Preset globals BEFORE any module init (env bakes its first sky from them). No listeners exist yet.
applyPresetToGlobals(ctx, ctx.preset);
ctx.globals.uDrift.value = initialDrift ? 1 : 0;

// Progressive accumulation restarts whenever the image would change (contracts: core resets uFrame).
for (const type of ['camera-moved', 'preset', 'quality', 'drift', 'reset-accumulation'] as const) {
  ctx.events.on(type, () => { ctx.globals.uFrame.value = 0; });
}
// Idle gate: every event that can change the image keeps the frame loop drawing for a few frames (the volume pass,
// the shadow settle and the sky rebake then hold it awake for as long as they need; see needsFrame()).
let awakeFrames = 8;
const wake = (n = 6): void => { awakeFrames = Math.max(awakeFrames, n); };
for (const type of ['camera-moved', 'camera-mode', 'preset', 'quality', 'lang', 'edu', 'drift', 'reset-accumulation'] as const) {
  ctx.events.on(type, () => wake());
}

const pipeline = new Pipeline(ctx);

// ── modules ─────────────────────────────────────────────────────────────────────────────────────
const controls = new CameraController({ initialMode });
controls.init(ctx);
const env = new EnvironmentModule(bakeOverride ? { bakeRes: bakeOverride } : {});
const vehicle = new VehicleModule();
const pad = new PadModule();
const plume = new PlumeModule();
const volume = new VolumeModule();
const edu = new EduModule({ onFocus: (point, distance) => { void controls.focusOn(point, distance); } });
let post: PostChain | null = null;

/** Updated every frame, in this order, after the camera controller. */
const frameModules: Module[] = [plume, volume, vehicle, pad, env, edu];
/** Modules that do NOT subscribe to 'quality' themselves (plume, volume and post do). */
const qualityModules: Array<{ onQuality?(q: typeof ctx.quality): void }> = [env, vehicle, pad, edu];

// ── app state + handlers ────────────────────────────────────────────────────────────────────────
let exporting = false;
let probe: FrameProbe | null = null;
let probeRounds = 0;
let probedPixels = 0;   // drawing-buffer pixels when the last probe was armed

const app = {
  ctx, controller: controls, pipeline, ui: null as unknown as UiShell,
  modules: { controls, env, vehicle, pad, plume, volume, edu, post: null as PostChain | null },
  ready: false,
  /** Frame-loop ticks (drawn or skipped by the idle gate). */
  frames: 0,
  /** Frames actually drawn. */
  drawn: 0,
  /** Renderer stats of the last drawn frame (the idle gate skips frames, so renderer.info itself reads 0 while idle). */
  stats: { calls: 0, triangles: 0, programs: 0, idle: false },
  gpu: guess,
  invalidate: () => wake(12),
  setPreset, setQuality, setMode, setEdu, setLang, setDrift,
  exportStill: doExport,
  recordLoop: doRecordLoop,
};
(window as unknown as { app: typeof app }).app = app;

function setPreset(id: LightingPresetId): void {
  const p = PRESETS[id];
  if (!p) return;
  if (p !== ctx.preset) applyPresetToGlobals(ctx, p);   // emits 'preset' (core, env, plume, volume, post react)
  app.ui?.update({ preset: id });
}

/** > 0 while the programs of a new quality level link in the background: the last frame stays on screen (no stall). */
let compiling = 0;
let qualityQueued: QualityId | null = null;

function applyQualitySync(id: QualityId): void {
  if (ctx.quality.id === id) return;
  const q = QUALITY[id];
  ctx.quality = q;
  pipeline.applyQuality(q);
  for (const m of qualityModules) m.onQuality?.(q);
  ctx.events.emit({ type: 'quality', quality: q });     // plume, volume and post subscribe themselves
}

/**
 * A tier changes shader defines (pad / vehicle detail octaves, post kernels). While the app is running, the modules
 * get the new tier first, the programs link in the background with the OLD canvas still on screen, and only then are the
 * canvas and the render targets resized (a canvas resize blanks it until the next draw, so it must not sit in front of
 * a long compile). With KHR_parallel_shader_compile the main thread is not blocked meanwhile.
 */
function applyQualityLevel(id: QualityId): void {
  if (!app.ready) { applyQualitySync(id); return; }
  if (compiling > 0) { qualityQueued = id; return; }      // one change in flight: the latest request wins afterwards
  if (ctx.quality.id === id) return;
  const q = QUALITY[id];
  ctx.quality = q;
  for (const m of qualityModules) m.onQuality?.(q);
  compiling++;
  void pipeline.precompile(true)
    .catch((e) => console.warn('[app] precompile after quality change failed', e))
    .finally(() => {
      pipeline.applyQuality(q);
      ctx.events.emit({ type: 'quality', quality: q });
      compiling--;
      wake(12);
      const next = qualityQueued;
      qualityQueued = null;
      if (next && next !== ctx.quality.id) applyQualityLevel(next);
    });
}

function armProbe(): void {
  probe = new FrameProbe();
  probedPixels = ctx.globals.uResolution.value.x * ctx.globals.uResolution.value.y;
}

function setQuality(choice: QualityChoice): void {
  qualityChoice = choice;
  applyQualityLevel(effective());
  app.ui?.update({ quality: choice, effectiveQuality: effective() });
  probe = null;
  if (choice === 'auto' && probeEnabled && app.ready) armProbe();
  probeRounds = 0;
}

function setMode(m: CameraModeId): void {
  controls.setMode(m);
  app.ui?.update({ mode: controls.getMode() });
}

function setEdu(on: boolean): void {
  edu.setEnabled(on);
  ctx.events.emit({ type: 'edu', enabled: on });
}

function setLang(l: Lang): void {
  i18nSetLang(l);
  ctx.lang = l;
  ctx.events.emit({ type: 'lang', lang: l });
  app.ui?.update({ lang: l });
}

function setDrift(on: boolean): void {
  ctx.globals.uDrift.value = on ? 1 : 0;
  ctx.events.emit({ type: 'drift', enabled: on });
  app.ui?.update({ drift: on });
}

/** Overlay (edu annotations) state that the camera-moved event does not cover: which 3D objects are visible. */
let overlaySig = '';
function overlaySignature(): string {
  let sig = pipeline.overlayScene.visible ? '1' : '0';
  pipeline.overlayScene.traverse((o) => { sig += o.visible ? '1' : '0'; });
  return sig;
}

/** Does anything on screen still change? False -> the frame is skipped and the GPU idles (see src/core/idle.ts). */
let skyJobWas = false;
function needsFrame(): boolean {
  const sig = overlaySignature();
  const overlayChanged = sig !== overlaySig;
  overlaySig = sig;
  // the sky swap happens in the tick the re-bake finishes (job already gone): that tick must still draw it
  const skyJob = !!(env as unknown as { skyJob?: unknown }).skyJob;
  const skyJobRunning = skyJob || skyJobWas;
  skyJobWas = skyJob;
  return shouldDraw({
    gate: idleGate,
    ready: app.ready,
    awakeFrames,
    drifting: ctx.globals.uDrift.value > 0,
    volumeConverged: volume.pass.converged,
    pipelineBusy: pipeline.busy,
    skyJobRunning,
    overlayChanged,
    compiling: compiling > 0,
  });
}

let lastDrew = true;
let eduIdleTick = 0;

/** One full frame: camera, globals, modules, then (unless idle) the frame graph. Returns true if it drew. */
function step(dt: number, t: number, force = false, freezeCamera = false): boolean {
  if (!freezeCamera) controls.update(dt, t);
  // While a new quality tier links its programs nothing else may draw: a module update can render on its own (the mirror
  // pass of the tidal pools) and would link the not-yet-compiled variants synchronously, i.e. the stall we are hiding.
  if (!force && compiling > 0) { lastDrew = false; return false; }
  pipeline.beginFrame(t);   // shadow refresh arming + per-frame globals (time, camera position, resolution)
  for (const m of frameModules) {
    // the education layer lays out DOM (bounding boxes, label placement): while nothing is drawn, 15 Hz is plenty
    if (m === edu && !lastDrew && (++eduIdleTick & 3) !== 0) continue;
    m.update?.(dt, t);
  }
  if (!force && !needsFrame()) { lastDrew = false; return false; }
  lastDrew = true;
  if (awakeFrames > 0) awakeFrames--;
  pipeline.render(dt);
  pipeline.endFrame();
  ctx.globals.uFrame.value++;
  app.drawn++;
  const info = renderer.info;
  app.stats.calls = info.render.calls;
  app.stats.triangles = info.render.triangles;
  app.stats.programs = info.programs?.length ?? 0;
  return true;
}

/** Export a converged still at 2x (PNG download). `download: false` returns the blob instead (QA). */
async function doExport(download = true): Promise<ExportResult | null> {
  if (exporting || !app.ready) return null;
  exporting = true;
  let res: ExportResult | null = null;
  let clock = performance.now();
  try {
    res = await exportStill(ctx, () => {
      const now = performance.now();
      const dt = Math.min((now - clock) / 1000, 0.1);
      clock = now;
      step(dt, ctx.globals.uTime.value + dt, true, true);   // the camera stays put while the still converges
    }, 2, {
      frames: 32,
      download,
      resize: (w, h, pr) => pipeline.resizeDrawingBuffer(w, h, pr),
    });
    if (res && download) app.ui.toast(t('app.toast.saved', { file: res.filename, w: res.width, h: res.height }), 4000);
  } catch (e) {
    console.error(e);
    app.ui.toast(t('app.toast.exportFailed'));
  } finally {
    pipeline.resize();
    exporting = false;
    wake(12);
  }
  return res;
}

/** Options of app.recordLoop. Defaults: this screen's device-pixel size, 15 s, 30 fps, 2 s crossfade, 3 s warm-up. */
interface LoopRequest extends Partial<LoopSettings> {
  /** Warm-up before the first captured frame (s): the drift EMA of the steam settles. */
  warmup?: number;
  /** false: return the blobs instead of downloading (scripts). */
  download?: boolean;
  /** Called with every progress report (scripts). */
  onProgress?: (p: RecordProgress) => void;
  /** Encoder tuning (scripts): codec preference, bits per pixel per frame, bitrate mode. */
  codecs?: RecordOptions['codecs'];
  bitsPerPixel?: number;
  bitrateMode?: RecordOptions['bitrateMode'];
  encoder?: RecordOptions['encoder'];
}

const CODEC_LABEL: Record<string, string> = { avc: 'H.264', vp9: 'VP9', av1: 'AV1', hevc: 'HEVC' };
let loopAbort = false;

/**
 * Record a seamless wallpaper loop (MP4) plus its poster PNG (= video frame 0). Resolves to null when cancelled or busy.
 * The framing is the live view: the recording shows the largest centred crop of the window with the output aspect.
 */
async function doRecordLoop(req: LoopRequest = {}): Promise<RecordResult | null> {
  if (exporting || compiling > 0 || !app.ready) return null;
  const scr = screenDims(screen.width, screen.height, window.devicePixelRatio || 1);
  const { width, height } = evenDims(req.width ?? scr.width, req.height ?? scr.height);
  const settings = { width, height, fps: req.fps ?? 30, seconds: req.seconds ?? 15, crossfade: req.crossfade ?? 2, warmup: req.warmup ?? 3 };
  const gl = renderer.getContext();
  const maxDim = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number);
  if (width > maxDim || height > maxDim) {
    throw new Error(t('ui.loop.rec.toobig', { w: width, h: height }));   // the shell toasts it
  }

  exporting = true;       // pauses the frame loop and resize handling; step(..., force) below bypasses the idle gate
  loopAbort = false;
  const prev = { aspect: camera.aspect, fov: camera.fov, drift: ctx.globals.uDrift.value > 0, hidden: ui.uiHidden, hotkeys: ui.hotkeys };
  const overlay = ui.recording;
  // Static film grain while recording (as in a frozen still): grain re-seeded every frame is most of the frame-to-frame
  // signal, which starves the encoder, and the crossfade would average two grain fields (visibly less grain at the seam).
  const finish = post?.effects.finish ?? null;
  const finishOnFrame = finish?.onFrame ?? null;
  overlay.begin(width, height, () => { loopAbort = true; });
  let result: RecordResult | null = null;
  let failed: unknown = null;
  try {
    ui.hotkeys = false;
    ui.setUiHidden(true);      // also hides the 3D annotations (edu overlay scene) through the MutationObserver
    const { recordLoop } = await import('./record/recorder.ts');

    // Output framing: the crop of the live view (see the framing guide in the loop panel).
    const crop = framingCrop(prev.aspect, width / height);
    camera.aspect = width / height;
    camera.fov = recordFovDeg(prev.fov, crop);
    camera.updateProjectionMatrix();
    pipeline.resizeDrawingBuffer(width, height, 1);
    pipeline.invalidateShadows();                          // the shadow map is final from the first warm-up frame on
    if (!prev.drift) setDrift(true);                        // emits 'drift': the accumulation restarts
    ctx.events.emit({ type: 'camera-moved' });              // reflections re-render at the new projection
    ctx.events.emit({ type: 'reset-accumulation' });
    if (finish) finish.onFrame = () => { finishOnFrame?.(); finish.setSeed(0); };

    let simT = ctx.globals.uTime.value;
    result = await recordLoop({
      canvas,
      renderFrame: (dt) => { simT += dt; step(dt, simT, true, true); },   // fixed dt, frozen camera, never idle-gated
    }, {
      ...settings,
      codecs: req.codecs, bitsPerPixel: req.bitsPerPixel, bitrateMode: req.bitrateMode, encoder: req.encoder,
      aborted: () => loopAbort,
      onProgress: (p) => { overlay.progress(p); req.onProgress?.(p); },
    });
    if (result) {
      const r = result;
      console.info(`[loop] ${r.stem}: ${r.frames} frames ${r.width}x${r.height}@${r.fps} ${r.codec} (${r.mimeType}), ${(r.video.size / 1e6).toFixed(1)} MB, `
        + `render ${(r.renderMs / 1000).toFixed(1)} s (${(r.frames / (r.renderMs / 1000)).toFixed(1)} output fps), total ${(r.totalMs / 1000).toFixed(1)} s`);
    }
  } catch (e) {
    failed = e;
    console.error('[loop] recording failed', e);
  } finally {
    if (finish) finish.onFrame = finishOnFrame;
    camera.aspect = prev.aspect;
    camera.fov = prev.fov;
    camera.updateProjectionMatrix();
    pipeline.resize();
    if (!prev.drift) setDrift(false);
    ui.setUiHidden(prev.hidden);
    ui.hotkeys = prev.hotkeys;
    exporting = false;
    wake(12);
  }

  if (failed) {
    const code = (failed as { code?: string }).code;
    const msg = code === 'no-codec' || code === 'no-webcodecs' ? t('ui.loop.rec.nocodec') : String((failed as Error)?.message ?? failed);
    if (req.download === false) { overlay.close(); throw failed; }
    overlay.fail(msg, () => {});
    return null;
  }
  if (!result) { overlay.close(); ui.toast(t('ui.loop.rec.cancelled')); return null; }
  if (req.download === false) { overlay.close(); return result; }
  const r = result;
  // Same stem: the wallpaper plugin plays <stem>.mp4 when the background is <stem>.png.
  saveBlob(r.video, `${r.stem}.mp4`);
  saveBlob(r.poster, `${r.stem}.png`);
  overlay.done({ stem: r.stem, video: r.video, poster: r.poster, codecLabel: CODEC_LABEL[r.codec] ?? r.codec, width: r.width, height: r.height }, () => {});
  return result;
}

const handlers: UiHandlers = {
  setCameraMode: (m) => setMode(m),
  setPreset: (p) => setPreset(p),
  setQuality: (q) => setQuality(q),
  setDrift: (v) => setDrift(v),
  setEdu: (v) => setEdu(v),
  setLang: (l) => setLang(l),
  exportStill: async () => { await doExport(); },
  setLens: (p) => controls.setLens(p),
  resetLens: () => controls.resetLens(),
  recordLoop: async (s) => { await doRecordLoop(s); },
};

const ui = new UiShell(uiRoot, handlers, {
  mode: controls.getMode(),
  preset: initialPreset,
  quality: qualityChoice,
  drift: initialDrift,
  edu: initialEdu,
  lang: initialLang,
  lens: controls.lens,
  T_F,
  effectiveQuality: effective(),
});
app.ui = ui;

// "H" (and ?ui=0) hides the shell; the edu layer follows it (the shell has no event for this, so watch its class).
const shellEl = uiRoot.querySelector('[data-ui-shell]');
if (shellEl) {
  const sync = () => {
    const hidden = shellEl.classList.contains('is-hidden');
    document.body.classList.toggle('ui-hidden', hidden);
    pipeline.overlayScene.visible = !hidden;    // the 3D annotations (edu arrows, sound front) hide with the UI
  };
  new MutationObserver(sync).observe(shellEl, { attributes: true, attributeFilter: ['class'] });
  sync();
}
if (hideUi) ui.setUiHidden(true);

// UI <- app state
ctx.events.on('camera-mode', (e) => ui.update({ mode: e.mode }));
ctx.events.on('edu', (e) => ui.update({ edu: e.enabled }));
ctx.events.on('drift', (e) => ui.update({ drift: e.enabled }));

// ── loading ─────────────────────────────────────────────────────────────────────────────────────
let loadFrac = 0;
const stage = (label: string, f: number): void => { loadFrac = Math.max(loadFrac, f); ui.setLoading(label, loadFrac); };
THREE.DefaultLoadingManager.onProgress = (_url, loaded, total) => stage('models', 0.05 + 0.25 * (loaded / Math.max(total, 1)));
// Resizing blanks the canvas until the next draw, so it is applied at the START of an animation frame, right before that
// frame draws (a resize event fires before the frame's rAF callbacks; doing it in a separate rAF callback would present
// one blank frame). Bursts (dragging a window edge) also coalesce into one reallocation per frame.
let resizePending = false;
function flushResize(): void {
  if (!resizePending || exporting || compiling > 0) return;
  resizePending = false;
  pipeline.resize();
  // A much bigger canvas (fullscreen, a 4K monitor) makes an earlier "ok" verdict stale: measure again (auto only).
  const px = ctx.globals.uResolution.value.x * ctx.globals.uResolution.value.y;
  if (app.ready && probeEnabled && qualityChoice === 'auto' && !probe && probeRounds < 2 && probeStale(probedPixels, px)) armProbe();
}
addEventListener('resize', () => { resizePending = true; if (!app.ready) flushResize(); });
// The drawing buffer can be discarded while the tab is in the background (mobile browsers): redraw on return.
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(12); });
addEventListener('pageshow', () => wake(12));

async function start(): Promise<void> {
  stage('models', 0.03);
  // Three independent loads/bakes in parallel: the env sky bake (GPU, yields per face), the two GLBs (network).
  let done = 0;
  const part = (label: string) => () => { done++; stage(label, 0.05 + 0.4 * (done / 3)); };
  await Promise.all([
    env.init(ctx).then(part('textures')),
    vehicle.init(ctx).then(part('models')),
    pad.init(ctx).then(part('pad')),
  ]);
  pipeline.setEnvironment(env);
  // env's preset reaction must be exactly once per preset (it bakes synchronously), then the PMREM follows it.
  ctx.events.on('preset', (e) => { env.onPreset(e.preset); pipeline.rebuildEnvironment(); });

  stage('clouds', 0.5);
  plume.init(ctx);
  await volume.init(ctx);
  stage('clouds', 0.8);

  post = createPostChain(ctx);
  app.modules.post = post;
  pipeline.build({ plume, volume, post: post.passes });
  post.setLens(controls.lens);
  controls.onLensChange((lens) => { ui.update({ lens }); post?.setLens(lens); });

  edu.init(ctx);
  edu.overlayGroup.removeFromParent();
  pipeline.overlayScene.add(edu.overlayGroup);

  stage('shaders', 0.85);
  await pipeline.precompile(true);
  stage('shaders', 0.95);

  // Warm frames under the loading screen, so the first frame the user sees is a complete one: every program is
  // linked, every texture uploaded and the cloud accumulation has covered every pixel (the first visits are the noisy
  // ones). Bounded by time so a slow GPU does not make the loading screen last.
  const timer = new THREE.Timer();
  timer.connect(document);
  const nextFrame = (): Promise<void> => new Promise((res) => {
    let fired = false;
    const go = (): void => { if (!fired) { fired = true; res(); } };
    requestAnimationFrame(go);
    setTimeout(go, 120);   // a hidden tab never delivers rAF: do not hang the loading screen
  });
  stage('frame', 0.97);
  // first frame with tilt-shift on: links its three programs now instead of at the first click on the lens panel
  post.setLens({ ...controls.lens, tiltShift: { ...controls.lens.tiltShift, enabled: true } });
  step(1 / 60, 0, true);
  post.setLens(controls.lens);
  await nextFrame();
  const warmStart = performance.now();
  for (let i = 0; i < WARM_FRAMES_MAX; i++) {
    step(1 / 60, i / 60, true);
    await nextFrame();
    if (i >= 5 && (volume.pass.converged || performance.now() - warmStart > 2500)) break;
  }
  stage('ready', 1);
  if (initialEdu) setEdu(true);
  ui.hideLoading();
  app.ready = true;
  wake(12);
  if (openLoop && !hideUi) ui.openLoop();
  if (qualityChoice === 'auto' && probeEnabled) armProbe();

  let fps = 60;
  let prevDrew = false;
  let lastDrawAt = performance.now();
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const raw = timer.getDelta();
    app.frames++;
    if (exporting) return;
    flushResize();
    const dt = Math.min(raw, 0.1);
    const drew = step(dt, timer.getElapsed());
    if (drew) {
      lastDrawAt = performance.now();
      // frame-time statistics only from back-to-back drawn frames: after idle, the interval is not a frame time
      if (prevDrew && raw > 0 && raw < 0.5) fps += (1 / raw - fps) * 0.05;
      ui.update({ fps });
      // The probe measures the EXPENSIVE state (clouds still marching): converged frames are near-free and would
      // make a slow GPU look fast.
      if (probe && prevDrew && raw < 0.25 && !volume.pass.converged) {
        probe.feed(raw);
        if (probe.done) {
          const verdict = probe.verdict;
          console.info(`[app] quality probe at ${ctx.quality.id}: median ${probe.medianMs.toFixed(1)} ms -> ${verdict}`);
          probe = null;
          if (verdict === 'down' && autoLevel !== 'low' && qualityChoice === 'auto' && probeRounds < 2) {
            autoLevel = lowerQuality(autoLevel);
            probeRounds++;
            applyQualityLevel(autoLevel);
            ui.update({ effectiveQuality: autoLevel });
            ui.toast(t('app.toast.qualityDown', { q: t(`ui.quality.${autoLevel}`) }));
            armProbe();
          }
        }
      }
    } else if (performance.now() - lastDrawAt > 1200) {
      ui.update({ fps: undefined });   // idle: nothing is being drawn, so there is no frame rate to show
    }
    prevDrew = drew;
    app.stats.idle = !drew;
  });
}

start().catch((e) => { fatal(e); ui.setLoading(String((e as Error)?.message ?? e), loadFrac); });
