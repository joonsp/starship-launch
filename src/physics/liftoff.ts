// Liftoff physics for the frozen Starship frame: a 1-D vertical-ascent point-mass model, RK4 at
// dt = 0.01 s from T-0 (release at full thrust), plus the acoustic and radiant-heat helpers the
// educational mode uses. OWNER: physics/edu module.
//
// PURE: no THREE, no DOM. Runs under Node (vitest) and in the browser. Every constant is read
// from specs/starship.json through src/specs.ts, so the numbers in the UI, the tests and the
// spec file can never disagree. Keys in research/edu-outline.md are the un-prefixed names from
// physics.spec.json; in the merged spec they live under `physics.<key>` (see PK()).
//
// Model (research/physics.md section 3):
//   state  = [y, v, m]   y = altitude of the ENGINE PLANE above ground (starts on the OLM deck, 20 m),
//                        v = vertical speed, m = total mass
//   F(h)   = mdot * Isp_SL * g0 + (p0 - p_a(h)) * A_e * throttle        (thrust grows as the air thins)
//   D      = 0.5 * rho(h) * v|v| * Cd(M) * S                            (S = pi * 4.5^2)
//   dv/dt  = (F - D)/m - g(h)        dm/dt = -mdot * throttle
// Vertical ascent only: the gravity-turn kick happens after T+10 s and moves altitude by well
// under 1 % at the times that matter here, so it is left out and stated in the UI.
//
// Throttle: full thrust to T+35 s, then the placeholder max-Q "bucket" from physics.md (linear
// to 70 % by T+50 s, then held at 70 %; the charts stop at T+60 s). It only shapes the right-hand
// part of the 0-60 s charts and is flagged as a placeholder in the UI (THROTTLE_BUCKET_START_S). It
// does not touch T_F. Because of it, and because there is no gravity turn, the model's dynamic-pressure
// peak (about 25 kPa near T+45 s) is only an order-of-magnitude guide; real max-Q was about T+60 s.
import { val, provenance } from '../specs.ts';

// ── constants ───────────────────────────────────────────────────────────────────────────────
export const G0 = 9.80665;                 // standard gravity, m/s2
export const R_EARTH = 6_371_000;          // m
export const P0 = 101_325;                 // sea-level pressure, Pa
export const RHO0 = 1.225;                 // sea-level density, kg/m3
export const H_PRESSURE = 8400;            // pressure scale height, m (physics.md)
export const H_DENSITY = 8500;             // density scale height, m
export const GAMMA_AIR = 1.4;
export const R_AIR = 287.05;
export const T_AIR_K = 298.15;             // local morning air, 25 C (sound speed 346 m/s)
export const CD_BASE = 0.8;                // blunt 9 m cylinder in axial flow (brief); transonic bump below
export const THROTTLE_BUCKET_START_S = 35; // placeholder max-Q throttle-down starts here (est)
export const SERIES_END_S = 60;            // the charts run 0..60 s
export const DT = 0.01;                    // RK4 step, s

/** Spec key for a physics.* entry: PK('liftoff_mass_used_t') -> 'physics.liftoff_mass_used_t'. */
export const PK = (name: string): string => `physics.${name}`;

/** Numeric physics spec value by its un-prefixed name (throws if missing). */
export const P = (name: string): number => val(PK(name));

// ── parameters ──────────────────────────────────────────────────────────────────────────────
export interface LiftoffParams {
  m0: number;            // liftoff mass, kg
  thrustSL: number;      // sea-level thrust, N (all 33 engines)
  ispSL: number;         // sea-level Isp, s
  nozzleAreaTotal: number; // sum of nozzle exit areas, m2
  cd: number;            // subsonic drag coefficient
  refArea: number;       // reference area, m2
  y0: number;            // starting engine-plane height (OLM deck), m
  throttleBucket: boolean;
  tEnd: number;          // last simulated time, s
}

/** Defaults from the merged spec. */
export function defaultParams(): LiftoffParams {
  const r = val('vehicle.common.diameter') / 2;
  return {
    m0: P('liftoff_mass_used_t') * 1000,
    thrustSL: P('liftoff_thrust_b3_MN') * 1e6,
    ispSL: P('raptor3_isp_sl_used_s'),
    nozzleAreaTotal: val('vehicle.booster.engine_count') * P('raptor_nozzle_exit_area_m2'),
    cd: CD_BASE,
    refArea: Math.PI * r * r,
    y0: val('scene.olm_deck_height'),
    throttleBucket: true,
    tEnd: SERIES_END_S,
  };
}

// ── atmosphere and gravity ──────────────────────────────────────────────────────────────────
export const ambientPressure = (h: number): number => P0 * Math.exp(-Math.max(h, 0) / H_PRESSURE);
export const airDensity = (h: number): number => RHO0 * Math.exp(-Math.max(h, 0) / H_DENSITY);
export const gravityAt = (h: number): number => G0 * (R_EARTH / (R_EARTH + Math.max(h, 0))) ** 2;
/** Speed of sound for the local air temperature (m/s). 346 m/s at 25 C. */
export const speedOfSound = (tempK = T_AIR_K): number => Math.sqrt(GAMMA_AIR * R_AIR * tempK);

/** Drag coefficient with a modest transonic bump (est, generic launch-vehicle behaviour). */
export function dragCoefficient(mach: number, cd = CD_BASE): number {
  const bump = Math.exp(-(((mach - 1.05) / 0.35) ** 2)) * 0.25; // peak +0.25 near Mach 1.05
  const supersonic = mach > 1.4 ? -0.1 * Math.min((mach - 1.4) / 1.0, 1) : 0;
  return cd + bump + supersonic;
}

/** Throttle setting (0..1) at flight time t. */
export function throttleAt(t: number, bucket = true): number {
  if (!bucket) return 1;
  const t0 = THROTTLE_BUCKET_START_S;
  if (t <= t0) return 1;
  if (t <= 50) return 1 - 0.3 * ((t - t0) / (50 - t0));
  return 0.7;
}

// ── the sample record ───────────────────────────────────────────────────────────────────────
export interface LiftoffSample {
  t: number;          // s after release (T+)
  altitude: number;   // engine plane above ground, m
  height: number;     // rise above the OLM deck, m
  velocity: number;   // m/s
  accel: number;      // net acceleration (F - D)/m - g, m/s2
  gLoad: number;      // proper acceleration (F - D)/(m g0), in g
  mass: number;       // kg
  thrust: number;     // N
  drag: number;       // N
  weight: number;     // N (m g(h))
  twr: number;        // T/W = F/(m g)
  burned: number;     // propellant burned since T-0, kg
  mdot: number;       // kg/s
  q: number;          // dynamic pressure, Pa
  mach: number;
  throttle: number;
}

export interface LiftoffSim {
  params: LiftoffParams;
  series: LiftoffSample[];        // every DT seconds from 0 to tEnd
  stateAt(t: number): LiftoffSample;
  /** t at which the engine plane reaches `height` m above ground (bisection, interpolated). */
  timeAtAltitude(height: number): number;
  /** t at which the engine plane reaches the spec's scene.vehicle_base_height (158 m). */
  solveFreezeTime(): number;
}

interface Deriv { dy: number; dv: number; dm: number }

/** Nominal mass flow at 100 % throttle (kg/s): F_SL / (Isp g0). */
export function nominalMdot(p: LiftoffParams): number {
  return p.thrustSL / (p.ispSL * G0);
}

function derivs(p: LiftoffParams, t: number, y: number, v: number, m: number): Deriv & { thrust: number; drag: number; mach: number; throttle: number } {
  const th = throttleAt(t, p.throttleBucket);
  const mdot = nominalMdot(p) * th;
  const thrust = th * (nominalMdot(p) * p.ispSL * G0 + (P0 - ambientPressure(y)) * p.nozzleAreaTotal);
  const mach = Math.abs(v) / speedOfSound();
  const drag = 0.5 * airDensity(y) * v * Math.abs(v) * dragCoefficient(mach, p.cd) * p.refArea;
  const a = (thrust - drag) / m - gravityAt(y);
  return { dy: v, dv: a, dm: -mdot, thrust, drag, mach, throttle: th };
}

function sampleOf(p: LiftoffParams, t: number, y: number, v: number, m: number): LiftoffSample {
  const d = derivs(p, t, y, v, m);
  const g = gravityAt(y);
  return {
    t, altitude: y, height: y - p.y0, velocity: v,
    accel: d.dv,
    gLoad: (d.thrust - d.drag) / (m * G0),
    mass: m, thrust: d.thrust, drag: d.drag, weight: m * g,
    twr: d.thrust / (m * g),
    burned: p.m0 - m, mdot: -d.dm,
    q: 0.5 * airDensity(y) * v * v, mach: d.mach, throttle: d.throttle,
  };
}

const lerpSample = (a: LiftoffSample, b: LiftoffSample, f: number): LiftoffSample => {
  const o = {} as Record<string, number>;
  for (const k of Object.keys(a) as (keyof LiftoffSample)[]) o[k] = a[k] + (b[k] - a[k]) * f;
  return o as unknown as LiftoffSample;
};

/** Integrate the ascent with RK4. Deterministic and cheap (6000 steps). */
export function simulate(overrides: Partial<LiftoffParams> = {}): LiftoffSim {
  const p: LiftoffParams = { ...defaultParams(), ...overrides };
  const n = Math.round(p.tEnd / DT);
  const series: LiftoffSample[] = [];
  let y = p.y0, v = 0, m = p.m0, t = 0;
  series.push(sampleOf(p, t, y, v, m));
  for (let i = 0; i < n; i++) {
    const k1 = derivs(p, t, y, v, m);
    const k2 = derivs(p, t + DT / 2, y + (DT / 2) * k1.dy, v + (DT / 2) * k1.dv, m + (DT / 2) * k1.dm);
    const k3 = derivs(p, t + DT / 2, y + (DT / 2) * k2.dy, v + (DT / 2) * k2.dv, m + (DT / 2) * k2.dm);
    const k4 = derivs(p, t + DT, y + DT * k3.dy, v + DT * k3.dv, m + DT * k3.dm);
    y += (DT / 6) * (k1.dy + 2 * k2.dy + 2 * k3.dy + k4.dy);
    v += (DT / 6) * (k1.dv + 2 * k2.dv + 2 * k3.dv + k4.dv);
    m += (DT / 6) * (k1.dm + 2 * k2.dm + 2 * k3.dm + k4.dm);
    t = (i + 1) * DT;
    series.push(sampleOf(p, t, y, v, m));
  }

  const stateAt = (tt: number): LiftoffSample => {
    const c = Math.min(Math.max(tt, 0), p.tEnd);
    const f = c / DT;
    const i = Math.min(Math.floor(f), series.length - 2);
    const s = lerpSample(series[i], series[i + 1], f - i);
    s.t = c;
    return s;
  };

  const timeAtAltitude = (h: number): number => {
    if (h <= series[0].altitude) return 0;
    let lo = 0, hi = series.length - 1;
    if (series[hi].altitude < h) return NaN;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (series[mid].altitude < h) lo = mid; else hi = mid;
    }
    const a = series[lo], b = series[hi];
    return a.t + ((h - a.altitude) / (b.altitude - a.altitude)) * DT;
  };

  return { params: p, series, stateAt, timeAtAltitude, solveFreezeTime: () => timeAtAltitude(val('scene.vehicle_base_height')) };
}

let cached: LiftoffSim | null = null;
/** The default simulation (spec numbers), computed once. */
export function defaultSim(): LiftoffSim {
  return (cached ??= simulate());
}

/** Convenience: T_F from the default model. */
export const solveFreezeTime = (): number => defaultSim().solveFreezeTime();
/** Convenience: default-model state at time t. */
export const stateAt = (t: number): LiftoffSample => defaultSim().stateAt(t);

// ── rocket-equation helpers ─────────────────────────────────────────────────────────────────
/** Tsiolkovsky ideal delta-v (m/s) for effective exhaust velocity ve and masses m0 -> m1. */
export const idealDeltaV = (ve: number, m0: number, m1: number): number => ve * Math.log(m0 / m1);
/** Effective exhaust velocity at sea level (m/s) = Isp g0 (3236 m/s for 330 s). */
export const exhaustVelocity = (isp = P('raptor3_isp_sl_used_s')): number => isp * G0;
/** Vacuum thrust of the booster (N): F_SL + p0 A_e (about 84.6 MN with 1.2 m nozzles). */
export const vacuumThrust = (p: LiftoffParams = defaultParams()): number => p.thrustSL + P0 * p.nozzleAreaTotal;
/** Vacuum thrust gain over sea level in percent (4.7 % here; the sourced Isp ratio 350/330 would suggest about 6 %). */
export const vacuumGainPct = (p: LiftoffParams = defaultParams()): number => (vacuumThrust(p) / p.thrustSL - 1) * 100;
/** Altitude (m) at which the ambient pressure falls to the nozzle exit pressure: above it the jet is underexpanded. */
export const pressureMatchAltitude = (exitBar: number = P('raptor_exit_pressure_bar')): number => -H_PRESSURE * Math.log((exitBar * 1e5) / P0);
/** Peak dynamic pressure of a simulated ascent: kPa and the time it happens (s). */
export function peakDynamicPressure(sim: LiftoffSim = defaultSim()): { kPa: number; t: number } {
  let best = sim.series[0];
  for (const s of sim.series) if (s.q > best.q) best = s;
  return { kPa: best.q / 1000, t: best.t };
}
/**
 * Mass (t) when the booster engines cut off, if the booster burned at the model's full-thrust flow
 * until `tCutoff` (s): liftoff mass minus flow x time. This keeps the rocket-equation numbers consistent
 * with the liftoff mass and flow used everywhere else (throttling would leave more propellant burned less).
 */
export const massAtCutoffT = (tCutoff: number = P('meco_time_f14_s'), m0T: number = P('liftoff_mass_used_t')): number =>
  m0T - (nominalMdot(defaultParams()) / 1000) * tCutoff;

// ── acoustics ───────────────────────────────────────────────────────────────────────────────
export const engineStartLead = (): number => P('engine_start_lead_s');

/** Sound-front radius (m) at flight time t: sound emitted at ignition (T - lead) has travelled c (t + lead). */
export function soundFrontRadius(t: number, c: number = P('sound_speed_25C_mps'), lead: number = engineStartLead()): number {
  return Math.max(0, c * (t + lead));
}

/** Flight time (T+, s) at which the sound emitted at flight time `emittedAt` reaches distance r. */
export function soundArrivalTime(r: number, emittedAt = 0, c: number = P('sound_speed_25C_mps')): number {
  return emittedAt + r / c;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const u = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return u * u * (3 - 2 * u);
};

/** Free-field SPL (dB re 20 uPa) from a ground source of sound power level Lw, hemispherical spreading. */
export function splFreeField(r: number, lw: number = P('sound_power_level_dB')): number {
  return Math.min(lw - 20 * Math.log10(Math.max(r, 1)) - 8, P('near_field_dB'));
}

/** The measured far-field curve through 105 dB at 10 km and 90 dB at 20 km (Gee et al.), continued as spherical spreading inside 10 km. */
export function splMeasuredCurve(r: number): number {
  const r1 = 10_000, l1 = P('spl_10km_measured_dB'), l2 = P('spl_20km_measured_dB'), r2 = 20_000;
  if (r <= r1) return l1 + 20 * Math.log10(r1 / Math.max(r, 1));
  const slope = (l2 - l1) / Math.log2(r2 / r1); // -15 dB per doubling
  return l1 + slope * Math.log2(r / r1);
}

/** Blend range (m): free-field below `lo`, the measured curve above `hi`. */
export const SPL_BLEND: readonly [number, number] = [1_000, 10_000];

/**
 * Estimated peak SPL (dB) at ground distance r from the pad: free-field near the pad, blended
 * toward the measured far-field points between 1 and 10 km (atmospheric absorption, terrain and
 * the deluge make real levels lower than spherical spreading). Strictly decreasing in r.
 */
export function splAt(r: number): number {
  const w = smoothstep(Math.log10(SPL_BLEND[0]), Math.log10(SPL_BLEND[1]), Math.log10(Math.max(r, 1)));
  return (1 - w) * splFreeField(r) + w * splMeasuredCurve(r);
}

export type SplBand = 'faint' | 'loud' | 'painful' | 'damaging' | 'extreme';
/** Coarse description of an SPL for the HUD. */
export function splBand(db: number): SplBand {
  if (db < 70) return 'faint';
  if (db < 100) return 'loud';
  if (db < 125) return 'painful';
  if (db < 150) return 'damaging';
  return 'extreme';
}

// ── radiant heat ────────────────────────────────────────────────────────────────────────────
/**
 * Estimated radiant heat flux (kW/m2) at distance r from the plume: inverse-square from the
 * 40 kW/m2 at 100 m estimate (which gives 0.4 kW/m2 at 1 km, less than the sun). Order of magnitude only.
 */
export function radiantFlux(r: number): number {
  const q100 = P('plume_radiant_flux_100m_kWm2');
  return q100 * (100 / Math.max(r, 50)) ** 2;
}

/** Sun's irradiance for comparison (kW/m2), rounded. */
export const SUN_KW_M2 = 1.0;

// ── centre of mass (for the weight vector) ──────────────────────────────────────────────────
export interface MassItem { id: string; mass_t: number; height_m: number; est: boolean }

/**
 * Coarse mass budget with centroid heights above the ENGINE PLANE (m). Tank heights come from the
 * spec; the centroids inside each tank and the dry-mass positions are estimates. Masses are scaled
 * to the used liftoff mass so the total equals physics.liftoff_mass_used_t.
 */
export function massBudget(): MassItem[] {
  const ofr = P('raptor_of_ratio');
  const boosterProp = P('booster_prop_mass_b3_t');
  const shipProp = P('ship_prop_mass_b3_t');
  const bLox = boosterProp * ofr / (1 + ofr), bCh4 = boosterProp - bLox;
  const sLox = shipProp * ofr / (1 + ofr), sCh4 = shipProp - sLox;
  const L = val('vehicle.booster.length');
  const b = { loxLo: val('vehicle.booster.lox_tank_bottom_height'), dome: val('vehicle.booster.common_dome_height'), ch4Hi: val('vehicle.booster.ch4_tank_top_height') };
  const s = { loxLo: val('vehicle.ship.lox_tank_bottom_height'), dome: val('vehicle.ship.common_dome_height'), ch4Hi: val('vehicle.ship.ch4_tank_top_height') };
  const items: MassItem[] = [
    { id: 'booster_dry', mass_t: P('booster_dry_mass_b3_t'), height_m: 0.35 * L, est: true },       // engines and thrust plate are low
    { id: 'booster_lox', mass_t: bLox, height_m: b.loxLo + 0.45 * (b.dome - b.loxLo), est: true },   // propellant settles low in the tank
    { id: 'booster_ch4', mass_t: bCh4, height_m: b.dome + 0.5 * (b.ch4Hi - b.dome), est: true },
    { id: 'ship_dry', mass_t: P('ship_dry_mass_b3_t'), height_m: L + 0.45 * val('vehicle.ship.length'), est: true },
    { id: 'ship_lox', mass_t: sLox, height_m: L + s.loxLo + 0.45 * (s.dome - s.loxLo), est: true },
    { id: 'ship_ch4', mass_t: sCh4, height_m: L + s.dome + 0.5 * (s.ch4Hi - s.dome), est: true },
    { id: 'payload', mass_t: P('payload_mass_f14_t'), height_m: L + 42, est: true },
  ];
  const total = items.reduce((a, i) => a + i.mass_t, 0);
  const k = P('liftoff_mass_used_t') / total;
  return items.map((i) => ({ ...i, mass_t: i.mass_t * k }));
}

/** Centre-of-mass height above the engine plane at T-0 (m). About 60 m: the heavy propellant is low but the ship sits on top. */
export function centreOfMassHeight(): number {
  const items = massBudget();
  const M = items.reduce((a, i) => a + i.mass_t, 0);
  return items.reduce((a, i) => a + i.mass_t * i.height_m, 0) / M;
}

/** Provenance for a physics key (for the badges). */
export const physicsProvenance = (name: string) => provenance(PK(name));
