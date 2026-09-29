// Wallpaper-loop UI: the settings panel, the framing guide over the live view and the recording overlay. OWNER: src/ui.
// The panel follows the lens panel's idioms (glass section, Segmented / Slider widgets, Binder for strings); the
// actual recording lives in src/record (loaded on demand by the app), which reports back through LoopOverlay.
import { fmt, t } from '../i18n.ts';
import { LOOP_PRESET_SIZES, aspectLabel, estimateBytes, framingCrop, loopPlan, screenDims } from '../record/loop-schedule.ts';
import { Binder, Segmented, Slider, h, iconButton } from './dom.ts';
import { ICONS } from './icons.ts';
import { LOOP_CROSSFADE, LOOP_FPS, LOOP_RESOLUTIONS, LOOP_SECONDS } from './types.ts';
import type { LoopFiles, LoopProgressView, LoopResolutionId, LoopSettings } from './types.ts';

/** Output size for a resolution choice ("screen" = this monitor in device pixels). */
export function loopSize(id: LoopResolutionId): { width: number; height: number } {
  if (id === 'screen') return screenDims(screen.width, screen.height, window.devicePixelRatio || 1);
  return LOOP_PRESET_SIZES[id];
}

export const fmtBytes = (b: number): string => (b >= 1e9 ? `${fmt(b / 1e9, 1)} GB` : `${fmt(b / 1e6, b < 10e6 ? 1 : 0)} MB`);

function fmtDuration(s: number): string {
  const r = Math.max(0, Math.round(s));
  return r < 60 ? `${r} s` : `${Math.floor(r / 60)} min ${String(r % 60).padStart(2, '0')} s`;
}

/** Save a blob under a file name (a synthetic link click; the object URL is revoked later). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ── settings panel + framing guide ──────────────────────────────────────────────────────────────

export class LoopPanel {
  readonly el: HTMLElement;
  /** Dimmed letterbox / pillarbox bars over the live view: the crop the recording will have. */
  readonly guide: HTMLElement;
  readonly recordBtn: HTMLButtonElement;
  private readonly hole: HTMLElement;
  private readonly holeLabel: HTMLElement;
  private readonly dimsEl: HTMLElement;
  private readonly estEl: HTMLElement;
  private res: LoopResolutionId = 'screen';
  private seconds = 15;
  private fps = 30;
  private crossfade = 2;

  constructor(binder: Binder, onClose: () => void, private readonly onRecord: (s: LoopSettings) => void) {
    const b = binder;
    // the framing guide first: Binder.add() runs its callback at once, and sync() positions the hole
    this.holeLabel = h('span', { class: 'ui-loop-hole-label' });
    this.hole = h('div', { class: 'ui-loop-hole' }, this.holeLabel);
    this.guide = h('div', { class: 'ui-loop-guide', 'aria-hidden': 'true', hidden: true }, this.hole);
    this.dimsEl = h('p', { class: 'ui-loop-dims' });
    this.estEl = h('p', { class: 'ui-loop-est' });
    const label = (key: string) => { const el = h('span', { class: 'ui-sl-label' }); b.add(() => { el.textContent = t(key); }); return el; };

    const resSeg = new Segmented<LoopResolutionId>(LOOP_RESOLUTIONS.map((id) => ({
      id,
      label: () => (id === 'screen' ? t('ui.loop.res.screen') : id === '2160' ? '4K' : `${id}p`),
      tip: () => { const s = loopSize(id); return id === 'screen' ? t('ui.loop.res.screen.tip', { w: s.width, h: s.height }) : `${s.width} × ${s.height}`; },
    })), this.res, (v) => { this.res = v; this.sync(); }, 'ui-loop-seg', () => t('ui.loop.res'), b);
    const secSeg = new Segmented<string>(LOOP_SECONDS.map((s) => ({ id: String(s), label: () => `${s} s` })), String(this.seconds),
      (v) => { this.seconds = Number(v); this.sync(); }, 'ui-loop-seg', () => t('ui.loop.length'), b);
    const fpsSeg = new Segmented<string>(LOOP_FPS.map((f) => ({ id: String(f), label: () => String(f) })), String(this.fps),
      (v) => { this.fps = Number(v); this.sync(); }, 'ui-loop-seg', () => t('ui.loop.fps'), b);
    const fadeSl = new Slider({ label: () => t('ui.loop.fade'), ...LOOP_CROSSFADE, value: this.crossfade, format: (v) => `${fmt(v, 1)} s` },
      (v) => { this.crossfade = v; this.sync(); }, b);

    const note = h('p', { class: 'ui-loop-note' });
    const hint = h('p', { class: 'ui-loop-note ui-loop-hint' });
    b.add(() => { note.textContent = t('ui.loop.note'); hint.textContent = t('ui.loop.hint'); this.sync(); });

    this.recordBtn = iconButton({ icon: ICONS.record, label: () => t('ui.loop.record'), cls: 'ui-loop-go' }, () => this.onRecord(this.settings()), b);
    const title = h('h2', { class: 'ui-panel-title', id: 'ui-loop-title' });
    b.add(() => { title.textContent = t('ui.loop.title'); });
    const close = iconButton({ icon: ICONS.close, label: () => t('ui.close'), cls: 'ui-icon-only', showLabel: false }, onClose, b);

    this.el = h('section', { class: 'ui-loop ui-glass ui-chrome', id: 'ui-loop', 'aria-labelledby': 'ui-loop-title', hidden: true },
      h('header', { class: 'ui-panel-head' }, title, close),
      h('div', { class: 'ui-loop-row' }, label('ui.loop.res'), resSeg.el), this.dimsEl,
      h('div', { class: 'ui-loop-row' }, label('ui.loop.length'), secSeg.el),
      h('div', { class: 'ui-loop-row' }, label('ui.loop.fps'), fpsSeg.el),
      fadeSl.el, this.estEl,
      h('hr', { class: 'ui-hr' }), note, hint,
      h('footer', { class: 'ui-panel-foot' }, this.recordBtn));

    addEventListener('resize', () => { if (!this.el.hidden) this.sync(); });
    this.sync();
  }

  get open(): boolean { return !this.el.hidden; }

  setOpen(open: boolean): void {
    this.el.hidden = !open;
    this.guide.hidden = !open;
    if (open) this.sync();
  }

  settings(): LoopSettings {
    const { width, height } = loopSize(this.res);
    return { width, height, seconds: this.seconds, fps: this.fps, crossfade: this.crossfade };
  }

  setBusy(busy: boolean): void {
    this.recordBtn.disabled = busy;
    this.recordBtn.classList.toggle('is-busy', busy);
  }

  /** Refresh the size / estimate lines and the framing guide. */
  sync(): void {
    const s = this.settings();
    const plan = loopPlan(s.seconds, s.fps, s.crossfade);
    this.dimsEl.textContent = `${s.width} × ${s.height} · ${aspectLabel(s.width, s.height)}`;
    this.estEl.textContent = t('ui.loop.estimate', { size: fmtBytes(estimateBytes(s.width, s.height, s.fps, s.seconds)), frames: plan.n });
    // The live camera's aspect is the window's (Pipeline.resize): the guide is the crop of the window.
    const c = framingCrop(innerWidth / Math.max(1, innerHeight), s.width / s.height);
    Object.assign(this.hole.style, { left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` });
    this.hole.classList.toggle('is-full', c.w > 0.999 && c.h > 0.999);
    this.holeLabel.textContent = `${s.width} × ${s.height}`;
  }
}

// ── recording overlay ───────────────────────────────────────────────────────────────────────────

/** Full-screen progress card while a loop renders: phase, frame x / y, ETA, preview, Cancel; then the result. */
export class LoopOverlay {
  readonly el: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly status: HTMLElement;
  private readonly eta: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly preview: HTMLCanvasElement;
  private readonly actions: HTMLElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly videoBtn: HTMLButtonElement;
  private readonly posterBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private onCancel: (() => void) | null = null;
  private onClose: (() => void) | null = null;
  private files: LoopFiles | null = null;
  private lastPreview = 0;
  private titleKey = 'ui.loop.rec.title';
  /** Esc cancels a running recording, and closes the result card. */
  private keyHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || this.el.hidden) return;
    e.preventDefault(); e.stopPropagation();
    if (this.onCancel) this.cancel();
    else if (this.actions.contains(this.closeBtn)) this.closeBtn.click();
  };

  constructor(binder: Binder) {
    this.titleEl = h('h2', { class: 'ui-rec-title', id: 'ui-rec-title' });
    this.status = h('p', { class: 'ui-rec-status', role: 'status', 'aria-live': 'polite' });
    this.eta = h('p', { class: 'ui-rec-eta' });
    this.fill = h('div', { class: 'ui-rec-fill' });
    this.preview = h('canvas', { class: 'ui-rec-preview', width: 384, height: 216 }) as HTMLCanvasElement;
    this.cancelBtn = iconButton({ icon: ICONS.close, label: () => t('ui.loop.rec.cancel'), cls: 'ui-rec-btn' }, () => this.cancel(), binder);
    this.videoBtn = iconButton({ icon: ICONS.download, label: () => t('ui.loop.rec.video'), cls: 'ui-rec-btn' },
      () => { if (this.files) saveBlob(this.files.video, `${this.files.stem}.mp4`); }, binder);
    this.posterBtn = iconButton({ icon: ICONS.download, label: () => t('ui.loop.rec.poster'), cls: 'ui-rec-btn' },
      () => { if (this.files) saveBlob(this.files.poster, `${this.files.stem}.png`); }, binder);
    this.closeBtn = iconButton({ icon: ICONS.check, label: () => t('ui.close'), cls: 'ui-rec-btn ui-rec-primary' },
      () => { const f = this.onClose; this.onClose = null; this.close(); f?.(); }, binder);
    this.actions = h('div', { class: 'ui-rec-actions' }, this.cancelBtn);
    const card = h('div', { class: 'ui-rec-card ui-glass', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ui-rec-title' },
      this.titleEl, this.preview, h('div', { class: 'ui-rec-bar' }, this.fill), this.status, this.eta, this.actions);
    this.el = h('div', { class: 'ui-rec', hidden: true }, card);
    binder.add(() => { this.titleEl.textContent = t(this.titleKey); });
  }

  get active(): boolean { return !this.el.hidden; }

  /** Show the overlay for a new recording of `width` x `height`. */
  begin(width: number, height: number, onCancel: () => void): void {
    this.onCancel = onCancel;
    this.lastPreview = 0;
    this.setTitle('ui.loop.rec.title');
    const pw = 384, ph = Math.max(2, Math.round((pw * height) / width));
    this.preview.width = pw; this.preview.height = ph;
    const g = this.preview.getContext('2d');
    if (g) { g.fillStyle = '#05070b'; g.fillRect(0, 0, pw, ph); }
    this.fill.style.transform = 'scaleX(0)';
    this.status.textContent = t('ui.loop.rec.prepare');
    this.eta.textContent = t('ui.loop.rec.offline');
    this.actions.replaceChildren(this.cancelBtn);
    this.cancelBtn.disabled = false;
    this.el.hidden = false;
    document.addEventListener('keydown', this.keyHandler, true);
    this.cancelBtn.focus({ preventScroll: true });
  }

  progress(p: LoopProgressView): void {
    if (this.el.hidden) return;
    let frac = 0;
    if (p.phase === 'warmup') {
      this.status.textContent = t('ui.loop.rec.warmup', { pct: Math.round((100 * p.done) / Math.max(1, p.total)) });
      frac = 0.08 * (p.done / Math.max(1, p.total));
    } else if (p.phase === 'render') {
      this.status.textContent = t('ui.loop.rec.render', { n: p.done, total: p.total });
      frac = 0.08 + 0.9 * (p.done / Math.max(1, p.total));
    } else if (p.phase === 'finalize') {
      this.status.textContent = t('ui.loop.rec.finalize');
      frac = 0.99;
      this.cancelBtn.disabled = true;
    }
    this.fill.style.transform = `scaleX(${frac.toFixed(4)})`;
    if (p.etaS !== null && p.phase !== 'finalize' && p.phase !== 'prepare') this.eta.textContent = t('ui.loop.rec.eta', { t: fmtDuration(p.etaS) });
    const now = performance.now();
    if (p.frame && now - this.lastPreview > 250) {
      this.lastPreview = now;
      this.preview.getContext('2d')?.drawImage(p.frame, 0, 0, this.preview.width, this.preview.height);
    }
  }

  /** Recording finished: offer the two files again (the browser may block the second automatic download). */
  done(files: LoopFiles, onClose: () => void): void {
    this.onCancel = null;
    this.onClose = onClose;
    this.files = files;
    this.setTitle('ui.loop.rec.doneTitle');
    this.fill.style.transform = 'scaleX(1)';
    this.status.textContent = t('ui.loop.rec.done', { file: files.stem, size: fmtBytes(files.video.size), codec: files.codecLabel });
    this.eta.textContent = t('ui.loop.rec.blocked');
    this.actions.replaceChildren(this.videoBtn, this.posterBtn, this.closeBtn);
    this.closeBtn.focus({ preventScroll: true });
  }

  /** Recording failed: show why, with a Close button. */
  fail(message: string, onClose: () => void): void {
    this.onCancel = null;
    this.onClose = onClose;
    this.files = null;
    this.setTitle('ui.loop.rec.failedTitle');
    this.status.textContent = t('ui.loop.rec.failed', { msg: message });
    this.eta.textContent = '';
    this.actions.replaceChildren(this.closeBtn);
    this.closeBtn.focus({ preventScroll: true });
  }

  close(): void {
    this.onCancel = null;
    this.files = null;
    document.removeEventListener('keydown', this.keyHandler, true);
    this.el.hidden = true;
  }

  private setTitle(key: string): void { this.titleKey = key; this.titleEl.textContent = t(key); }

  private cancel(): void {
    const f = this.onCancel;
    if (!f) return;
    this.onCancel = null;
    this.cancelBtn.disabled = true;
    this.status.textContent = t('ui.loop.rec.cancelling');
    f();
  }
}
