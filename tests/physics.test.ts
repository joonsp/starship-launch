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

// ── internal consistency of the physics numbers the UI shows (fact-check round) ─────────────
import { vacuumGainPct, pressureMatchAltitude, peakDynamicPressure, massAtCutoffT, nominalMdot, G0 } from '../src/physics/liftoff.ts';
import { massAtMecoT, boosterReserveT } from '../src/edu/vars.ts';
import { VALUES } from '../src/specs.ts';

/** Isentropic nozzle: exit Mach for area ratio eps, then p/pc and T/Tc. */
function isentropicExit(eps: number, gamma: number): { mach: number; pRatio: number; tRatio: number } {
  const areaRatio = (m: number) => (1 / m) * (((2 / (gamma + 1)) * (1 + ((gamma - 1) / 2) * m * m)) ** ((gamma + 1) / (2 * (gamma - 1))));
  let lo = 1.0001, hi = 10;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (areaRatio(mid) < eps) lo = mid; else hi = mid; }
  const m = (lo + hi) / 2, f = 1 + ((gamma - 1) / 2) * m * m;
  return { mach: m, pRatio: f ** (-gamma / (gamma - 1)), tRatio: 1 / f };
}

describe('fact-check: internal consistency', () => {
  it('thrust = engine count x per-engine thrust, and T/W follows from mass and thrust', () => {
    expect(P('booster_engines') * P('raptor3_thrust_sl_tf') * G0 / 1000).toBeCloseTo(P('liftoff_thrust_b3_MN'), 0);
    expect(P('liftoff_thrust_b3_MN') * 1e6 / (P('liftoff_mass_used_t') * 1000 * G0)).toBeCloseTo(P('liftoff_tw_central'), 2);
    expect(P('liftoff_thrust_b3_MN') * 1e6 / (5700e3 * G0)).toBeCloseTo(P('liftoff_tw_range_low'), 2);
    expect(P('liftoff_thrust_b3_MN') * 1e6 / (5300e3 * G0)).toBeCloseTo(P('liftoff_tw_range_high'), 2);
    expect(P('liftoff_thrust_b3_MN') * 0.2248089).toBeCloseTo(P('liftoff_thrust_b3_Mlbf'), 0);
  });

  it('mass flow, propellant split and burn time follow from thrust, Isp and the propellant load', () => {
    const mdot = P('liftoff_thrust_b3_MN') * 1e6 / (P('raptor3_isp_sl_used_s') * G0);
    expect(mdot).toBeCloseTo(P('mdot_booster_total_kgps'), -1);
    expect(nominalMdot(defaultParams())).toBeCloseTo(mdot, -1);
    expect(P('mdot_lox_total_kgps') + P('mdot_ch4_total_kgps')).toBeCloseTo(P('mdot_booster_total_kgps'), -1);
    expect(P('mdot_lox_total_kgps') / P('mdot_ch4_total_kgps')).toBeCloseTo(P('raptor_of_ratio'), 1);
    expect(P('booster_prop_mass_b3_t') * 1000 / P('mdot_booster_total_kgps')).toBeCloseTo(P('booster_full_thrust_burn_time_s'), 0);
    expect(P('raptor_exhaust_velocity_sl_mps')).toBeCloseTo(P('raptor3_isp_sl_used_s') * G0, 0);
    expect(0.5 * P('liftoff_thrust_b3_MN') * 1e6 * P('raptor_exhaust_velocity_sl_mps') / 1e9).toBeCloseTo(P('jet_mechanical_power_GW'), 0);
    expect(P('mdot_ch4_total_kgps') * 50e6 / 1e9).toBeCloseTo(P('chemical_power_GW'), 0);
  });

  it('stoichiometry: 4.0 is the perfect ratio, and the water and CO2 upper bounds follow from the oxygen flow', () => {
    expect(64 / 16).toBe(4);
    expect(P('raptor_of_ratio')).toBeLessThan(4);
    const o2 = P('mdot_lox_total_kgps') / 1000;
    expect(o2 * 36 / 64).toBeCloseTo(P('combustion_h2o_tps'), 0);
    expect(o2 * 44 / 64).toBeCloseTo(P('combustion_co2_tps'), 0);
  });

  it('exit pressure, Mach and temperature follow from the isentropic relations for the assumed chamber state', () => {
    const iso = isentropicExit(P('raptor_nozzle_expansion_ratio'), 1.2);
    expect(iso.mach).toBeCloseTo(P('raptor_exit_mach'), 1);
    expect(iso.pRatio * P('raptor3_chamber_pressure_bar')).toBeCloseTo(P('raptor_exit_pressure_bar'), 1);
    expect(iso.tRatio * P('raptor_chamber_temperature_K')).toBeGreaterThan(P('raptor_exit_static_temperature_K') * 0.95);
    expect(iso.tRatio * P('raptor_chamber_temperature_K')).toBeLessThan(P('raptor_exit_static_temperature_K') * 1.1);
    // sea-level ambient is above the exit pressure (overexpanded), and the crossover is a couple of km up
    expect(P('raptor_exit_pressure_bar')).toBeLessThan(1.013);
    expect(pressureMatchAltitude()).toBeGreaterThan(1000);
    expect(pressureMatchAltitude()).toBeLessThan(3000);
  });

  it('vacuum gain, thrust gain at the frozen height and the exhaust speed vs the speed of sound are quoted right', () => {
    expect(vacuumGainPct()).toBeCloseTo((P('vac_thrust_booster_MN') / P('liftoff_thrust_b3_MN') - 1) * 100, 0);
    expect(vacuumGainPct()).toBeGreaterThan(4);
    expect(vacuumGainPct()).toBeLessThan(6.5);
    const s0 = defaultSim().series[0], s = defaultSim().stateAt(defaultSim().solveFreezeTime());
    expect((s.thrust / s0.thrust - 1) * 100).toBeCloseTo(P('thrust_gain_150m_pct'), 1);
    expect(P('raptor_exhaust_velocity_sl_mps') / speedOfSound()).toBeGreaterThan(8);
    expect(P('raptor_exhaust_velocity_sl_mps') / speedOfSound()).toBeLessThan(11);
  });

  it('the model max-Q matches the spec note, and the stated event times are ordered', () => {
    const q = peakDynamicPressure();
    expect(Math.abs(q.kPa - P('max_q_model_kPa'))).toBeLessThan(2.5);
    expect(P('max_q_time_f14_s')).toBeLessThan(P('meco_time_f14_s'));
    expect(P('meco_time_f14_s')).toBeLessThanOrEqual(P('hot_staging_time_f14_s'));
    expect(P('hot_staging_time_f14_s') - P('meco_time_f14_s')).toBeLessThan(10);
  });

  it('rocket equation: the end mass is the liftoff mass minus the burn, and a propellant reserve remains', () => {
    const m1 = massAtCutoffT();
    expect(m1).toBeCloseTo(P('liftoff_mass_used_t') - P('mdot_booster_total_kgps') / 1000 * P('meco_time_f14_s'), 0);
    expect(massAtMecoT()).toBe(m1);
    expect(boosterReserveT()).toBeGreaterThan(50);
    expect(boosterReserveT()).toBeLessThan(400);
    const dv = idealDeltaV(exhaustVelocity(), P('liftoff_mass_used_t') * 1000, m1 * 1000) / 1000;
    expect(dv).toBeGreaterThan(P('meco_speed_est_mps') / 1000); // losses make the real speed lower than the ideal one
    expect(dv).toBeLessThan(4);
  });

  it('water and steam: the volume, mass and vaporisation energy agree', () => {
    expect(P('deluge_water_pad1_gal') * 3.78541 / 1000).toBeCloseTo(P('deluge_water_pad1_kg') / 1000, -1);
    expect(Math.abs(P('deluge_water_pad1_kg') * P('deluge_vaporised_fraction') * 2.6e6 / P('deluge_vaporisation_energy_J') - 1)).toBeLessThan(0.01);
    expect(P('deluge_pad2_test_flow_gpm') * 3.78541e-3 / 60).toBeCloseTo(P('deluge_pad2_test_flow_m3ps'), 0);
  });

  it('acoustics: the sound power level, the front radius and the free-field levels agree with their inputs', () => {
    const lw = 10 * Math.log10(P('acoustic_eff_central') * P('jet_mechanical_power_GW') * 1e9 / 1e-12);
    expect(lw).toBeCloseTo(P('sound_power_level_dB'), 0);
    expect(P('sound_power_level_dB') - 20 * Math.log10(100) - 8).toBeCloseTo(P('spl_100m_dB'), 0);
    expect(P('sound_power_level_dB') - 20 * Math.log10(1000) - 8).toBeCloseTo(P('spl_1km_dB'), 0);
    expect(Math.abs(soundFrontRadius(solveFreezeTime()) - P('sound_front_radius_at_photo_m'))).toBeLessThan(50);
    expect(P('acoustic_eff_central')).toBeGreaterThanOrEqual(0.002); // NASA SP-8072 range 0.2-0.8 %
    expect(P('acoustic_eff_central')).toBeLessThanOrEqual(0.008);
    expect(speedOfSound()).toBeCloseTo(P('sound_speed_25C_mps'), 0);
  });

  it('freeze time stays inside 7.0-7.8 s across the liftoff-mass range quoted in the Sources tab', () => {
    const lo = simulate({ m0: P('liftoff_mass_published_t') * 1000 }).solveFreezeTime();
    const hi = simulate({ m0: P('liftoff_mass_sum_of_parts_t') * 1000 }).solveFreezeTime();
    expect(lo).toBeGreaterThan(6.9);
    expect(hi).toBeLessThan(7.9);
    expect(lo).toBeLessThan(val('scene.t_freeze'));
    expect(hi).toBeGreaterThan(val('scene.t_freeze'));
  });
});

describe('fact-check: sun at the frozen photo (Sources tab claims)', () => {
  // NOAA low-precision solar position
  const rad = Math.PI / 180;
  function sun(ms: number, lat: number, lon: number): { alt: number; az: number } {
    const jd = ms / 86400000 + 2440587.5, T = (jd - 2451545) / 36525;
    const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360, M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
    const om = 125.04 - 1934.136 * T, app = L0 + C - 0.00569 - 0.00478 * Math.sin(om * rad);
    const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * rad);
    const dec = Math.asin(Math.sin(eps * rad) * Math.sin(app * rad)), y = Math.tan(eps * rad / 2) ** 2;
    const eqT = 4 / rad * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
    const d = new Date(ms), min = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
    const tst = (min + eqT + 4 * lon) % 1440, ha = (tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180) * rad, la = lat * rad;
    const cosz = Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha);
    return { alt: 90 - Math.acos(cosz) / rad, az: (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) / rad + 180) % 360 };
  }
  const lat = val('pad.origin_lat'), lon = val('pad.origin_lon');

  it('Flight 14 liftoff: sun altitude matches the spec and launch is about 30 minutes after sunrise', () => {
    const t0 = Date.parse(String(VALUES['physics.flight14_liftoff_utc'].v));
    expect(sun(t0, lat, lon).alt).toBeCloseTo(val('scene.sun_altitude'), 0);
    expect(sun(t0, lat, lon).az).toBeCloseTo(val('scene.sun_azimuth'), 0);
    let rise = t0;
    for (let ms = t0 - 3 * 3600e3; ms < t0; ms += 60e3) if (sun(ms, lat, lon).alt > -0.833) { rise = ms; break; }
    const minutes = (t0 - rise) / 60e3;
    expect(minutes).toBeGreaterThan(25);
    expect(minutes).toBeLessThan(33);
  });

  it('Flights 12 and 13 flew with the sun high in the west, not low in the east', () => {
    for (const k of ['physics.flight12_liftoff_utc', 'physics.flight13_liftoff_utc']) {
      const s = sun(Date.parse(String(VALUES[k].v)), lat, lon);
      expect(s.alt).toBeGreaterThan(25);
      expect(s.az).toBeGreaterThan(250);
    }
  });
});

describe('fact-check: provenance of every displayed number', () => {
  it('each key the UI shows is either sourced with a URL or an estimate with a real note', () => {
    const bad: string[] = [];
    for (const key of allUiKeys()) {
      const b = keyValue(key)!.badge;
      if (b.kind === 'src' && !/^https?:\/\//.test(b.url ?? '')) bad.push(`${key}: sourced but no URL`);
      if (b.kind === 'est' && b.text.trim().length < 25) bad.push(`${key}: estimate note too short (${b.text})`);
      if (b.kind === 'src' && /unverified|not fetched|recalled/i.test(b.text)) bad.push(`${key}: sourced but marked unverified`);
    }
    expect(bad).toEqual([]);
  });

  it('the prose does not repeat errors found in the fact-check (EN and FI)', () => {
    const all = [...Object.values(en), ...Object.values(fi)].join('\n');
    expect(all).not.toMatch(/5[.,]5 ?%/);                    // vacuum thrust gain is computed live, not hard-coded
    expect(all).not.toMatch(/sadan suuren voimalaitoksen|hundred large power/);
    expect(all).not.toMatch(/in the future, catches|tulevaisuudessa ottaa/);
    expect(all).not.toMatch(/35 minut/);                      // sunrise-to-launch is about 30 minutes
    expect(all).not.toMatch(/OH- ja CO-molekyylit|excited OH and CO/); // OH emits in the ultraviolet
    expect(all).not.toMatch(/vesihöyry ja hiilidioksidi hehkuvat|water vapour and carbon dioxide glow/);
  });
});
