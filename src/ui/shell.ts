// The app UI shell: loading screen, top bar, camera / lighting / quality controls, lens panel, help,
// walk overlay, toasts and credits. OWNER: src/ui.
//
// Design rules
//  - Pure DOM + CSS; no runtime three.js dependency (types only).
//  - The shell root is click-transparent; every panel opts in with pointer-events:auto and stops
//    pointer events from bubbling, so a click on the UI never reaches the canvas (walk-mode pointer
//    lock starts from a canvas click).
//  - update() diffs against the previous state and touches only changed controls (fps arrives every
//    frame and only rewrites one text node when the rounded value changes).
//  - Hotkeys owned by the shell (the controller must NOT bind these): 1-4, L (Shift+L back), R, E
//    (ignored in fly mode, where Q/E mean down/up), H, ?, [ ], comma, period, and Esc (closes overlays).
//    Everything else (WASD, Shift, Ctrl, Space, Q/E in fly, Esc to release the pointer) is the controller's.
import './ui.css';
import './strings.ts';
import type { CameraModeId, Lang, LensState, LightingPresetId, QualityId } from '../contracts.ts';
import { fmt, getLang, onLangChange, t } from '../i18n.ts';
import { Binder, Menu, Modal, Segmented, Slider, Switch, h, iconButton, isTextEntry } from './dom.ts';
import { ICONS, MARK } from './icons.ts';
import { LoadingScreen } from './loading.ts';
import { LENS_RANGES, MODE_ORDER, PRESET_ORDER, QUALITY_ORDER } from './types.ts';
import type { QualityChoice, UiHandlers, UiState } from './types.ts';

export type { QualityChoice, UiHandlers, UiState } from './types.ts';
export { LENS_RANGES, LOADING_STAGES, MODE_ORDER, PRESET_ORDER, QUALITY_ORDER } from './types.ts';

const IDLE_MS = 4000;
const MOBILE_MQ = '(max-width: 860px)';
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export class UiShell {
  /** Master switch for the shell's keyboard shortcuts (e.g. turn off while a text field elsewhere has focus). */
  hotkeys = true;
  /** Dim the chrome after IDLE_MS of inactivity. */
  autoDim = true;

  private readonly root: HTMLElement;
  private readonly shell: HTMLElement;
  private readonly binder = new Binder();
  private state: UiState;
  private loading: LoadingScreen;
  private disposers: Array<() => void> = [];

  // chrome
  private top!: HTMLElement;
  private dock!: HTMLElement;
  private secondary!: HTMLElement;
  private menuBtn!: HTMLButtonElement;
  private fpsEl!: HTMLElement;
  private badge!: HTMLElement;
  private modeSeg!: Segmented<CameraModeId>;
  private langSeg!: Segmented<Lang>;
  private presetMenu!: Menu<LightingPresetId>;
  private qualityMenu!: Menu<QualityChoice>;
  private driftSw!: Switch;
  private eduSw!: Switch;
  private lensBtn!: HTMLButtonElement;
  private exportBtns: HTMLButtonElement[] = [];
  private menus: Array<Menu<any>> = [];

  // lens panel
  private lensPanel!: HTMLElement;
  private fovSl!: Slider;
  private rollSl!: Slider;
  private focusSl!: Slider;
  private bandSl!: Slider;
  private blurSl!: Slider;
  private dolly!: HTMLInputElement;
  private tsSw!: Switch;
  private tsGroup!: HTMLElement;

  // overlays
  private help!: Modal;
  private about!: Modal;
  private walk!: HTMLElement;
  private walkPrompt!: HTMLElement;
  private walkHint!: HTMLElement;
  private cross!: HTMLElement;
  private toasts!: HTMLElement;
  private eduSlot!: HTMLElement;

  private idleTimer = 0;
  private locked = false;
  private hiddenAll = false;
  private hiddenToastShown = false;
  private fpsShown = -1;
  private mq = matchMedia(MOBILE_MQ);
  private exporting = false;

  constructor(root: HTMLElement, private handlers: UiHandlers, state: UiState) {
    this.root = root;
    this.state = { ...state, lens: { ...state.lens, tiltShift: { ...state.lens.tiltShift } } };
    this.shell = h('div', { class: 'ui-shell', 'data-ui-shell': '' });
    this.locked = !!(state.locked ?? document.pointerLockElement);

    this.buildTop();
    this.buildDock();
    this.buildLens();
    this.buildWalk();
    this.buildModals();
    this.toasts = h('div', { class: 'ui-toasts', role: 'status', 'aria-live': 'polite' });
    this.loading = new LoadingScreen(() => this.state.T_F, this.binder);

    this.shell.append(this.top, this.lensPanel, this.walk, this.dock, this.toasts, this.help.el, this.about.el, this.loading.el);
    root.append(this.shell);
    this.placeEdu();
    this.syncAll();
    this.setChromeInert(true);      // the loading screen covers everything until hideLoading()
    this.wireGlobal();
    this.wake();
  }

  // ── public API ──────────────────────────────────────────────────────────────────────────────────

  /** Push app-side state changes into the UI. Only changed controls are touched. */
  update(p: Partial<UiState>): void {
    const s = this.state;
    if (p.T_F !== undefined && p.T_F !== s.T_F) { s.T_F = p.T_F; this.binder.refresh(); }
    if (p.mode !== undefined && p.mode !== s.mode) { s.mode = p.mode; this.modeSeg.set(p.mode); this.syncOverlay(); }
    if (p.preset !== undefined && p.preset !== s.preset) { s.preset = p.preset; this.presetMenu.set(p.preset); }
    if ((p.quality !== undefined && p.quality !== s.quality) || (p.effectiveQuality !== undefined && p.effectiveQuality !== s.effectiveQuality)) {
      if (p.quality !== undefined) s.quality = p.quality;
      if (p.effectiveQuality !== undefined) s.effectiveQuality = p.effectiveQuality;
      this.qualityMenu.set(s.quality);
    }
    if (p.drift !== undefined && p.drift !== s.drift) { s.drift = p.drift; this.driftSw.set(p.drift); }
    if (p.edu !== undefined && p.edu !== s.edu) { s.edu = p.edu; this.eduSw.set(p.edu); }
    if (p.lang !== undefined && p.lang !== s.lang) { s.lang = p.lang; this.langSeg.set(p.lang); }
    if (p.lens !== undefined) { s.lens = { ...p.lens, tiltShift: { ...p.lens.tiltShift } }; this.syncLens(); }
    if ('fps' in p) { s.fps = p.fps; this.syncFps(); }
    if (p.locked !== undefined && p.locked !== this.locked) { this.locked = p.locked; this.syncOverlay(); }
  }

  /** Show progress on the loading screen. `label` is a stage id (models, textures, pad, clouds, shaders, ready) or free text. */
  setLoading(label: string, fraction: number): void { this.loading.set(label, fraction); }

  /** Fade the loading screen out and hand the UI over. Safe to call more than once. */
  hideLoading(): void {
    if (!this.loading.visible) return;
    void this.loading.hide();
    this.shell.classList.add('is-ready');
    this.syncVisibility();
    this.wake();
  }

  /** Transient message near the bottom of the screen (also shown while the UI is hidden). */
  toast(msg: string, ms = 2600): void {
    for (const old of Array.from(this.toasts.children)) if (old.textContent === msg) old.remove();
    while (this.toasts.children.length >= 3) this.toasts.firstElementChild?.remove();
    const el = h('div', { class: 'ui-toast ui-glass' }, msg);
    this.toasts.append(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    setTimeout(() => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 260); }, ms);
  }

  /** Reset the auto-dim timer (called automatically on any user activity). */
  wake(): void {
    this.shell.classList.remove('is-idle');
    clearTimeout(this.idleTimer);
    if (!this.autoDim) return;
    this.idleTimer = window.setTimeout(() => {
      if (!this.anyPopoverOpen()) this.shell.classList.add('is-idle');
      else this.wake();
    }, IDLE_MS);
  }

  /** True if an event target lies inside the shell (controllers can use this to ignore UI clicks). */
  static isUiTarget(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest('[data-ui-shell]');
  }

  showHelp(open = true): void { open ? this.help.show() : this.help.close(); }
  showAbout(open = true): void { open ? this.about.show() : this.about.close(); }
  get uiHidden(): boolean { return this.hiddenAll; }
  setUiHidden(hidden: boolean): void { this.hiddenAll = hidden; this.syncVisibility(); }

  dispose(): void {
    clearTimeout(this.idleTimer);
    this.disposers.forEach((d) => d());
    this.shell.remove();
  }

  // ── construction ────────────────────────────────────────────────────────────────────────────────

  private buildTop(): void {
    const b = this.binder;
    const brand = h('div', { class: 'ui-brand ui-glass' }, h('span', { class: 'ui-brand-mark', html: MARK }),
      h('span', { class: 'ui-brand-name' }, h('strong', {}, 'Starship'), h('span', { class: 'ui-brand-sep' }, '·'), h('span', { class: 'ui-brand-flight' })));
    const flight = brand.querySelector('.ui-brand-flight')!;
    const strong = brand.querySelector('strong')!;
    b.add(() => { strong.textContent = t('ui.title'); flight.textContent = t('ui.flight'); });

    this.badge = h('div', { class: 'ui-badge ui-glass' }, h('span', { class: 'ui-ico', html: ICONS.pause }), h('span', { class: 'ui-badge-text' }));
    const badgeText = this.badge.querySelector('.ui-badge-text')!;
    b.add(() => { badgeText.textContent = t('ui.badge', { t: fmt(this.state.T_F, 1) }); this.badge.title = t('ui.badge.tip', { t: fmt(this.state.T_F, 1) }); });

    this.fpsEl = h('span', { class: 'ui-fps', hidden: true });

    this.langSeg = new Segmented<Lang>([
      { id: 'en', label: () => 'EN', tip: () => 'English' },
      { id: 'fi', label: () => 'FI', tip: () => 'Suomi' },
    ], this.state.lang, (l) => { this.state.lang = l; this.handlers.setLang(l); }, 'ui-lang', () => t('ui.lang'), b);

    const util = (icon: string, label: string, tip: string, fn: () => void, cls = '') =>
      iconButton({ icon, label: () => t(label), tip: () => t(tip), cls: `ui-icon-only ${cls}`, showLabel: false }, fn, b);
    const utils = h('div', { class: 'ui-util' },
      util(ICONS.help, 'ui.help', 'ui.help.tip', () => this.help.show()),
      util(ICONS.info, 'ui.about', 'ui.about.tip', () => this.about.show()),
      util(ICONS.eyeOff, 'ui.hide', 'ui.hide.tip', () => this.toggleHidden()));

    this.top = h('header', { class: 'ui-top ui-chrome' },
      h('div', { class: 'ui-top-left' }, brand, this.badge),
      h('div', { class: 'ui-top-right ui-glass' }, this.fpsEl, this.langSeg.el, this.makeExport('ui-export-top'), utils));
  }

  private buildDock(): void {
    const b = this.binder;
    const st = this.state;

    this.modeSeg = new Segmented<CameraModeId>(MODE_ORDER.map((id, i) => ({
      id, icon: ICONS[id], label: () => t(`ui.mode.${id}`), tip: () => t(`ui.mode.${id}.tip`), kbd: String(i + 1),
    })), st.mode, (m) => this.setMode(m), 'ui-modes', () => t('ui.camera'), b);

    this.presetMenu = new Menu<LightingPresetId>({
      icon: ICONS.sun, caption: () => t('ui.lighting'), tip: () => t('ui.lighting.tip'), cls: 'ui-m-preset',
      items: PRESET_ORDER.map((id) => ({ id, label: () => t(`ui.preset.${id}`), desc: () => t(`ui.preset.${id}.d`) })),
      shown: (v) => t(`ui.preset.${v}.s`),
    }, st.preset, (p) => this.setPreset(p), (m, o) => this.onMenuOpen(m, o), b);

    this.qualityMenu = new Menu<QualityChoice>({
      icon: ICONS.gauge, caption: () => t('ui.quality'), tip: () => t('ui.quality.tip'), cls: 'ui-m-quality',
      items: QUALITY_ORDER.map((id) => ({ id, label: () => t(`ui.quality.${id}`), desc: () => t(`ui.quality.${id}.d`) })),
      shown: (v) => (v === 'auto' && this.state.effectiveQuality ? t('ui.quality.autoNow', { q: t(`ui.quality.${this.state.effectiveQuality}`) }) : t(`ui.quality.${v}`)),
    }, st.quality, (q) => this.setQuality(q), (m, o) => this.onMenuOpen(m, o), b);
    this.menus = [this.presetMenu, this.qualityMenu];

    this.driftSw = new Switch({ icon: ICONS.drift, label: () => t('ui.drift'), tip: () => t('ui.drift.tip'), cls: 'ui-sw-drift' },
      (v) => { st.drift = v; this.handlers.setDrift(v); this.toast(t(v ? 'ui.toast.drift.on' : 'ui.toast.drift.off')); }, b);
    this.driftSw.set(st.drift);

    this.lensBtn = iconButton({ icon: ICONS.lens, label: () => t('ui.lens'), tip: () => t('ui.lens.tip'), cls: 'ui-lens-btn' }, () => this.toggleLens(), b);
    this.lensBtn.setAttribute('aria-expanded', 'false');

    this.eduSw = new Switch({ icon: ICONS.book, label: () => t('ui.edu'), tip: () => t('ui.edu.tip'), kbd: 'E', cls: 'ui-sw-edu' },
      (v) => this.setEdu(v), b);
    this.eduSw.set(st.edu);

    // Utility row that only appears inside the mobile sheet (the top-bar copy is hidden there).
    const sheetUtil = h('div', { class: 'ui-sheet-util' },
      iconButton({ icon: ICONS.help, label: () => t('ui.help'), tip: () => t('ui.help.tip') }, () => { this.closeSheet(); this.help.show(); }, b),
      iconButton({ icon: ICONS.info, label: () => t('ui.about'), tip: () => t('ui.about.tip') }, () => { this.closeSheet(); this.about.show(); }, b),
      iconButton({ icon: ICONS.eyeOff, label: () => t('ui.hide'), tip: () => t('ui.hide.tip') }, () => { this.closeSheet(); this.toggleHidden(); }, b));

    this.eduSlot = h('span', { class: 'ui-edu-slot' });
    this.secondary = h('div', { class: 'ui-dock-secondary', id: 'ui-sheet' },
      this.presetMenu.el, this.qualityMenu.el, this.driftSw.el, this.lensBtn, this.eduSlot, this.makeExport('ui-export-sheet'), sheetUtil);

    this.menuBtn = iconButton({ icon: ICONS.menu, label: () => t('ui.menu'), tip: () => t('ui.menu.tip'), cls: 'ui-menu-btn ui-icon-only', showLabel: false }, () => this.toggleSheet(), b);
    this.menuBtn.setAttribute('aria-expanded', 'false');
    this.menuBtn.setAttribute('aria-controls', 'ui-sheet');

    this.dock = h('nav', { class: 'ui-dock ui-chrome' },
      h('div', { class: 'ui-dock-bar ui-glass' }, this.modeSeg.el, h('span', { class: 'ui-sep', 'aria-hidden': 'true' }), this.secondary, this.menuBtn));
    this.dock.querySelector('.ui-dock-bar')!.setAttribute('role', 'toolbar');
    b.add(() => this.dock.setAttribute('aria-label', t('ui.camera')));
  }

  /** "Export still" lives in the top bar on desktop and inside the collapsed menu on phones (two buttons, one state). */
  private makeExport(cls: string): HTMLButtonElement {
    const btn = iconButton({ icon: ICONS.download, label: () => t('ui.export'), tip: () => t('ui.export.tip'), cls: `ui-export ${cls}` }, () => void this.doExport(), this.binder);
    this.exportBtns.push(btn);
    return btn;
  }

  private buildLens(): void {
    const b = this.binder;
    const R = LENS_RANGES;
    const L = this.state.lens;
    const fmtDeg = (v: number) => `${fmt(v, 1)}°`;
    const fmtPct = (v: number) => `${fmt(v * 100, 0)} %`;

    this.fovSl = new Slider({ label: () => t('ui.lens.fov'), ...R.fovDeg, min: R.fovDeg.min, max: R.fovDeg.max, value: L.fovDeg, format: fmtDeg },
      (v) => { this.state.lens.fovDeg = v; this.handlers.setLens({ fovDeg: v }); }, b);

    const dollyId = 'ui-dolly';
    this.dolly = h('input', { type: 'checkbox', id: dollyId, class: 'ui-check' }) as HTMLInputElement;
    const dollyTxt = h('span', { class: 'ui-check-text' }, h('span', { class: 'ui-check-title' }), h('span', { class: 'ui-check-desc' }));
    b.add(() => { dollyTxt.children[0].textContent = t('ui.lens.dolly'); dollyTxt.children[1].textContent = t('ui.lens.dolly.d'); });
    this.dolly.addEventListener('change', () => { this.state.lens.dollyZoom = this.dolly.checked; this.handlers.setLens({ dollyZoom: this.dolly.checked }); });
    const dollyRow = h('label', { class: 'ui-check-row', for: dollyId }, this.dolly, h('span', { class: 'ui-check-box', 'aria-hidden': 'true', html: ICONS.check }), dollyTxt);

    this.rollSl = new Slider({ label: () => t('ui.lens.roll'), min: R.rollDeg.min, max: R.rollDeg.max, step: R.rollDeg.step, value: L.rollDeg, format: fmtDeg },
      (v) => { this.state.lens.rollDeg = v; this.handlers.setLens({ rollDeg: v }); }, b);

    const ts = (patch: Partial<LensState['tiltShift']>) => {
      const next = { ...this.state.lens.tiltShift, ...patch };
      this.state.lens.tiltShift = next;
      this.handlers.setLens({ tiltShift: { ...next } });
    };
    this.tsSw = new Switch({ label: () => t('ui.lens.ts'), tip: () => t('ui.lens.ts.d'), cls: 'ui-sw-ts' }, (v) => { ts({ enabled: v }); this.syncLens(); }, b);
    this.focusSl = new Slider({ label: () => t('ui.lens.focus'), min: R.focusY.min, max: R.focusY.max, step: R.focusY.step, value: L.tiltShift.focusY, format: fmtPct }, (v) => ts({ focusY: v }), b);
    this.bandSl = new Slider({ label: () => t('ui.lens.band'), min: R.band.min, max: R.band.max, step: R.band.step, value: L.tiltShift.band, format: fmtPct }, (v) => ts({ band: v }), b);
    this.blurSl = new Slider({ label: () => t('ui.lens.blur'), min: R.blur.min, max: R.blur.max, step: R.blur.step, value: L.tiltShift.blur, format: (v) => fmt(v, 2) }, (v) => ts({ blur: v }), b);
    this.tsGroup = h('div', { class: 'ui-ts-group' }, this.focusSl.el, this.bandSl.el, this.blurSl.el);

    const reset = iconButton({ icon: ICONS.reset, label: () => t('ui.lens.reset'), cls: 'ui-reset' }, () => { this.handlers.resetLens(); }, b);
    const title = h('h2', { class: 'ui-panel-title', id: 'ui-lens-title' });
    b.add(() => { title.textContent = t('ui.lens.title'); });
    const close = iconButton({ icon: ICONS.close, label: () => t('ui.close'), cls: 'ui-icon-only', showLabel: false }, () => this.toggleLens(false, true), b);

    this.lensPanel = h('section', { class: 'ui-lens ui-glass ui-chrome', id: 'ui-lens', 'aria-labelledby': 'ui-lens-title', hidden: true },
      h('header', { class: 'ui-panel-head' }, title, close),
      this.fovSl.el, dollyRow, this.rollSl.el, h('hr', { class: 'ui-hr' }), this.tsSw.el, this.tsGroup,
      h('footer', { class: 'ui-panel-foot' }, reset));
    this.lensBtn.setAttribute('aria-controls', 'ui-lens');
  }

  private buildWalk(): void {
    const b = this.binder;
    this.cross = h('div', { class: 'ui-cross', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'), h('b'));
    this.walkPrompt = h('div', { class: 'ui-walk-prompt ui-glass' });
    this.walkHint = h('div', { class: 'ui-walk-hint ui-glass' });
    this.walk = h('div', { class: 'ui-walk', hidden: true }, this.cross, this.walkPrompt, this.walkHint);
    b.add(() => { this.walkPrompt.textContent = t('ui.walk.prompt'); this.renderHint(); });
  }

  /** Render a translated template, turning {name} placeholders into <kbd> chips. */
  private richKeys(el: HTMLElement, tpl: string, keys: Record<string, string>): void {
    el.replaceChildren();
    for (const part of tpl.split(/(\{\w+\})/)) {
      const m = /^\{(\w+)\}$/.exec(part);
      if (m && m[1] in keys) el.append(h('kbd', { class: 'ui-kbd' }, keys[m[1]]));
      else if (part) el.append(part);
    }
  }
  private renderHint(): void {
    if (this.state.mode === 'fly') this.richKeys(this.walkHint, t('ui.fly.hint', { move: '{move}', qe: '{qe}', run: '{run}' }), { move: 'WASD', qe: 'Q / E', run: 'Shift' });
    else this.richKeys(this.walkHint, t('ui.walk.hint', { move: '{move}', run: '{run}', crouch: '{crouch}', jump: '{jump}', esc: '{esc}' }), { move: 'WASD', run: 'Shift', crouch: 'C', jump: 'Space', esc: 'Esc' });
  }

  private buildModals(): void {
    const b = this.binder;
    this.help = new Modal(() => t('ui.help.title'), () => t('ui.close'), 'ui-help', b);
    const K = (...k: string[]) => h('span', { class: 'ui-keys' }, ...k.map((x) => (x === '/' ? h('span', { class: 'ui-keys-sep' }, '/') : h('kbd', { class: 'ui-kbd' }, x))));
    const groups: Array<{ title: string; rows: Array<[HTMLElement, string]> }> = [
      { title: 'ui.help.g.view', rows: [[K('1', '2', '3', '4'), 'ui.help.k.modes'], [K('L'), 'ui.help.k.preset'], [K('R'), 'ui.help.k.reset']] },
      { title: 'ui.help.g.lens', rows: [[K('[', ']'), 'ui.help.k.fov'], [K(',', '.'), 'ui.help.k.roll']] },
      { title: 'ui.help.g.move', rows: [[K('W', 'A', 'S', 'D'), 'ui.help.k.move'], [K('Shift'), 'ui.help.k.run'], [K('C'), 'ui.help.k.crouch'], [K('Space'), 'ui.help.k.jump'], [K('Q', '/', 'E'), 'ui.help.k.qe']] },
      { title: 'ui.help.g.ui', rows: [[K('E'), 'ui.help.k.edu'], [K('H'), 'ui.help.k.hide'], [K('?'), 'ui.help.k.help'], [K('Esc'), 'ui.help.k.esc']] },
    ];
    const grid = h('div', { class: 'ui-help-grid' });
    for (const g of groups) {
      const sec = h('section', { class: 'ui-help-sec' }, h('h3', { class: 'ui-help-h' }));
      const dl = h('dl', { class: 'ui-help-list' });
      const heading = sec.firstElementChild!;
      b.add(() => { heading.textContent = t(g.title); });
      for (const [keys, key] of g.rows) {
        const dd = h('dd', {});
        b.add(() => { dd.textContent = t(key); });
        dl.append(h('dt', {}, keys), dd);
      }
      sec.append(dl); grid.append(sec);
    }
    const note = h('p', { class: 'ui-help-note' });
    b.add(() => { note.textContent = t('ui.help.note'); });
    this.help.body.append(grid, note);

    this.about = new Modal(() => t('ui.about.title'), () => t('ui.close'), 'ui-about', b);
    const ps = ['ui.about.p1', 'ui.about.p2', 'ui.about.p3', 'ui.about.p4', 'ui.about.p5'].map((k) => {
      const p = h('p', { class: k === 'ui.about.p4' || k === 'ui.about.p5' ? 'ui-about-fine' : '' });
      b.add(() => { p.textContent = t(k); });
      return p;
    });
    this.about.body.append(...ps);
  }

  // ── global wiring ───────────────────────────────────────────────────────────────────────────────

  private wireGlobal(): void {
    const on = (target: Document | Window | HTMLElement | MediaQueryList, type: string, fn: (e: any) => void, opts?: boolean | AddEventListenerOptions) => {
      target.addEventListener(type, fn, opts);
      this.disposers.push(() => target.removeEventListener(type, fn, opts));
    };
    // UI pointer events must never reach the canvas / controller (walk-mode pointer lock starts on a canvas click).
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'contextmenu', 'touchstart', 'touchend']) {
      on(this.shell, type, (e: Event) => { if (e.target !== this.shell) e.stopPropagation(); });
    }
    // Outside press closes menus and the mobile sheet.
    on(document, 'pointerdown', (e: PointerEvent) => {
      const tgt = e.target as Node;
      for (const m of this.menus) if (m.open && !m.contains(tgt)) m.setOpen(false, false);
      if (this.dock.classList.contains('is-sheet-open') && !this.dock.contains(tgt)) this.closeSheet();
    }, true);
    for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) on(window, type, () => this.wake(), { passive: true });
    on(document, 'focusin', () => this.wake());
    on(document, 'keydown', (e: KeyboardEvent) => this.onKey(e));
    on(document, 'pointerlockchange', () => { this.locked = !!document.pointerLockElement; this.syncOverlay(); });
    on(this.mq, 'change', () => { this.placeEdu(); this.closeSheet(); });
    this.disposers.push(onLangChange((l) => { this.state.lang = l; this.langSeg.set(l); this.binder.refresh(); this.qualityMenu.refreshText(); this.presetMenu.refreshText(); this.syncFps(); document.documentElement.lang = l; }));
    // Dialog closing via Esc/backdrop should bring the UI back to life.
    for (const m of [this.help, this.about]) on(m.el, 'close', () => this.wake());
  }

  private onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || !this.hotkeys) return;
    if (e.metaKey || (e.ctrlKey && !e.altKey)) return;               // browser shortcuts (Ctrl is crouch in walk mode)
    if (e.altKey && !e.ctrlKey && !e.getModifierState('AltGraph')) return;
    if (isTextEntry(e.target)) return;
    const modalOpen = this.help.isOpen || this.about.isOpen;
    const k = e.key;

    if (k === 'Escape') {
      // Menus handle their own Esc; this covers panels and the sheet. (Pointer-lock release is the browser's.)
      if (this.menus.some((m) => m.open)) { this.menus.forEach((m) => m.setOpen(false, true)); e.preventDefault(); return; }
      if (this.dock.classList.contains('is-sheet-open')) { this.closeSheet(); this.menuBtn.focus(); e.preventDefault(); return; }
      if (!modalOpen && !this.lensPanel.hidden) { this.toggleLens(false, true); e.preventDefault(); }
      return;
    }
    if (modalOpen) { if (k === '?') { this.help.close(); e.preventDefault(); } return; }   // dialogs are modal: no other hotkeys
    const lower = k.length === 1 ? k.toLowerCase() : k;
    switch (lower) {
      case '1': case '2': case '3': case '4': this.setMode(MODE_ORDER[Number(lower) - 1]); break;
      case 'l': this.cyclePreset(e.shiftKey ? -1 : 1); break;
      case 'e': if (this.state.mode === 'fly') return; this.setEdu(!this.state.edu); this.eduSw.set(this.state.edu); break;
      case 'h': this.toggleHidden(); break;
      case '?': this.help.show(); break;
      case 'r': this.resetView(); break;
      case '[': this.nudgeLens('fovDeg', -(e.shiftKey ? 10 : 2)); break;
      case ']': this.nudgeLens('fovDeg', e.shiftKey ? 10 : 2); break;
      case ',': this.nudgeLens('rollDeg', -1); break;
      case '.': this.nudgeLens('rollDeg', 1); break;
      default: return;
    }
    e.preventDefault();
  }

  // ── actions (user-initiated: optimistic local update, call handler, toast) ─────────────────────

  private setMode(m: CameraModeId): void {
    if (m === this.state.mode) return;
    this.state.mode = m; this.modeSeg.set(m); this.syncOverlay();
    this.handlers.setCameraMode(m);
    this.toast(t('ui.toast.mode', { name: t(`ui.mode.${m}`) }));
  }
  private setPreset(p: LightingPresetId): void {
    this.state.preset = p; this.presetMenu.set(p);
    this.handlers.setPreset(p);
    this.toast(t('ui.toast.preset', { name: t(`ui.preset.${p}`) }));
  }
  private cyclePreset(dir: 1 | -1): void {
    const i = PRESET_ORDER.indexOf(this.state.preset);
    this.setPreset(PRESET_ORDER[(i + dir + PRESET_ORDER.length) % PRESET_ORDER.length]);
  }
  private setQuality(q: QualityChoice): void {
    this.state.quality = q; this.qualityMenu.set(q);
    this.handlers.setQuality(q);
    this.toast(t('ui.toast.quality', { name: t(`ui.quality.${q}`) }));
  }
  private setEdu(v: boolean): void {
    this.state.edu = v; this.eduSw.set(v);
    this.handlers.setEdu(v);
    this.toast(t(v ? 'ui.toast.edu.on' : 'ui.toast.edu.off'));
  }
  private resetView(): void {
    if (this.state.mode !== 'photo') this.setMode('photo');
    this.handlers.resetLens();
    this.toast(t('ui.toast.reset'));
  }
  private nudgeLens(k: 'fovDeg' | 'rollDeg', d: number): void {
    const r = LENS_RANGES[k];
    const v = clamp(this.state.lens[k] + d, r.min, r.max);
    this.state.lens[k] = v;
    this.handlers.setLens({ [k]: v });
    this.syncLens();
  }
  private toggleHidden(): void {
    this.hiddenAll = !this.hiddenAll;
    this.syncVisibility();
    if (this.hiddenAll && !this.hiddenToastShown) { this.hiddenToastShown = true; this.toast(t('ui.toast.hidden'), 3200); }
  }
  private async doExport(): Promise<void> {
    if (this.exporting) return;
    this.exporting = true;
    for (const b of this.exportBtns) { b.disabled = true; b.classList.add('is-busy'); }
    this.toast(t('ui.toast.exporting'));
    try { await this.handlers.exportStill(); }
    catch (err) { this.toast(String((err as Error)?.message ?? err)); }
    finally {
      this.exporting = false;
      for (const b of this.exportBtns) { b.disabled = false; b.classList.remove('is-busy'); }
    }
  }

  // ── panels / sheet ──────────────────────────────────────────────────────────────────────────────

  private onMenuOpen(m: Menu<any>, open: boolean): void {
    if (open) for (const o of this.menus) if (o !== m) o.setOpen(false, false);
    this.wake();
  }
  private toggleLens(open: boolean = !!this.lensPanel.hidden, focusBtn = false): void {
    this.lensPanel.hidden = !open;
    this.lensBtn.setAttribute('aria-expanded', String(open));
    this.lensBtn.classList.toggle('is-on', open);
    if (open) { this.closeSheet(); this.syncLens(); }
    if (focusBtn && !open) this.lensBtn.focus();
    this.wake();
  }
  private toggleSheet(): void {
    const open = !this.dock.classList.contains('is-sheet-open');
    this.dock.classList.toggle('is-sheet-open', open);
    this.menuBtn.setAttribute('aria-expanded', String(open));
    this.menuBtn.classList.toggle('is-on', open);
    if (open && this.mq.matches) this.toggleLens(false);   // one floating panel at a time on small screens
    if (!open) this.menus.forEach((m) => m.setOpen(false, false));
  }
  private closeSheet(): void {
    if (!this.dock.classList.contains('is-sheet-open')) return;
    this.dock.classList.remove('is-sheet-open');
    this.menuBtn.setAttribute('aria-expanded', 'false'); this.menuBtn.classList.remove('is-on');
    this.menus.forEach((m) => m.setOpen(false, false));
  }
  /** On narrow screens the EDUCATION switch leaves the collapsed sheet and sits in the dock, always visible. */
  private placeEdu(): void {
    if (this.mq.matches) this.menuBtn.before(this.eduSw.el);
    else this.eduSlot.after(this.eduSw.el);
  }
  private anyPopoverOpen(): boolean {
    return this.menus.some((m) => m.open) || this.dock.classList.contains('is-sheet-open') || !this.lensPanel.hidden || this.help.isOpen || this.about.isOpen
      || (this.shell.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement && (document.activeElement as HTMLInputElement).type === 'range');
  }

  // ── state -> DOM sync ───────────────────────────────────────────────────────────────────────────

  private syncAll(): void {
    const s = this.state;
    this.modeSeg.set(s.mode); this.langSeg.set(s.lang); this.presetMenu.set(s.preset); this.qualityMenu.set(s.quality);
    this.driftSw.set(s.drift); this.eduSw.set(s.edu);
    this.syncLens(); this.syncFps(); this.syncOverlay(); this.syncVisibility();
  }
  private syncLens(): void {
    const L = this.state.lens;
    this.fovSl.set(L.fovDeg); this.rollSl.set(L.rollDeg);
    this.dolly.checked = L.dollyZoom;
    this.tsSw.set(L.tiltShift.enabled);
    this.focusSl.set(L.tiltShift.focusY); this.bandSl.set(L.tiltShift.band); this.blurSl.set(L.tiltShift.blur);
    for (const sl of [this.focusSl, this.bandSl, this.blurSl]) sl.setDisabled(!L.tiltShift.enabled);
    this.tsGroup.classList.toggle('is-off', !L.tiltShift.enabled);
  }
  private syncFps(): void {
    const f = this.state.fps;
    if (f === undefined || !isFinite(f)) { if (this.fpsShown !== -1) { this.fpsShown = -1; this.fpsEl.hidden = true; } return; }
    const r = Math.round(f);
    if (r === this.fpsShown) return;
    this.fpsShown = r; this.fpsEl.hidden = false;
    this.fpsEl.textContent = t('ui.fps', { fps: r });
    this.fpsEl.classList.toggle('is-low', r < 30);
  }
  /** Walk / fly overlay: prompt while the pointer is free, crosshair while it is captured. */
  private syncOverlay(): void {
    const m = this.state.mode;
    const show = m === 'walk' || m === 'fly';
    this.walk.hidden = !show;
    this.walk.classList.toggle('is-locked', this.locked && m === 'walk');
    this.walkPrompt.hidden = !(m === 'walk' && !this.locked);
    this.cross.hidden = !(m === 'walk' && this.locked);
    if (show) this.renderHint();
    this.syncVisibility();
  }
  private syncVisibility(): void {
    const hide = this.hiddenAll;
    const captured = this.locked;
    this.shell.classList.toggle('is-hidden', hide);
    this.shell.classList.toggle('is-locked', captured && !hide);
    this.setChromeInert(this.loading.visible || hide || captured);
  }
  private setChromeInert(inert: boolean): void {
    for (const el of [this.top, this.dock, this.lensPanel]) el.toggleAttribute('inert', inert);
  }
}
