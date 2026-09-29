// Physically derived constants for the rocket plume (33 Raptor 3 sea-level jets merging into one
// column). OWNER: plume module. Every number is taken from specs/starship.json or engine-layout.ts,
// or derived here with the formula next to it, so the shader has no hard-coded magic geometry.
//
// Plume LOCAL frame (used by the shader and by PlumeModule):
//   origin = anchors.vehicleBase (centre of the booster engine plane), local -y points along the
//   plume axis toward anchors.plumeImpact, local x/z = the vehicle frame of engine-layout.ts
//   (rotated by anchors.vehicleYawDeg about the axis, exactly like the vehicle GLB).
//   s = distance below the nozzle-exit plane = -y - NOZZLE_EXIT_BELOW_PLANE (metres).
import * as THREE from 'three';
import type { QualityId } from '../../contracts.ts';
import { val } from '../../specs.ts';
import { boosterEngines, NOZZLE_EXIT_D, NOZZLE_EXIT_BELOW_PLANE } from '../../core/engine-layout.ts';

const DEG = Math.PI / 180;

// ── Jet gas dynamics ────────────────────────────────────────────────────────
/** Nozzle exit Mach number (isentropic, expansion ratio 34, gamma 1.2; spec physics.raptor_exit_mach). */
export const EXIT_MACH = val('physics.raptor_exit_mach');
/** Sea-level nozzle exit diameter (m). */
export const EXIT_D = NOZZLE_EXIT_D;
/** How far the nozzle exits hang below the engine plane (m). */
export const EXIT_DROP = NOZZLE_EXIT_BELOW_PLANE;
/**
 * Shock-cell (Mach-diamond) spacing, Prandtl-Pierce style correlation
 * L_s ≈ 1.3 · D_e · sqrt(M_e² − 1)   (research/rendering.md §3.1)  → ≈ 6.2 m ≈ 5.2 D_e.
 */
export const SHOCK_CELL_LENGTH = 1.3 * EXIT_D * Math.sqrt(EXIT_MACH * EXIT_MACH - 1);
/** Exit pressure / ambient (0.77 bar / 1.013 bar): < 1, i.e. slightly OVER-expanded at sea level. */
export const EXIT_PRESSURE_RATIO = val('physics.raptor_exit_pressure_bar') / 1.01325;
/**
 * Boundary "necking" amplitude of an over-expanded jet: the jet contracts after the lip until the
 * pressure matches, then breathes with the shock cells. Scaled with the pressure mismatch
 * (1 − p_e/p_a ≈ 0.24 → ≈ 6 %); est, visual only.
 */
export const JET_NECK = 0.25 * (1 - EXIT_PRESSURE_RATIO);
/**
 * Visual spreading rate of each jet's mixing layer (dR/ds). Compressible (M ≈ 4) shear layers grow
 * 3-5x slower than the incompressible ~0.1; with 1.24-1.54 m nozzle pitch this merges the jets'
 * envelopes within ~10 m and their bright cores within ~15-20 m (est, matches Super Heavy footage).
 */
export const JET_SPREAD = 0.05;
/** e-folding length of each jet's bright supersonic core (m, est: ~9 exit diameters in a cluster). */
export const JET_CORE_LENGTH = 11;
/** Near field (individual jets) is evaluated for s < NEAR_FIELD_END (m). */
export const NEAR_FIELD_END = 26;

// ── Merged column (far field) ───────────────────────────────────────────────
/**
 * Bright-core radius of the merged column at the nozzle plane (m) and its growth rate. Photo
 * (research/reference.jpeg scaled to 720p, 0.82 m/px at the rocket): the saturated column is
 * 13 px ≈ 11 m wide just below the engines and stays 11-14 px down to the fireball, i.e. nearly
 * cylindrical: the supersonic core of a hot M≈4 cluster jet barely spreads before it hits the
 * deflector (the entrainment growth shows up in the dimmer afterburning skin instead).
 */
export const COLUMN_R0 = 5.6;
export const COLUMN_SPREAD = 0.004;

// ── Bounding proxy (analytic frustum; the mesh is a slightly larger polygonal version) ─────────
export const BOUND_TOP_R = 8.0;       // at local y = 0 (engine plane)
export const BOUND_SPREAD = 0.03;     // dR/ds of the bound (covers the skin, warp and ground flare: ~10.5 m at the base)

// ── Emission colours (linear, chromaticities; the intensities live in the shader uniforms) ─────
/** Port of sl_blackbody() in src/shaders/common.glsl (Tanner Helland fit, linear, max = 1). */
export function blackbody(kelvin: number, out = new THREE.Color()): THREE.Color {
  const T = Math.min(Math.max(kelvin, 1000), 40000) / 100;
  const cl = (x: number) => Math.min(Math.max(x, 0), 1);
  const r = T <= 66 ? 1 : cl(1.29293618606 * Math.pow(T - 60, -0.1332047592));
  const g = T <= 66 ? cl(0.39008157876 * Math.log(T) - 0.63184144378) : cl(1.12989086089 * Math.pow(T - 60, -0.0755148492));
  const b = T >= 66 ? 1 : T <= 19 ? 0 : cl(0.54320678911 * Math.log(T - 10) - 1.19625408914);
  const c = [r, g, b].map((x) => Math.pow(x, 2.2));
  const m = Math.max(c[0], c[1], c[2], 1e-4);
  return out.setRGB(c[0] / m, c[1] / m, c[2] / m);
}

/**
 * Chromaticities. A sootless methalox flame radiates mostly as chemiluminescence (CH* 431 nm violet,
 * C2* Swan bands green-blue) plus hot H2O/CO2 bands (red/IR). A clipping camera sensor renders
 * that mix as violet-pink-white (photo #f5e4e7). The fuel-rich exhaust (O/F 3.6 < 4) afterburns
 * orange where CO/H2 meet air in the mixing layer (~1900-2600 K, photo #f5960e).
 * Saturated on purpose: AgX desaturates highlights, so the column centre (radiance 20-60) clips to
 * white and the hue survives only at the edges and in the bloom halo, exactly as in the photo.
 */
export const COLOURS = {
  /** chemiluminescent core, violet-pink */
  chemi: new THREE.Color(1.0, 0.3, 0.6),
  /** hottest core / shock-heated gas, warm pink-white */
  hot: new THREE.Color(1.0, 0.58, 0.55),
  /** near-field translucent jet envelope: CH* / C2* violet-blue (Raptor static-fire look) */
  envelope: new THREE.Color(0.62, 0.36, 1.0),
  /** Mach-diamond glow (shock-compressed, hotter → warm white) */
  diamond: new THREE.Color(1.0, 0.82, 0.6),
  /** afterburning mixing layer, hot and cool ends */
  sheathHot: blackbody(2600),
  sheathCool: blackbody(1900),
  /** stagnation / ground-impingement brightening (photo #fbf7a3 → #f7e693) */
  base: new THREE.Color(1.0, 0.72, 0.3),
};

/** Temperatures for the Thermal view (kelvin). Task range 2500-3500 K. */
export const KELVIN = { sheath: 2500, core: 3400, diamond: 3500 };

/**
 * Plume-as-light colour: the emission-weighted mix of the pink-white column and the orange
 * afterburning/impingement glow (normalised, max component 1). Matches the tower's plume-lit
 * steel in the photo (#ea9d6d on red paint).
 */
export const LIGHT_COLOUR = blackbody(2700).lerp(new THREE.Color(1.0, 0.62, 0.72), 0.15);
/**
 * Plume light intensity (the hook multiplies by along·1e4/(d²+36)). At the tower's plume-facing
 * south face (~21 m from the axis) this gives irradiance ≈ 5-6, about 1.5-2x the 5.7° sun on a
 * sun-facing surface: the photo's tower reads orange-lit on its plume side. (Physically the
 * plume's radiant flux there is far larger, ~40 kW/m² at 100 m per physics.md; the camera's
 * exposure hides that, so this is tuned to the photo, not to the flux.)
 */
export const LIGHT_INTENSITY = 0.28;

// ── Engine rings for the shader (from engine-layout.ts, never duplicated by hand) ──────────────
export interface RingUniform { radius: number; count: number; offset: number } // offset in radians
export interface EngineRings { centre: THREE.Vector2[]; mid: RingUniform; outer: RingUniform }

/** Engine rings in the plume local frame (x, z). Angles as in engine-layout: from +x toward −z. */
export function engineRings(): EngineRings {
  const slots = boosterEngines();
  const centre = slots.filter((e) => e.ring === 'centre').map((e) => new THREE.Vector2(e.x, e.z));
  const ring = (id: 'mid' | 'outer'): RingUniform => {
    const r = slots.filter((e) => e.ring === id);
    return { radius: Math.hypot(r[0].x, r[0].z), count: r.length, offset: r[0].angleDeg * DEG };
  };
  return { centre, mid: ring('mid'), outer: ring('outer') };
}

// ── Quality ─────────────────────────────────────────────────────────────────
export interface PlumeQuality {
  /** plume target resolution relative to the drawing buffer */
  scale: number;
  /** max raymarch steps in the far-field column segment (near field gets 0.75x) */
  steps: number;
}

/** Full resolution on high/ultra (the photo shot is judged on a ~14-20 px wide column). */
export const PLUME_QUALITY: Record<QualityId, PlumeQuality> = {
  low: { scale: 0.5, steps: 20 },
  medium: { scale: 0.75, steps: 28 },
  high: { scale: 1.0, steps: 40 },
  ultra: { scale: 1.0, steps: 64 },
};
