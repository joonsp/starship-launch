// Sandbox for the UI shell: renders it over a gradient with fake handlers that log to the console.
// Query flags: ?bg=photo (reference photo backdrop, local contrast check), ?noload (skip the loading screen).
// window.app.ui is the shell; window.app.state mirrors what an integrator would hold.
import '../src/styles/tokens.css';
import { createSandbox } from './harness.ts';
import { setLang } from '../src/i18n.ts';
import { UiShell } from '../src/ui/shell.ts';
import type { UiHandlers, UiState } from '../src/ui/shell.ts';
import { missingTranslations } from '../src/i18n.ts';

const params = new URLSearchParams(location.search);
if (params.get('bg') === 'photo') document.body.classList.add('photo');

const sb = await createSandbox({ title: 'UI shell', lights: false });
document.body.style.background = '';                     // the harness sets #000; the page CSS gradient is the backdrop
sb.ctx.canvas.style.opacity = '0';                       // keep rendering (sb.frames advances) but show the gradient
sb.ctx.uiRoot.firstElementChild?.remove();               // harness label would overlap the top bar
sb.start();

const state: UiState = {
  mode: 'photo', preset: 'photo', quality: 'auto', drift: false, edu: false, lang: 'en', T_F: 7.2,
  fps: 60, effectiveQuality: 'high',
  lens: { fovDeg: 42.5, dollyZoom: false, rollDeg: 0, tiltShift: { enabled: false, focusY: 0.5, band: 0.2, blur: 0.5 } },
};
const log = (...a: unknown[]) => console.log('[handler]', ...a);
let ui!: UiShell;
const handlers: UiHandlers = {
  setCameraMode: (m) => { log('setCameraMode', m); state.mode = m; ui.update({ mode: m }); },
  setPreset: (p) => { log('setPreset', p); ui.update({ preset: p }); },
  setQuality: (q) => { log('setQuality', q); ui.update({ quality: q }); },
  setDrift: (v) => log('setDrift', v),
  setEdu: (v) => log('setEdu', v),
  setLang: (l) => { log('setLang', l); setLang(l); },
  exportStill: () => new Promise<void>((r) => setTimeout(() => { ui.toast('Saved starship-f14.png'); r(); }, 600)),
  setLens: (p) => log('setLens', JSON.stringify(p)),
  recordLoop: (s) => log('recordLoop', JSON.stringify(s)),
  resetLens: () => { log('resetLens'); ui.update({ lens: { fovDeg: 42.5, dollyZoom: false, rollDeg: 0, tiltShift: { enabled: false, focusY: 0.5, band: 0.2, blur: 0.5 } } }); },
};
ui = new UiShell(sb.ctx.uiRoot, handlers, state);
Object.assign((window as any).app, { ui, state, missing: missingTranslations });

// Simulated loading sequence (skipped with ?noload; ?hold keeps the loading screen up for screenshots).
if (params.has('noload')) ui.hideLoading();
else if (!params.has('hold')) {
  const stages: Array<[string, number]> = [['models', 0.25], ['textures', 0.5], ['clouds', 0.85], ['shaders', 0.97], ['ready', 1]];
  let i = 0;
  const tick = () => { const [l, f] = stages[i++]; ui.setLoading(l, f); if (i < stages.length) setTimeout(tick, 350); else setTimeout(() => ui.hideLoading(), 400); };
  tick();
} else ui.setLoading('clouds', 0.62);
