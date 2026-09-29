// Walk HUD: shown while the camera is in walk mode. Distance to the vehicle, whether the sound of
// ignition has reached you at the frozen instant (or when it will), the estimated loudness where you
// stand, and the radiant heat. Times are T+ (negative = before release; ignition is T-3 s).
import * as THREE from 'three';
import { h, fmt, t } from './dom.ts';
import {
  P, soundArrivalTime, soundFrontRadius, splAt, splBand, radiantFlux, SUN_KW_M2, engineStartLead,
} from '../physics/liftoff.ts';

const DB_MIN = 30, DB_MAX = 200;
const HEAT_MIN = 0.01, HEAT_MAX = 60;

/** Signed T+ time text with a true minus sign: +1.3, −2.5. */
export function fmtT(sec: number, digits = 1): string {
  return `${sec < 0 ? '−' : '+'}${fmt(Math.abs(sec), digits)}`;
}

const fmtDist = (m: number): string => (m >= 1000 ? `${fmt(m / 1000, 1)} km` : `${fmt(m)} m`);

/** Distance from point p to the segment a-b. */
function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const u = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
  return p.distanceTo(a.clone().addScaledVector(ab, u));
}

export interface WalkReadout {
  distVehicle: number;       // m, to the engine plane
  distIgnition: number;      // m, to the ignition point (sound source)
  distGround: number;        // m, horizontal distance to the pad axis
  arrivalIgnition: number;   // T+ s when the sound of ignition arrives
  reached: boolean;
  remaining: number;         // s until it arrives (0 when reached)
  spl: number;               // dB
  heat: number;              // kW/m2
}

/** Pure computation of what the HUD shows (unit-testable). */
export function walkReadout(cam: THREE.Vector3, tF: number, engine: THREE.Vector3, ignition: THREE.Vector3, plumeEnd: THREE.Vector3): WalkReadout {
  const distIgnition = cam.distanceTo(ignition);
  const arrivalIgnition = soundArrivalTime(distIgnition, -engineStartLead());
  const reached = distIgnition <= soundFrontRadius(tF);
  return {
    distVehicle: cam.distanceTo(engine),
    distIgnition,
    distGround: Math.hypot(cam.x - ignition.x, cam.z - ignition.z),
    arrivalIgnition,
    reached,
    remaining: reached ? 0 : arrivalIgnition - tF,
    spl: splAt(distIgnition),
    heat: radiantFlux(distToSegment(cam, engine, plumeEnd)),
  };
}

export class WalkHud {
  readonly el: HTMLElement;
  private last: WalkReadout | null = null;
  private tF = 7.2;

  constructor() {
    this.el = h('aside', { class: 'edu-hud ui-glass', attrs: { role: 'status', 'aria-live': 'off', hidden: '', 'data-edu': 'hud' } });
  }

  setFreezeTime(tF: number): void { this.tF = tF; }
  show(v: boolean): void { this.el.toggleAttribute('hidden', !v); }
  isVisible(): boolean { return !this.el.hasAttribute('hidden'); }

  update(cam: THREE.Vector3, engine: THREE.Vector3, ignition: THREE.Vector3, plumeEnd: THREE.Vector3): void {
    const r = walkReadout(cam, this.tF, engine, ignition, plumeEnd);
    const l = this.last;
    // re-render only on visible changes
    if (l && Math.abs(l.distVehicle - r.distVehicle) < 0.5 && l.reached === r.reached) return;
    this.last = r;
    this.render();
  }

  render(): void {
    const r = this.last;
    this.el.textContent = '';
    if (!r) return;
    this.el.setAttribute('aria-label', t('edu.hud.aria'));
    const row = (label: string, value: string, sub?: string) =>
      h('div', { class: 'edu-hud-row' }, h('span', { class: 'edu-hud-label', text: label }), h('b', { class: 'edu-hud-value', text: value }), sub ? h('span', { class: 'edu-hud-sub', text: sub }) : null);
    const band = splBand(r.spl);
    const heatX = r.heat / SUN_KW_M2;
    const heatText = `${fmt(r.heat, r.heat < 1 ? 2 : r.heat < 10 ? 1 : 0)} kW/m²`;
    const heatSub = heatX >= 1 ? t('edu.hud.heat.sun', { x: fmt(heatX, heatX < 10 ? 1 : 0) }) : t('edu.hud.heat.less');
    const meter = (frac: number, cls: string) =>
      h('div', { class: `edu-meter ${cls}`, attrs: { 'aria-hidden': 'true' } }, h('span', { attrs: { style: `width:${Math.round(Math.min(Math.max(frac, 0), 1) * 100)}%` } }));
    const dbFrac = (r.spl - DB_MIN) / (DB_MAX - DB_MIN);
    const heatFrac = Math.log(r.heat / HEAT_MIN) / Math.log(HEAT_MAX / HEAT_MIN);

    this.el.append(
      h('h2', { class: 'edu-hud-title', text: t('edu.hud.title') }),
      row(t('edu.hud.dist'), fmtDist(r.distVehicle), `${t('edu.hud.ground')}: ${fmtDist(r.distGround)}`),
      h('div', { class: `edu-hud-sound ${r.reached ? 'is-reached' : 'is-pending'}` },
        h('b', { text: r.reached ? t('edu.hud.reached') : t('edu.hud.notyet') }),
        h('span', { text: r.reached ? t('edu.hud.reached.sub', { t: fmtT(r.arrivalIgnition) }) : t('edu.hud.notyet.sub', { s: fmt(r.remaining, 1), t: fmt(r.arrivalIgnition, 1) }) })),
      row(r.reached ? t('edu.hud.spl') : t('edu.hud.spl.pending'), `${fmt(r.spl)} dB`, t(`edu.hud.band.${band}`)),
      meter(dbFrac, `is-${band}`),
      row(t('edu.hud.heat'), heatText, heatSub),
      meter(heatFrac, 'is-heat'),
      h('p', { class: 'edu-fine', text: t('edu.hud.est') }),
    );
  }

  dispose(): void { this.el.remove(); }
}

