// Display rules for every spec value the educational mode shows: unit, digits, scale, and
// provenance badges. All numbers are read LIVE from specs/starship.json (src/specs.ts), never copied.
//
// A "key" is either a full spec key ('vehicle.ship.tile.count_windward') or an un-prefixed physics
// key from research/edu-outline.md ('raptor3_thrust_sl_tf' -> 'physics.raptor3_thrust_sl_tf').
import { VALUES, provenance } from '../specs.ts';
import { fmt } from '../i18n.ts';

export interface KeyDef {
  /** Display unit (SI-ish; may be a translated-neutral symbol). */
  unit: string;
  /** Decimal digits for fmt(). */
  digits: number;
  /** Multiplier applied to the spec value before display (e.g. 0.001 to show kg/s as t/s). */
  scale?: number;
  /** Set when the research found conflicting sources: the i18n key of the short note. */
  differs?: string;
}

const d = (unit: string, digits: number, scale?: number, differs?: string): KeyDef => ({ unit, digits, scale, differs });

/** Every key the UI may display. The Sources tab is the union of these that are referenced by content. */
export const KEY_DEFS: Record<string, KeyDef> = {
  // vehicle
  booster_height_m: d('m', 1), stack_height_m: d('m', 1), ship_height_m: d('m', 1), diameter_m: d('m', 0),
  booster_engines: d('', 0), ship_engines: d('', 0),
  booster_prop_mass_b3_t: d('t', 0), ship_prop_mass_b3_t: d('t', 0), booster_dry_mass_b3_t: d('t', 0),
  ship_dry_mass_b3_t: d('t', 0), payload_mass_f14_t: d('t', 0),
  liftoff_mass_used_t: d('t', 0, 1, 'edu.differs.mass'), liftoff_mass_published_t: d('t', 0), liftoff_mass_sum_of_parts_t: d('t', 0),
  // thrust and engines
  liftoff_thrust_b3_MN: d('MN', 1), liftoff_thrust_b3_Mlbf: d('Mlbf', 1),
  liftoff_tw_central: d('', 2), liftoff_tw_range_low: d('', 2), liftoff_tw_range_high: d('', 2),
  raptor3_thrust_sl_tf: d('tf', 0, 1, 'edu.differs.thrust'), raptor3_thrust_sl_alt_tf: d('tf', 0),
  raptor3_chamber_pressure_bar: d('bar', 0, 1, 'edu.differs.pc'), raptor3_chamber_pressure_alt_bar: d('bar', 0),
  raptor3_engine_mass_kg: d('kg', 0), raptor_of_ratio: d('', 1),
  raptor3_isp_sl_used_s: d('s', 0, 1, 'edu.differs.isp'), raptor3_isp_vac_s: d('s', 0),
  raptor_exhaust_velocity_sl_mps: d('m/s', 0), raptor_chamber_temperature_K: d('K', 0), raptor_exit_static_temperature_K: d('K', 0),
  raptor_exit_pressure_bar: d('bar', 2), raptor_exit_mach: d('Mach', 1), raptor_nozzle_exit_diameter_m: d('m', 1),
  raptor_nozzle_expansion_ratio: d('', 1),
  mdot_booster_total_kgps: d('t/s', 1, 0.001), mdot_lox_total_kgps: d('t/s', 1, 0.001), mdot_ch4_total_kgps: d('t/s', 1, 0.001),
  booster_full_thrust_burn_time_s: d('s', 0), jet_mechanical_power_GW: d('GW', 0), chemical_power_GW: d('GW', 0),
  vac_thrust_booster_MN: d('MN', 1), thrust_gain_150m_pct: d('%', 2), engine_start_lead_s: d('s', 0),
  // tower and timing
  tower_height_used_m: d('m', 0), olm_height_m: d('m', 0), base_rise_to_tower_top_m: d('m', 0),
  t_base_at_tower_top_s: d('s', 2), v_base_at_tower_top_mps: d('m/s', 0), a_net_at_tower_top_mps2: d('m/s²', 2),
  max_q_time_f14_s: d('s', 0), max_q_model_kPa: d('kPa', 0), meco_time_f14_s: d('s', 0), hot_staging_time_f14_s: d('s', 0),
  meco_alt_est_km: d('km', 0), meco_speed_est_mps: d('m/s', 0),
  // water, steam
  deluge_water_pad1_gal: d('US gal', 0), deluge_water_pad1_kg: d('t', 0, 0.001), deluge_vaporised_fraction: d('%', 0, 100),
  deluge_pad2_test_flow_gpm: d('US gal/min', 0), deluge_pad2_test_flow_m3ps: d('m³/s', 0),
  deluge_vaporisation_energy_J: d('TJ', 1, 1e-12), combustion_h2o_tps: d('t/s', 0), combustion_co2_tps: d('t/s', 1),
  launch_table_mass_pad1_t: d('t', 0),
  // sound and heat
  sound_speed_25C_mps: d('m/s', 0), sound_front_radius_at_photo_m: d('m', 0), acoustic_eff_central: d('%', 1, 100),
  sound_power_level_dB: d('dB', 0), spl_100m_dB: d('dB', 0), spl_1km_dB: d('dB', 0), spl_10km_measured_dB: d('dB', 0),
  spl_20km_measured_dB: d('dB', 0), near_field_dB: d('dB', 0), faa_lmax_contour_dB: d('dB', 0),
  plume_radiant_flux_100m_kWm2: d('kW/m²', 0), plume_radiant_flux_1km_kWm2: d('kW/m²', 1),
  // full-key entries
  'vehicle.ship.tile.count_windward': d('', 0), 'vehicle.ship.tile.hex_size': d('cm', 0, 100), 'vehicle.ship.tile.gap': d('mm', 0, 1000),
  'vehicle.booster.grid_fin.count': d('', 0), 'vehicle.booster.grid_fin.scale_vs_v2': d('×', 1), 'vehicle.booster.grid_fin.span': d('m', 1),
  'vehicle.booster.hot_stage_vent_count': d('', 0), 'vehicle.booster.catch_pin_count': d('', 0), 'vehicle.booster.catch_pin_height': d('m', 0),
  'vehicle.photo.frost_boundary_height': d('m', 0), 'vehicle.booster.frost.lox_tank_fraction_of_height': d('%', 0, 100),
  'vehicle.booster.common_dome_height': d('m', 0), 'vehicle.ship.aft_flap.count': d('', 0), 'vehicle.ship.forward_flap.count': d('', 0),
  'pad.tower2_height': d('m', 1), 'pad.chopstick_carriage_height_in_photo': d('m', 0), 'pad.chopstick_open_span_photo': d('m', 0),
  'pad.chopstick_arm_length': d('m', 0), 'pad.chopstick_reach_from_tower_face': d('m', 0), 'pad.qd_arm_boom_height_in_photo': d('m', 0),
  'pad.vaporizers': d('', 0), 'pad.coast_distance_east': d('m', 0),
  'scene.t_freeze': d('s', 1), 'scene.vehicle_base_height': d('m', 0), 'scene.olm_deck_height': d('m', 0),
  'scene.sun_altitude': d('°', 1),
};

/** Resolve a short or full key to the spec key. */
export function specKeyOf(key: string): string {
  return key.includes('.') ? key : `physics.${key}`;
}

const URL_RE = /https?:\/\/[^\s)]+/;

export interface Badge {
  /** 'src' = sourced (link), 'est' = estimate (note), 'model' = computed by the liftoff model from spec values. */
  kind: 'src' | 'est' | 'model';
  /** First URL of a sourced value, or the estimate reasoning / model note. */
  text: string;
  url?: string;
}

/** Provenance badge for a spec key. */
export function badgeOf(key: string): Badge {
  const p = provenance(specKeyOf(key));
  if (!p) return { kind: 'est', text: '' };
  if (p.kind === 'src') return { kind: 'src', text: p.text, url: p.text.match(URL_RE)?.[0].replace(/[.,;]+$/, '') };
  return { kind: 'est', text: p.text };
}

export interface KeyValue { value: number; text: string; unit: string; key: string; badge: Badge; differs?: string }

/** Live numeric value of a key formatted for display in the current language. */
export function keyValue(key: string): KeyValue | null {
  const sk = specKeyOf(key);
  const e = VALUES[sk];
  if (!e || typeof e.v !== 'number') return null;
  const def = KEY_DEFS[key] ?? d(e.unit ?? '', 1);
  const value = e.v * (def.scale ?? 1);
  return { value, text: fmt(value, def.digits), unit: def.unit, key, badge: badgeOf(key), differs: def.differs };
}

/** Host name of a URL for compact link text. */
export function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
}

/** Every key with a display definition (for tests and the Sources tab). */
export const ALL_KEYS: string[] = Object.keys(KEY_DEFS);
