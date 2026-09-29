// Small inline-SVG diagrams for the explainers. Every one is drawn from live numbers where it has
// numbers (thrust, weight, the SPL curves, event times), coloured only through CSS classes defined
// in edu.css (dg-*), and labelled through t(). Each returns an SVG string with role="img" and an
// aria-label supplied by the caller (the explainer's title), so screen readers get the caption.
import { t, fmt } from '../i18n.ts';
import type { DiagramId } from './catalog.ts';
import {
  P, defaultSim, splAt, splFreeField, splMeasuredCurve, radiantFlux, SUN_KW_M2,
} from '../physics/liftoff.ts';
import { massAtMecoT } from './vars.ts';

const W = 320, H = 150;
const wrap = (label: string, body: string): string =>
  `<svg class="dg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const txt = (x: number, y: number, s: string, cls = 'dg-t', anchor: 'start' | 'middle' | 'end' = 'start'): string =>
  `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(s)}</text>`;
const arrowHead = (x: number, y: number, dir: 'up' | 'down' | 'right' | 'left', size: number, cls: string): string => {
  const s = size;
  const pts = { up: `${x},${y} ${x - s},${y + s * 1.4} ${x + s},${y + s * 1.4}`, down: `${x},${y} ${x - s},${y - s * 1.4} ${x + s},${y - s * 1.4}`,
    right: `${x},${y} ${x - s * 1.4},${y - s} ${x - s * 1.4},${y + s}`, left: `${x},${y} ${x + s * 1.4},${y - s} ${x + s * 1.4},${y + s}` }[dir];
  return `<polygon class="${cls}" points="${pts}"/>`;
};

/** Log-x line plot helper: returns the path for f over [x0,x1] mapped into the box. */
function logPath(f: (x: number) => number, x0: number, x1: number, y0: number, y1: number, box: { l: number; r: number; t: number; b: number }, n = 60): string {
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 * (x1 / x0) ** (i / n);
    const u = Math.log(x / x0) / Math.log(x1 / x0);
    const v = (f(x) - y0) / (y1 - y0);
    pts.push(`${(box.l + u * (box.r - box.l)).toFixed(1)},${(box.b - v * (box.b - box.t)).toFixed(1)}`);
  }
  return 'M' + pts.join('L');
}

// ── the diagrams ────────────────────────────────────────────────────────────────────────────
function forces(label: string): string {
  const s0 = defaultSim().series[0];
  const Tm = s0.thrust / 1e6, Wm = s0.weight / 1e6, k = 0.85; // px per MN
  const gx = 160, gy = 128;
  const top = gy - 44;
  const tL = Tm * k, wL = Wm * k;
  return wrap(label, `
    <line class="dg-line" x1="40" y1="${gy}" x2="280" y2="${gy}"/>
    ${txt(276, gy + 12, t('edu.dia.ground'), 'dg-t', 'end')}
    <rect class="dg-body" x="${gx - 9}" y="${top - 46}" width="18" height="90" rx="2"/>
    <path class="dg-body" d="M${gx - 9},${top - 46} L${gx},${top - 62} L${gx + 9},${top - 46} Z"/>
    <line class="dg-thrust" x1="${gx - 30}" y1="${gy - 6}" x2="${gx - 30}" y2="${gy - 6 - tL + 10}" stroke-width="5"/>
    ${arrowHead(gx - 30, gy - 6 - tL, 'up', 7, 'dg-thrust-f')}
    ${txt(gx - 40, gy - 6 - tL / 2, `${t('edu.dia.thrust')} ${fmt(Tm, 1)} MN`, 'dg-t dg-strong', 'end')}
    <line class="dg-weight" x1="${gx + 30}" y1="${gy - 6 - wL}" x2="${gx + 30}" y2="${gy - 16}" stroke-width="5"/>
    ${arrowHead(gx + 30, gy - 6, 'down', 7, 'dg-weight-f')}
    ${txt(gx + 40, gy - 6 - wL / 2, `${t('edu.dia.weight')} ${fmt(Wm, 1)} MN`, 'dg-t dg-strong', 'start')}
    <line class="dg-net" x1="${gx + 30}" y1="${gy - 6 - wL - 2}" x2="${gx + 30}" y2="${gy - 6 - tL + 12}" stroke-width="5"/>
    ${arrowHead(gx + 30, gy - 6 - tL, 'up', 7, 'dg-net-f')}
    ${txt(gx + 40, gy - 6 - tL + 6, `${t('edu.dia.net')} ${fmt(Tm - Wm, 1)} MN`, 'dg-t dg-strong', 'start')}`);
}

function thrustDia(label: string): string {
  const v = P('raptor_exhaust_velocity_sl_mps');
  return wrap(label, `
    <path class="dg-body" d="M40,52 L90,52 L130,20 L130,110 L90,78 L40,78 Z"/>
    ${txt(70, 68, t('edu.dia.nozzle'), 'dg-t', 'middle')}
    ${Array.from({ length: 9 }, (_, i) => `<circle class="dg-dot" cx="${146 + i * 15}" cy="${65 + (i % 3 - 1) * 12}" r="${2 + i * 0.1}"/>`).join('')}
    <line class="dg-thrust" x1="140" y1="65" x2="272" y2="65" stroke-width="1.5" stroke-dasharray="1 4"/>
    ${arrowHead(290, 65, 'right', 5, 'dg-mute-f')}
    ${txt(214, 45, `ṁ × vₑ = F`, 'dg-t dg-strong', 'middle')}
    ${txt(214, 100, `vₑ = ${fmt(v)} m/s`, 'dg-t', 'middle')}
    <line class="dg-thrust" x1="40" y1="128" x2="40" y2="108" stroke-width="5"/>
    ${arrowHead(40, 104, 'up', 6, 'dg-thrust-f')}
    ${txt(52, 122, t('edu.dia.thrustlabel'), 'dg-t')}`);
}

function rocketeq(label: string): string {
  const m0 = P('liftoff_mass_used_t'), m1 = massAtMecoT();
  const w0 = 200, w1 = w0 * m1 / m0;
  return wrap(label, `
    <rect class="dg-bar-a" x="80" y="24" width="${w0}" height="30" rx="4"/>
    ${txt(74, 44, 'm₀', 'dg-t dg-strong', 'end')}${txt(84 + w0 - 8, 44, `${fmt(m0)} t`, 'dg-bar-txt', 'end')}
    <rect class="dg-bar-b" x="80" y="70" width="${w1.toFixed(1)}" height="30" rx="4"/>
    ${txt(74, 90, 'm₁', 'dg-t dg-strong', 'end')}${txt(84 + w1 - 8, 90, `${fmt(m1)} t`, 'dg-bar-txt', 'end')}
    ${txt(160, 130, `Δv = vₑ ln(m₀/m₁) = ${fmt(P('raptor_exhaust_velocity_sl_mps') * Math.log(m0 / m1) / 1000, 2)} km/s`, 'dg-t dg-strong', 'middle')}`);
}

function steamDia(label: string): string {
  const puffs = [[120, 88, 26], [150, 74, 32], [188, 84, 30], [222, 96, 22], [100, 104, 18], [170, 104, 24]];
  return wrap(label, `
    <circle class="dg-sun" cx="24" cy="70" r="11"/>
    ${[52, 66, 80, 94, 108].map((y) => `<line class="dg-ray" x1="42" y1="${y - 4}" x2="292" y2="${y + 4}"/>`).join('')}
    ${txt(24, 96, t('edu.dia.sun'), 'dg-t', 'middle')}
    ${puffs.map(([x, y, r]) => `<circle class="dg-cloud" cx="${x}" cy="${y}" r="${r}"/>`).join('')}
    ${Array.from({ length: 14 }, (_, i) => `<circle class="dg-dot" cx="${252 + (i % 4) * 9 - 6}" cy="${34 + Math.floor(i / 4) * 12}" r="${1.2 + (i % 3) * 0.5}"/>`).join('')}
    ${txt(266, 22, t('edu.dia.droplets'), 'dg-t', 'middle')}
    ${txt(170, 138, t('edu.dia.steam'), 'dg-t', 'middle')}`);
}

function diamondsDia(label: string): string {
  const cells = Array.from({ length: 6 }, (_, i) => {
    const x0 = 84 + i * 36, x1 = x0 + 36, mid = x0 + 18;
    const hw = 20 - i * 1.2;
    return `<path class="dg-cell" d="M${x0},75 L${mid},${75 - hw} L${x1},75 L${mid},${75 + hw} Z"/>`;
  }).join('');
  const boundary = `<path class="dg-line" fill="none" d="M84,60 ${Array.from({ length: 6 }, (_, i) => `Q${102 + i * 36},${44 - i} ${120 + i * 36},60`).join(' ')}"/>
    <path class="dg-line" fill="none" d="M84,90 ${Array.from({ length: 6 }, (_, i) => `Q${102 + i * 36},${106 + i} ${120 + i * 36},90`).join(' ')}"/>`;
  return wrap(label, `
    <path class="dg-body" d="M30,58 L64,58 L84,44 L84,106 L64,92 L30,92 Z"/>
    ${boundary}${cells}
    ${txt(57, 130, t('edu.dia.nozzle'), 'dg-t', 'middle')}
    ${txt(192, 130, t('edu.dia.shock') + ' / ' + t('edu.dia.expansion'), 'dg-t', 'middle')}
    ${txt(300, 22, `pₑ ${fmt(P('raptor_exit_pressure_bar'), 2)} bar`, 'dg-t dg-strong', 'end')}
    ${txt(300, 36, `p\u2090 ${fmt(1.01, 2)} bar`, 'dg-t', 'end')}`);
}

function colourDia(label: string): string {
  return wrap(label, `
    <defs><linearGradient id="dgc" x1="0" x2="1"><stop offset="0" stop-color="#c9a6ff"/><stop offset="0.45" stop-color="#ff9fb8"/><stop offset="1" stop-color="#ffb347"/></linearGradient>
    <linearGradient id="dgm" x1="0" x2="1"><stop offset="0" stop-color="#ffb347" stop-opacity="0"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0.9"/></linearGradient></defs>
    <path d="M40,66 L200,50 L290,30 L290,120 L200,100 L40,84 Z" fill="url(#dgm)" opacity="0.55"/>
    <path d="M40,68 L200,62 L280,60 L280,90 L200,88 L40,82 Z" fill="url(#dgc)"/>
    ${txt(90, 46, t('edu.dia.core'), 'dg-t', 'middle')}
    ${txt(250, 24, t('edu.dia.mix'), 'dg-t', 'middle')}
    ${txt(160, 138, `O/F ${fmt(P('raptor_of_ratio'), 1)} < ${fmt(4, 1)}`, 'dg-t dg-strong', 'middle')}`);
}

function soundDia(label: string): string {
  const box = { l: 44, r: 300, t: 14, b: 116 };
  const r0 = 100, r1 = 30_000, y0 = 60, y1 = 200;
  const gx = (r: number) => box.l + (Math.log(r / r0) / Math.log(r1 / r0)) * (box.r - box.l);
  const gy = (v: number) => box.b - ((v - y0) / (y1 - y0)) * (box.b - box.t);
  const ticks = [100, 1000, 10000].map((r) => `<line class="dg-grid" x1="${gx(r)}" x2="${gx(r)}" y1="${box.t}" y2="${box.b}"/>${txt(gx(r), box.b + 12, r >= 1000 ? `${r / 1000} km` : `${r} m`, 'dg-t', 'middle')}`).join('');
  const yt = [80, 120, 160, 200].map((v) => `<line class="dg-grid" x1="${box.l}" x2="${box.r}" y1="${gy(v)}" y2="${gy(v)}"/>${txt(box.l - 4, gy(v) + 3, `${v}`, 'dg-t', 'end')}`).join('');
  const meas = [[10_000, P('spl_10km_measured_dB')], [20_000, P('spl_20km_measured_dB')]];
  return wrap(label, `${yt}${ticks}
    <path class="dg-curve-2" fill="none" d="${logPath((r) => splFreeField(r), r0, r1, y0, y1, box)}"/>
    <path class="dg-curve" fill="none" d="${logPath((r) => splAt(r), r0, r1, y0, y1, box)}"/>
    ${meas.map(([r, v]) => `<circle class="dg-pt" cx="${gx(r)}" cy="${gy(v)}" r="4"/>`).join('')}
    ${txt(box.l + 6, box.t + 10, 'dB', 'dg-t')}
    ${txt(box.r - 2, gy(splFreeField(6000)) - 8, t('edu.dia.free'), 'dg-t', 'end')}
    ${txt(box.r - 2, gy(splAt(20_000)) + 16, t('edu.dia.measured'), 'dg-t dg-strong', 'end')}`);
}

function stagingDia(label: string): string {
  const x0 = 24, x1 = 300, y = 70, T = 160;
  const X = (s: number) => x0 + (s / T) * (x1 - x0);
  const ev: [number, string, number][] = [[P('max_q_time_f14_s'), t('edu.dia.maxq'), -1], [P('meco_time_f14_s'), t('edu.dia.meco'), -1], [P('hot_staging_time_f14_s'), t('edu.dia.stage'), 1]];
  const tf = defaultSim().solveFreezeTime();
  return wrap(label, `
    <line class="dg-line" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>
    ${[0, 40, 80, 120, 160].map((s) => `<line class="dg-line" x1="${X(s)}" y1="${y - 3}" x2="${X(s)}" y2="${y + 3}"/>${txt(X(s), y + 16, `${s}`, 'dg-t', 'middle')}`).join('')}
    <circle class="dg-now" cx="${X(tf)}" cy="${y}" r="5"/>${txt(X(tf) + 8, y - 12, `T+${fmt(tf, 1)} s ${t('edu.dia.now')}`, 'dg-t dg-strong')}
    ${ev.map(([s, name, side], i) => `<line class="dg-line" x1="${X(s)}" y1="${y}" x2="${X(s)}" y2="${y + side * (26 + (i === 2 ? 22 : 0))}"/><circle class="dg-pt" cx="${X(s)}" cy="${y}" r="4"/>${txt(X(s) + (i === 0 ? 5 : -5), y + side * (30 + (i === 2 ? 26 : 0)) + (side > 0 ? 8 : 0), `${name} ${fmt(s)} s`, 'dg-t', i === 0 ? 'start' : 'end')}`).join('')}
    ${txt(x1, 138, 's', 'dg-t', 'end')}`);
}

function catchDia(label: string): string {
  return wrap(label, `
    <rect class="dg-body" x="62" y="14" width="26" height="124" rx="1"/>
    ${Array.from({ length: 8 }, (_, i) => `<line class="dg-line" x1="62" y1="${22 + i * 15}" x2="88" y2="${36 + i * 15}"/>`).join('')}
    ${txt(75, 148, t('edu.hotspot.tower.short'), 'dg-t', 'middle')}
    <path class="dg-arm" d="M88,44 L148,44 L148,54 L98,54 Z"/><path class="dg-arm" d="M88,92 L148,92 L148,82 L98,82 Z"/>
    <rect class="dg-body" x="162" y="22" width="34" height="118" rx="2"/>
    <circle class="dg-pt" cx="162" cy="46" r="4"/><circle class="dg-pt" cx="162" cy="90" r="4"/>
    ${txt(206, 50, t('edu.dia.pin'), 'dg-t')}${txt(206, 30, t('edu.dia.booster'), 'dg-t dg-strong')}
    ${txt(118, 104, t('edu.dia.arm'), 'dg-t', 'middle')}`);
}

function frostDia(label: string): string {
  return wrap(label, `
    <defs><linearGradient id="dgf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b7684"/><stop offset="0.4" stop-color="#7f8a98"/><stop offset="0.42" stop-color="#e9eef5"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>
    <rect x="128" y="10" width="44" height="130" rx="3" fill="url(#dgf)" stroke="var(--ui-border)"/>
    <line class="dg-line" x1="110" y1="64" x2="190" y2="64" stroke-dasharray="3 3"/>
    ${txt(196, 40, t('edu.dia.ch4'), 'dg-t')}${txt(196, 110, t('edu.dia.lox') + ' + ' + t('edu.dia.frost'), 'dg-t dg-strong')}
    ${txt(104, 67, `${fmt(45)} m`, 'dg-t', 'end')}`);
}

function heatDia(label: string): string {
  const box = { l: 44, r: 300, t: 14, b: 116 };
  const r0 = 100, r1 = 4000, y0 = 0.02, y1 = 60;
  const logY = (v: number) => box.b - (Math.log(v / y0) / Math.log(y1 / y0)) * (box.b - box.t);
  const gx = (r: number) => box.l + (Math.log(r / r0) / Math.log(r1 / r0)) * (box.r - box.l);
  const pts: string[] = [];
  for (let i = 0; i <= 50; i++) { const r = r0 * (r1 / r0) ** (i / 50); pts.push(`${gx(r).toFixed(1)},${logY(radiantFlux(r)).toFixed(1)}`); }
  const yt = [0.1, 1, 10].map((v) => `<line class="dg-grid" x1="${box.l}" x2="${box.r}" y1="${logY(v)}" y2="${logY(v)}"/>${txt(box.l - 4, logY(v) + 3, `${fmt(v, v < 1 ? 1 : 0)}`, 'dg-t', 'end')}`).join('');
  const xt = [100, 500, 2000].map((r) => `${txt(gx(r), box.b + 12, r >= 1000 ? `${r / 1000} km` : `${r} m`, 'dg-t', 'middle')}`).join('');
  return wrap(label, `${yt}${xt}
    <line class="dg-sunline" x1="${box.l}" x2="${box.r}" y1="${logY(SUN_KW_M2)}" y2="${logY(SUN_KW_M2)}"/>${txt(box.r, logY(SUN_KW_M2) - 4, t('edu.dia.sunlevel'), 'dg-t', 'end')}
    <path class="dg-curve" fill="none" d="M${pts.join('L')}"/>
    ${txt(box.l + 6, box.t + 8, 'kW/m²', 'dg-t')}${txt(box.r, box.b - 8, t('edu.dia.heat'), 'dg-t dg-strong', 'end')}`);
}

function fuelDia(label: string): string {
  const lox = P('mdot_lox_total_kgps') / 1000, ch4 = P('mdot_ch4_total_kgps') / 1000, tot = lox + ch4;
  const w = 240, wl = (w * lox) / tot;
  return wrap(label, `
    <rect class="dg-bar-a" x="40" y="46" width="${(wl - 1).toFixed(1)}" height="34" rx="4"/>
    <rect class="dg-bar-c" x="${(40 + wl + 1).toFixed(1)}" y="46" width="${(w - wl - 1).toFixed(1)}" height="34" rx="4"/>
    ${txt(40 + wl / 2, 68, `${t('edu.dia.oxygen')} ${fmt(lox, 1)} t/s`, 'dg-bar-txt', 'middle')}
    ${txt(40 + wl + (w - wl) / 2, 100, `${t('edu.dia.methane')} ${fmt(ch4, 1)} t/s`, 'dg-t dg-strong', 'middle')}
    ${txt(160, 130, `${fmt(tot, 1)} t/s · ${t('edu.dia.burn')} ${fmt(P('booster_full_thrust_burn_time_s'))} s`, 'dg-t', 'middle')}`);
}

const BUILDERS: Record<DiagramId, (label: string) => string> = {
  forces, thrust: thrustDia, rocketeq, steam: steamDia, diamonds: diamondsDia, colour: colourDia, sound: soundDia,
  staging: stagingDia, catch: catchDia, frost: frostDia, heat: heatDia, fuel: fuelDia,
};

export function diagram(id: DiagramId, label: string): string {
  return BUILDERS[id](label);
}

export { splMeasuredCurve };
