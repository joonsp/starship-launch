// Four small-multiple line charts (altitude, velocity, net acceleration, mass) for 0-60 s, drawn on
// plain <canvas> elements with no chart library. Following the dataviz rules: one series per chart
// (so no legend box), a 2 px line, hairline recessive grid, text in tokens (never the series colour),
// one direct marker at the frozen instant, and a crosshair/readout on hover or arrow keys that
// drives all four charts at once. The canvas is scaled by devicePixelRatio so lines stay crisp.
import { fmt, t } from '../i18n.ts';
import { defaultSim, SERIES_END_S, THROTTLE_BUCKET_START_S, G0, type LiftoffSample } from '../physics/liftoff.ts';

interface ChartDef {
  id: 'alt' | 'vel' | 'acc' | 'mass';
  titleKey: string;
  unit: string;
  digits: number;
  get: (s: LiftoffSample) => number;
  /** y-axis from zero (altitude, velocity, acceleration) or fitted to the data (mass). */
  zeroBased: boolean;
}

export const CHARTS: ChartDef[] = [
  { id: 'alt', titleKey: 'edu.chart.alt', unit: 'm', digits: 0, get: (s) => s.altitude, zeroBased: true },
  { id: 'vel', titleKey: 'edu.chart.vel', unit: 'm/s', digits: 0, get: (s) => s.velocity, zeroBased: true },
  { id: 'acc', titleKey: 'edu.chart.acc', unit: 'm/s²', digits: 1, get: (s) => s.accel, zeroBased: true },
  { id: 'mass', titleKey: 'edu.chart.mass', unit: 't', digits: 0, get: (s) => s.mass / 1000, zeroBased: false },
];

function niceStep(range: number, n: number): number {
  const raw = range / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

interface Built { def: ChartDef; wrap: HTMLElement; canvas: HTMLCanvasElement; value: HTMLElement; yMin: number; yMax: number; ticks: number[] }

const PAD = { l: 38, r: 10, t: 8, b: 18 };

export class MomentCharts {
  readonly el: HTMLElement;
  private built: Built[] = [];
  private tF = 7.2;
  private scrub: number | null = null;
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private css: CSSStyleDeclaration | null = null;

  constructor(private onScrub?: (t: number | null) => void) {
    this.el = document.createElement('div');
    this.el.className = 'edu-charts';
    this.build();
  }

  private build(): void {
    const sim = defaultSim();
    this.el.textContent = '';
    this.built = CHARTS.map((def) => {
      const wrap = document.createElement('figure');
      wrap.className = 'edu-chart';
      const head = document.createElement('figcaption');
      head.className = 'edu-chart-head';
      const title = document.createElement('span');
      title.className = 'edu-chart-title';
      const value = document.createElement('span');
      value.className = 'edu-chart-value';
      head.append(title, value);
      const canvas = document.createElement('canvas');
      canvas.className = 'edu-chart-canvas';
      canvas.tabIndex = 0;
      canvas.setAttribute('role', 'img');
      wrap.append(head, canvas);
      this.el.append(wrap);
      // y range
      let lo = Infinity, hi = -Infinity;
      for (const s of sim.series) { const v = def.get(s); if (v < lo) lo = v; if (v > hi) hi = v; }
      if (def.zeroBased) lo = 0;
      const step = niceStep(hi - lo, 3);
      const yMin = def.zeroBased ? 0 : Math.floor(lo / step) * step;
      const yMax = Math.ceil(hi / step) * step;
      const ticks: number[] = [];
      for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(v);
      const b: Built = { def, wrap, canvas, value, yMin, yMax, ticks };
      const move = (e: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        const u = (e.clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r);
        this.setScrub(Math.min(Math.max(u, 0), 1) * SERIES_END_S);
      };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerdown', move);
      canvas.addEventListener('pointerleave', () => this.setScrub(null));
      canvas.addEventListener('blur', () => this.setScrub(null));
      canvas.addEventListener('keydown', (e) => {
        const cur = this.scrub ?? this.tF;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { this.setScrub(Math.min(cur + 1, SERIES_END_S)); e.preventDefault(); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { this.setScrub(Math.max(cur - 1, 0)); e.preventDefault(); }
        else if (e.key === 'Home') { this.setScrub(0); e.preventDefault(); }
        else if (e.key === 'End') { this.setScrub(SERIES_END_S); e.preventDefault(); }
        else if (e.key === 'Escape') this.setScrub(null);
      });
      return b;
    });
    this.retitle();
  }

  /** Re-apply translated titles, aria labels and readouts (call after a language change). */
  retitle(): void {
    const sim = defaultSim();
    for (const b of this.built) {
      (b.wrap.querySelector('.edu-chart-title') as HTMLElement).textContent = t(b.def.titleKey);
      const vNow = b.def.get(sim.stateAt(this.tF));
      b.canvas.setAttribute('aria-label', t('edu.chart.aria', { name: t(b.def.titleKey), value: `${fmt(vNow, b.def.digits)} ${b.def.unit}` }));
    }
    this.updateValues();
    this.schedule();
  }

  setFreezeTime(tf: number): void { this.tF = tf; this.retitle(); }

  setScrub(v: number | null): void {
    if (v === this.scrub) return;
    this.scrub = v;
    this.updateValues();
    this.schedule();
    this.onScrub?.(v);
  }

  private updateValues(): void {
    const sim = defaultSim();
    const tt = this.scrub ?? this.tF;
    const s = sim.stateAt(tt);
    for (const b of this.built) {
      b.value.textContent = `${fmt(b.def.get(s), b.def.digits)} ${b.def.unit}`;
      b.value.classList.toggle('is-scrub', this.scrub !== null);
      b.value.title = `T+${fmt(tt, 1)} s`;
    }
  }

  /** Observe size changes; call once the element is in the DOM. */
  attach(): void {
    if (this.ro) return;
    this.ro = new ResizeObserver(() => this.schedule());
    for (const b of this.built) this.ro.observe(b.canvas);
    this.schedule();
  }

  dispose(): void { this.ro?.disconnect(); this.ro = null; cancelAnimationFrame(this.raf); }

  schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  private tok(name: string, fallback: string): string {
    this.css ??= getComputedStyle(this.el);
    return this.css.getPropertyValue(name).trim() || fallback;
  }

  private draw(): void {
    const sim = defaultSim();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const font = this.tok('--ui-font', 'system-ui');
    const line = this.tok('--ui-accent-2', '#6cc3ff');
    const mark = this.tok('--ui-accent', '#ff9a3c');
    const muted = this.tok('--ui-muted', '#a7b1bd');
    const fg = this.tok('--ui-fg', '#eef2f6');
    const surface = this.tok('--edu-chart-surface', '#12161c');
    for (const b of this.built) {
      const cssW = b.canvas.clientWidth, cssH = b.canvas.clientHeight;
      if (cssW < 10 || cssH < 10) continue;
      if (b.canvas.width !== Math.round(cssW * dpr) || b.canvas.height !== Math.round(cssH * dpr)) {
        b.canvas.width = Math.round(cssW * dpr); b.canvas.height = Math.round(cssH * dpr);
      }
      const ctx = b.canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      const pw = cssW - PAD.l - PAD.r, ph = cssH - PAD.t - PAD.b;
      const X = (tt: number) => PAD.l + (tt / SERIES_END_S) * pw;
      const Y = (v: number) => PAD.t + ph - ((v - b.yMin) / (b.yMax - b.yMin)) * ph;
      ctx.font = `10px ${font}`;
      ctx.textBaseline = 'middle';
      // throttle placeholder wash
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.fillRect(X(THROTTLE_BUCKET_START_S), PAD.t, X(SERIES_END_S) - X(THROTTLE_BUCKET_START_S), ph);
      // grid + y labels
      ctx.lineWidth = 1;
      ctx.textAlign = 'right';
      for (const v of b.ticks) {
        const y = Math.round(Y(v)) + 0.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.09)';
        ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke();
        ctx.fillStyle = muted;
        ctx.fillText(fmt(v, b.def.digits === 1 && v % 1 !== 0 ? 1 : 0), PAD.l - 5, y);
      }
      // x labels
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = muted;
      for (const tt of [0, 20, 40, 60]) {
        ctx.textAlign = tt === 0 ? 'left' : tt === 60 ? 'right' : 'center';
        ctx.fillText(tt === 60 ? `${tt} ${t('edu.unit.s')}` : `${tt}`, X(tt), cssH - 4);
      }
      // series
      ctx.strokeStyle = line;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      const step = Math.max(1, Math.round(sim.series.length / (pw * 1.2)));
      for (let i = 0; i < sim.series.length; i += step) {
        const s = sim.series[i];
        const x = X(s.t), y = Y(b.def.get(s));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // frozen-instant marker
      const sF = sim.stateAt(this.tF);
      ctx.strokeStyle = mark; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(X(this.tF)) + 0.5, PAD.t); ctx.lineTo(Math.round(X(this.tF)) + 0.5, PAD.t + ph); ctx.stroke();
      const dot = (x: number, y: number, col: string) => {
        ctx.fillStyle = surface; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      };
      dot(X(this.tF), Y(b.def.get(sF)), mark);
      // crosshair
      if (this.scrub !== null) {
        const sS = sim.stateAt(this.scrub);
        ctx.strokeStyle = fg; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(Math.round(X(this.scrub)) + 0.5, PAD.t); ctx.lineTo(Math.round(X(this.scrub)) + 0.5, PAD.t + ph); ctx.stroke();
        ctx.globalAlpha = 1;
        dot(X(this.scrub), Y(b.def.get(sS)), line);
      }
    }
  }
}

/** Rows for the accessible table view: every 5 s plus the frozen instant. */
export function tableRows(tF: number): { t: number; alt: number; vel: number; acc: number; mass: number; now?: boolean }[] {
  const sim = defaultSim();
  const times = Array.from({ length: 13 }, (_, i) => i * 5);
  const rows = times.map((tt) => ({ tt, now: false }));
  rows.push({ tt: tF, now: true });
  rows.sort((a, b) => a.tt - b.tt);
  return rows.map(({ tt, now }) => {
    const s = sim.stateAt(tt);
    return { t: tt, alt: s.altitude, vel: s.velocity, acc: s.accel, mass: s.mass / 1000, now };
  });
}

export const CHART_CONSTANTS = { THROTTLE_BUCKET_START_S, G0 };
