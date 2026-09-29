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
// Per frame: controls.update -> globals (time, camera, resolution) -> module updates -> pipeline.render -> uFrame++.
//
// URL parameters (QA / deep links):
//   ?preset=photo|noon|night|thermal|clay  ?mode=orbit|photo|walk|fly  ?quality=auto|low|medium|high|ultra
//   ?edu=1  ?lang=en|fi  ?ui=0 (hide all chrome)  ?drift=1  ?probe=0 (no auto-quality probe)
//   ?bake=512 (sky cube face size override; for software-rendered QA only)
// window.app = { ctx, controller, modules, pipeline, ui, setPreset, setQuality, setMode, setEdu, setLang, setDrift,
//                exportStill, ready, frames } for scripted screenshots (scripts/qa-*.mjs).
import './styles/tokens.css';
import './styles/app.css';
import * as THREE from 'three';
import type { AppContext, CameraModeId, Lang, LightingPresetId, Module, QualityChoice, QualityId } from './contracts.ts';
import { createEmitter, createGlobals } from './core/context.ts';
import { CAMERA_FAR, CAMERA_NEAR, Pipeline, createRenderer } from './core/pipeline.ts';
import { FrameProbe, QUALITY_LEVELS, guessQuality, lowerQuality } from './core/quality.ts';
import { ANCHORS, QUALITY, T_F } from './scene-config.ts';
import { registerStrings, setLang as i18nSetLang, t } from './i18n.ts';
import { PRESET_ORDER, UiShell, type UiHandlers } from './ui/index.ts';
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
const probeEnabled = params.get('probe') !== '0';
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

const app = {
  ctx, controller: controls, pipeline, ui: null as unknown as UiShell,
  modules: { controls, env, vehicle, pad, plume, volume, edu, post: null as PostChain | null },
  ready: false,
  frames: 0,
  gpu: guess,
  setPreset, setQuality, setMode, setEdu, setLang, setDrift,
  exportStill: doExport,
};
(window as unknown as { app: typeof app }).app = app;

function setPreset(id: LightingPresetId): void {
  const p = PRESETS[id];
  if (!p) return;
  if (p !== ctx.preset) applyPresetToGlobals(ctx, p);   // emits 'preset' (core, env, plume, volume, post react)
  app.ui?.update({ preset: id });
}

function applyQualityLevel(id: QualityId): void {
  if (ctx.quality.id === id) return;
  const q = QUALITY[id];
  ctx.quality = q;
  pipeline.applyQuality(q);
  for (const m of qualityModules) m.onQuality?.(q);
  ctx.events.emit({ type: 'quality', quality: q });     // plume, volume and post subscribe themselves
}

function setQuality(choice: QualityChoice): void {
  qualityChoice = choice;
  applyQualityLevel(effective());
  app.ui?.update({ quality: choice, effectiveQuality: effective() });
  probe = choice === 'auto' && probeEnabled && app.ready ? new FrameProbe() : null;
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

/** One full frame: camera, globals, modules, frame graph. */
function step(dt: number, t: number): void {
  controls.update(dt, t);
  pipeline.beginFrame(t);   // shadow refresh arming + per-frame globals (time, camera position, resolution)
  for (const m of frameModules) m.update?.(dt, t);
  pipeline.render(dt);
  ctx.globals.uFrame.value++;
  app.frames++;
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
      step(dt, ctx.globals.uTime.value + dt);
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
  }
  return res;
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
addEventListener('resize', () => { if (!exporting) pipeline.resize(); });

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

  // warm frames under the loading screen: the first frame the user sees is a complete one
  const timer = new THREE.Timer();
  timer.connect(document);
  for (let i = 0; i < 2; i++) step(1 / 60, i / 60);
  stage('ready', 1);
  if (initialEdu) setEdu(true);
  ui.hideLoading();
  app.ready = true;
  if (qualityChoice === 'auto' && probeEnabled) probe = new FrameProbe();

  let fps = 60;
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const raw = timer.getDelta();
    if (exporting) return;
    const dt = Math.min(raw, 0.1);
    step(dt, timer.getElapsed());
    if (raw > 0 && raw < 0.5) fps += (1 / raw - fps) * 0.05;
    ui.update({ fps });
    if (probe && raw < 0.25) {
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
          probe = new FrameProbe();
        }
      }
    }
  });
}

start().catch((e) => { fatal(e); ui.setLoading(String((e as Error)?.message ?? e), loadFrac); });
