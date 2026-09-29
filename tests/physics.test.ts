import { describe, expect, it } from 'vitest';
import {
  simulate, defaultSim, solveFreezeTime, soundFrontRadius, soundArrivalTime, splAt, splFreeField, radiantFlux,
  centreOfMassHeight, idealDeltaV, exhaustVelocity, vacuumThrust, defaultParams, P, speedOfSound,
} from '../src/physics/liftoff.ts';
import { val } from '../src/specs.ts';

describe('liftoff model', () => {
  const sim = defaultSim();

  it('freeze time matches the spec within 0.3 s', () => {
    const tf = solveFreezeTime();
    expect(Math.abs(tf - val('scene.t_freeze'))).toBeLessThan(0.3);
    // and the engine plane really is at 158 m there
    expect(sim.stateAt(tf).altitude).toBeCloseTo(val('scene.vehicle_base_height'), 1);
  });

  it('liftoff T/W is 1.53 +/- 0.05', () => {
    expect(Math.abs(sim.series[0].twr - 1.53)).toBeLessThan(0.05);
    expect(sim.series[0].altitude).toBe(val('scene.olm_deck_height'));
    expect(sim.series[0].velocity).toBe(0);
  });

  it('thrust at T-0 is the spec 80.8 MN and vacuum thrust about 85 MN', () => {
    expect(sim.series[0].thrust / 1e6).toBeCloseTo(80.8, 1);
    expect(vacuumThrust() / 1e6).toBeCloseTo(P('vac_thrust_booster_MN'), 0);
  });

  it('mass decreases monotonically at about 25 t/s', () => {
    for (let i = 1; i < sim.series.length; i++) expect(sim.series[i].mass).toBeLessThan(sim.series[i - 1].mass);
    const mdot = sim.stateAt(10).mdot / 1000;
    expect(mdot).toBeGreaterThan(24);
    expect(mdot).toBeLessThan(26);
    // integrated burn over the first 10 s
    expect((sim.stateAt(10).burned) / 1000).toBeCloseTo(mdot * 10, 0);
  });

  it('acceleration increases over 0-20 s (lighter, same thrust)', () => {
    for (let t = 0.5; t <= 20; t += 0.5) expect(sim.stateAt(t).accel).toBeGreaterThan(sim.stateAt(t - 0.5).accel);
  });

  it('is consistent with a hand check: 5.3 m/s2 at release, rising', () => {
    const a0 = sim.series[0].accel;
    expect(a0).toBeGreaterThan(5.0);
    expect(a0).toBeLessThan(5.5);
    expect(sim.stateAt(7.2).velocity).toBeGreaterThan(35);
    expect(sim.stateAt(7.2).velocity).toBeLessThan(45);
  });

  it('altitude and velocity are monotonically increasing', () => {
    for (let i = 1; i < sim.series.length; i++) {
      expect(sim.series[i].altitude).toBeGreaterThan(sim.series[i - 1].altitude);
      expect(sim.series[i].velocity).toBeGreaterThan(sim.series[i - 1].velocity);
    }
  });

  it('heavier liftoff mass clears the tower later (5300 t -> 5650 t)', () => {
    const light = simulate({ m0: 5.3e6 }).solveFreezeTime();
    const heavy = simulate({ m0: 5.65e6 }).solveFreezeTime();
    expect(heavy).toBeGreaterThan(light);
    expect(heavy - light).toBeLessThan(1.5);
  });

  it('drag is a small fraction of thrust in the first 10 s', () => {
    expect(sim.stateAt(10).drag / sim.stateAt(10).thrust).toBeLessThan(0.005);
  });

  it('thrust gain from falling pressure is tiny at 158 m', () => {
    const s = sim.stateAt(7.2);
    expect(s.thrust / 1e6 / 80.8 - 1).toBeLessThan(0.002);
    expect(s.thrust).toBeGreaterThan(sim.series[0].thrust);
  });

  it('centre of mass is between the two stages, above the middle of the booster', () => {
    const h = centreOfMassHeight();
    expect(h).toBeGreaterThan(30);
    expect(h).toBeLessThan(70);
  });

  it('Tsiolkovsky delta-v matches the physics note (3.06 km/s)', () => {
    const dv = idealDeltaV(exhaustVelocity(), 5.4e6, 2.1e6);
    expect(dv / 1000).toBeCloseTo(3.06, 1);
  });

  it('default params come from the spec', () => {
    const p = defaultParams();
    expect(p.m0).toBe(5.4e6);
    expect(p.nozzleAreaTotal).toBeCloseTo(33 * 1.131, 1);
  });
});

describe('acoustics and heat', () => {
  it('speed of sound at 25 C is 346 m/s', () => {
    expect(speedOfSound()).toBeCloseTo(346, 0);
  });

  it('sound-front radius is c (t + 3 s)', () => {
    const c = P('sound_speed_25C_mps');
    expect(soundFrontRadius(0)).toBeCloseTo(c * 3, 6);
    expect(soundFrontRadius(7.2)).toBeCloseTo(c * 10.2, 6);
    expect(soundFrontRadius(-3)).toBe(0);
    expect(soundFrontRadius(10)).toBeCloseTo(4498, 0);
  });

  it('arrival time is emission + r/c', () => {
    expect(soundArrivalTime(346, 0)).toBeCloseTo(1, 6);
    expect(soundArrivalTime(1000, -3)).toBeCloseTo(-3 + 1000 / 346, 6);
  });

  it('SPL is strictly decreasing in distance', () => {
    let prev = Infinity;
    for (let lr = 1.0; lr <= 5; lr += 0.01) {
      const v = splAt(10 ** lr);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });

  it('SPL matches the anchors: 160 dB at 100 m free-field, blended toward 105 / 90 dB at 10 / 20 km', () => {
    expect(splFreeField(100)).toBeCloseTo(160, 0);
    expect(splAt(100)).toBeCloseTo(160, 0);
    expect(splAt(10_000)).toBeCloseTo(105, 0);
    expect(splAt(20_000)).toBeCloseTo(90, 0);
    expect(splAt(1)).toBeLessThanOrEqual(200);
  });

  it('radiant flux follows the estimate: 40 kW/m2 at 100 m, 0.4 at 1 km', () => {
    expect(radiantFlux(100)).toBeCloseTo(40, 6);
    expect(radiantFlux(1000)).toBeCloseTo(0.4, 6);
    expect(radiantFlux(2000)).toBeLessThan(radiantFlux(1000));
  });
});

// ── educational content ─────────────────────────────────────────────────────────────────────
import { en } from '../src/edu/content.en.ts';
import { fi } from '../src/edu/content.fi.ts';
import { HOTSPOT_DEFS, EXPLAINER_DEFS, allUiKeys } from '../src/edu/catalog.ts';
import { templateVars } from '../src/edu/vars.ts';
import { keyValue, KEY_DEFS } from '../src/edu/keys.ts';
import { registerStrings, setLang } from '../src/i18n.ts';
import { walkReadout, fmtT } from '../src/edu/hud.ts';
import * as THREE from 'three';

const HOTSPOT_IDS = ['raptors', 'gridfins', 'hotstage', 'flaps', 'tiles', 'frost', 'ship', 'booster', 'tower', 'chopsticks', 'olm', 'trench', 'tankfarm', 'plume', 'machdiamonds', 'steam', 'fireball', 'soundfront'];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
const words = (s: string) => s.trim().split(/\s+/).length;
// per-call variables that are supplied at the call site rather than by templateVars()
const CALL_VARS = new Set(['title', 'note', 'name', 'value', 'kmh', 'g', 'rise', 'weight', 'tw0', 'm0', 'isp', 'lox', 'ch4', 'r', 's', 't', 'ratio', 'x', 'm', 'tf', 'v', 'tw', 'lead', 'alt_tf']);

describe('educational content', () => {
  it('Finnish has every English key and vice versa', () => {
    expect(Object.keys(en).filter((k) => !(k in fi))).toEqual([]);
    expect(Object.keys(fi).filter((k) => !(k in en))).toEqual([]);
  });

  it('every hotspot id has a title, a short label and a 60-120 word body in both languages', () => {
    for (const [lang, d] of [['en', en], ['fi', fi]] as const) {
      const bad: string[] = [];
      for (const id of HOTSPOT_IDS) {
        expect(d[`edu.hotspot.${id}.title`], `${lang} ${id} title`).toBeTruthy();
        expect(d[`edu.hotspot.${id}.short`], `${lang} ${id} short`).toBeTruthy();
        const n = words(d[`edu.hotspot.${id}.body`] ?? '');
        if (n < 60 || n > 120) bad.push(`${lang} ${id}: ${n} words`);
      }
      expect(bad, 'bodies outside 60-120 words').toEqual([]);
    }
    expect(HOTSPOT_DEFS.map((d) => d.id).sort()).toEqual([...HOTSPOT_IDS].sort());
  });

  it('there are at least 8 explainers with text in both languages', () => {
    expect(EXPLAINER_DEFS.length).toBeGreaterThanOrEqual(8);
    for (const e of EXPLAINER_DEFS) for (const d of [en, fi]) for (const k of ['title', 'body', 'cap']) expect(d[`edu.ex.${e.id}.${k}`]).toBeTruthy();
  });

  it('every placeholder is a known template variable or a documented call-site variable', () => {
    const vars = templateVars();
    for (const [k, v] of [...Object.entries(en), ...Object.entries(fi)]) {
      for (const p of placeholders(v)) expect(p in vars || CALL_VARS.has(p), `${k}: {${p}}`).toBe(true);
    }
  });

  it('every displayed spec key resolves, has a unit rule and a label in both languages', () => {
    for (const key of allUiKeys()) {
      expect(keyValue(key), key).not.toBeNull();
      expect(KEY_DEFS[key], `${key} unit`).toBeTruthy();
      expect(en[`edu.k.${key}`], `en ${key}`).toBeTruthy();
      expect(fi[`edu.k.${key}`], `fi ${key}`).toBeTruthy();
    }
  });

  it('template variables format with a decimal comma in Finnish', () => {
    registerStrings({ en, fi });
    const oldDoc = (globalThis as any).document;
    (globalThis as any).document = { documentElement: {} };
    setLang('fi');
    expect(templateVars().h_booster).toBe('72,3');
    setLang('en');
    expect(templateVars().h_booster).toBe('72.3');
    (globalThis as any).document = oldDoc;
  });
});

describe('walk HUD maths', () => {
  const engine = new THREE.Vector3(0, 158, 0), ign = new THREE.Vector3(0, 20, 0), end = new THREE.Vector3(0, -4, 0);
  const tf = defaultSim().solveFreezeTime();
  it('the walk spawn already heard the ignition before the frozen instant', () => {
    const r = walkReadout(new THREE.Vector3(20, 1.7, 75), tf, engine, ign, end);
    expect(r.reached).toBe(true);
    expect(r.arrivalIgnition).toBeLessThan(0);
  });
  it('5 km away the sound has not arrived and reports the remaining time', () => {
    const r = walkReadout(new THREE.Vector3(5000, 1.7, 0), tf, engine, ign, end);
    expect(r.reached).toBe(false);
    expect(r.remaining).toBeCloseTo(5000 / 346 - 3 - tf, 0);
    expect(r.spl).toBeLessThan(splAt(1000));
  });
  it('formats negative times with a true minus', () => {
    expect(fmtT(-2.5)).toBe('−2.5');
    expect(fmtT(1.3)).toBe('+1.3');
  });
});
