// Loading screen: a still night-sky motif (stars, a slim stack, its plume blooming into a dust cloud)
// with a thin progress bar and stage labels. Pure DOM/SVG/CSS; no images. OWNER: src/ui.
import { fmt, t } from '../i18n.ts';
import { Binder, h } from './dom.ts';

/** Deterministic PRNG so the star field is identical on every load. */
function mulberry32(a: number): () => number {
  return () => { a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

/** Star field as absolutely positioned dots (percent coordinates, crisp at any aspect ratio). */
function starField(): HTMLElement {
  const r = mulberry32(1409);
  const box = h('div', { class: 'ui-ld-stars', 'aria-hidden': 'true' });
  for (let i = 0; i < 170; i++) {
    const x = r() * 100, y = Math.pow(r(), 1.3) * 82;              // denser toward the zenith, fading toward the horizon glow
    const big = r() < 0.07;
    const size = big ? 2 : r() < 0.5 ? 1 : 1.5;
    const o = (big ? 0.9 : 0.25 + r() * 0.5) * (1 - y / 115);
    const star = h('i', { class: r() < 0.2 ? 'tw' : '' });
    star.style.cssText = `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;width:${size}px;height:${size}px;opacity:${o.toFixed(2)};animation-delay:${(r() * 7).toFixed(2)}s`;
    box.append(star);
  }
  return box;
}

const MOTIF = `
<svg class="ui-ld-art" viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="ld-flame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6e0"/><stop offset=".35" stop-color="#ffc27a"/><stop offset="1" stop-color="#ff8a3c" stop-opacity="0"/></linearGradient>
    <linearGradient id="ld-core" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffaf0"/><stop offset=".7" stop-color="#fff0d8" stop-opacity=".8"/><stop offset="1" stop-color="#ffd39a" stop-opacity="0"/></linearGradient>
    <linearGradient id="ld-body" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7f8a99"/><stop offset=".5" stop-color="#e9eef4"/><stop offset="1" stop-color="#6d7785"/></linearGradient>
    <radialGradient id="ld-puff" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffd9b0" stop-opacity=".8"/><stop offset=".6" stop-color="#e98a55" stop-opacity=".38"/><stop offset="1" stop-color="#e98a55" stop-opacity="0"/></radialGradient>
    <filter id="ld-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.1"/></filter>
    <filter id="ld-blur2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation=".35"/></filter>
  </defs>
  <!-- dust and steam cloud around the pad -->
  <g filter="url(#ld-blur)" class="ld-breathe">
    <ellipse cx="30" cy="83" rx="17" ry="7" fill="url(#ld-puff)"/>
    <ellipse cx="70" cy="84" rx="19" ry="7.5" fill="url(#ld-puff)"/>
    <ellipse cx="50" cy="87" rx="26" ry="6" fill="url(#ld-puff)"/>
    <ellipse cx="41" cy="79" rx="9" ry="6" fill="url(#ld-puff)" opacity=".7"/>
    <ellipse cx="60" cy="80" rx="10" ry="6" fill="url(#ld-puff)" opacity=".7"/>
  </g>
  <!-- plume: soft halo, fanning jet, hot core and a few shock diamonds -->
  <g class="ld-breathe">
    <ellipse cx="50" cy="69" rx="5.5" ry="15" fill="#ff9a4a" opacity=".35" filter="url(#ld-blur)"/>
    <path d="M48.9 57 L51.1 57 L52.6 81 L47.4 81 Z" fill="url(#ld-flame)" filter="url(#ld-blur2)"/>
    <path d="M49.4 57 L50.6 57 L51.1 78 L48.9 78 Z" fill="url(#ld-core)"/>
    <g fill="#fff" opacity=".8"><ellipse cx="50" cy="62" rx=".7" ry="1.1"/><ellipse cx="50" cy="66.5" rx=".6" ry="1"/><ellipse cx="50" cy="70.6" rx=".5" ry=".9"/></g>
  </g>
  <!-- the stack: ship (dark nose, silver body), hot-stage ring, booster with grid fins -->
  <path d="M50 21.5c.7 1.2 1 2.6 1 4.2V57h-2V25.7c0-1.6.3-3 1-4.2z" fill="url(#ld-body)"/>
  <path d="M50 21.5c.7 1.2 1 2.6 1 4.2v3H49v-3c0-1.6.3-3 1-4.2z" fill="#121821"/>
  <rect x="49" y="39.2" width="2" height=".7" fill="#0b0f15"/>
  <rect x="48.3" y="41.2" width=".7" height="2.2" fill="#8892a0"/><rect x="51" y="41.2" width=".7" height="2.2" fill="#8892a0"/>
  <rect x="49.25" y="30" width=".35" height="27" fill="#000" opacity=".1"/>
  <!-- horizon -->
  <path d="M0 100V87.4Q50 84.4 100 87.4V100z" fill="#05070d"/>
</svg>`;

/** Full-screen loading overlay. */
export class LoadingScreen {
  readonly el: HTMLElement;
  private fill: HTMLElement;
  private stage: HTMLElement;
  private pct: HTMLElement;
  private bar: HTMLElement;
  private tag: HTMLElement;
  private frac = 0;
  private label = 'models';
  private done = false;
  constructor(private tF: () => number, private binder: Binder) {
    this.fill = h('div', { class: 'ui-ld-fill' });
    this.bar = h('div', { class: 'ui-ld-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, this.fill);
    this.stage = h('span', { class: 'ui-ld-stage' });
    this.pct = h('span', { class: 'ui-ld-pct' }, '0%');
    this.tag = h('p', { class: 'ui-ld-tag' });
    const title = h('h1', { class: 'ui-ld-title' }, 'STARSHIP');
    const info = h('div', { class: 'ui-ld-info', role: 'status', 'aria-live': 'polite' }, this.stage, this.pct);
    this.el = h('div', { class: 'ui-loading' },
      h('div', { class: 'ui-ld-glow', 'aria-hidden': 'true' }), starField(),
      h('div', { class: 'ui-ld-motif', html: MOTIF }),
      h('div', { class: 'ui-ld-head' }, title, this.tag),
      h('div', { class: 'ui-ld-progress' }, this.bar, info));
    binder.add(() => this.render());
  }
  /** Stage ids with built-in translations (ui.loading.<id>) are translated; anything else is shown as given. */
  private labelText(): string {
    const key = `ui.loading.${this.label}`;
    const s = t(key);
    return s === key ? this.label : s;
  }
  private render(): void {
    this.stage.textContent = this.labelText() + (this.done ? '' : '…');
    this.tag.textContent = t('ui.loading.tag', { t: fmt(this.tF(), 1) });
    const p = Math.round(this.frac * 100);
    this.pct.textContent = `${p}%`;
    this.bar.setAttribute('aria-valuenow', String(p));
    this.bar.setAttribute('aria-valuetext', `${this.labelText()} ${p}%`);
    this.fill.style.transform = `scaleX(${this.frac.toFixed(4)})`;
  }
  set(label: string, fraction: number): void {
    this.label = label;
    this.frac = Math.max(this.frac, Math.min(1, Math.max(0, fraction)));   // never moves backwards
    this.done = this.frac >= 1;
    this.render();
  }
  /** Fade out and remove from the DOM. Resolves when gone. */
  hide(): Promise<void> {
    return new Promise((res) => {
      if (!this.el.isConnected) return res();
      this.frac = 1; this.done = true; this.render();
      this.el.classList.add('is-done');
      this.el.setAttribute('aria-hidden', 'true');
      const end = () => { this.el.remove(); res(); };
      const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900;
      setTimeout(end, ms);
    });
  }
  get visible(): boolean { return this.el.isConnected && !this.el.classList.contains('is-done'); }
}
