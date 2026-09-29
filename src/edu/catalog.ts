// What the educational mode knows about: hotspot cards (one per Hotspot id pushed by the scene
// modules) and explainers. Text lives in content.{en,fi}.ts under edu.hotspot.<id>.* and edu.ex.<id>.*;
// this file only says which spec keys each item shows, how far to fly the camera, and which diagram it uses.
import type { Hotspot } from '../contracts.ts';

export interface HotspotDef {
  id: string;
  category: Hotspot['category'];
  /** Spec keys shown as "key numbers" (short physics keys or full spec keys), read live. */
  keys: string[];
  /** Camera distance (m) when the "fly to" button is pressed. */
  fly: number;
}

export const HOTSPOT_DEFS: HotspotDef[] = [
  { id: 'booster', category: 'vehicle', fly: 150, keys: ['booster_height_m', 'diameter_m', 'booster_engines', 'booster_prop_mass_b3_t', 'mdot_booster_total_kgps'] },
  { id: 'ship', category: 'vehicle', fly: 110, keys: ['ship_engines', 'ship_prop_mass_b3_t', 'ship_height_m', 'payload_mass_f14_t'] },
  { id: 'raptors', category: 'vehicle', fly: 45, keys: ['raptor3_thrust_sl_tf', 'raptor3_chamber_pressure_bar', 'liftoff_thrust_b3_MN', 'booster_engines', 'raptor3_engine_mass_kg'] },
  { id: 'gridfins', category: 'vehicle', fly: 35, keys: ['vehicle.booster.grid_fin.count', 'vehicle.booster.grid_fin.scale_vs_v2', 'vehicle.booster.grid_fin.span', 'meco_time_f14_s'] },
  { id: 'hotstage', category: 'vehicle', fly: 45, keys: ['vehicle.booster.hot_stage_vent_count', 'max_q_time_f14_s', 'meco_time_f14_s', 'hot_staging_time_f14_s', 'meco_alt_est_km', 'meco_speed_est_mps'] },
  { id: 'flaps', category: 'vehicle', fly: 45, keys: ['vehicle.ship.aft_flap.count', 'vehicle.ship.forward_flap.count'] },
  { id: 'tiles', category: 'vehicle', fly: 40, keys: ['vehicle.ship.tile.count_windward', 'vehicle.ship.tile.hex_size', 'vehicle.ship.tile.gap'] },
  { id: 'frost', category: 'vehicle', fly: 70, keys: ['vehicle.photo.frost_boundary_height', 'vehicle.booster.frost.lox_tank_fraction_of_height', 'vehicle.booster.common_dome_height'] },
  { id: 'tower', category: 'pad', fly: 200, keys: ['pad.tower2_height', 'base_rise_to_tower_top_m', 't_base_at_tower_top_s', 'v_base_at_tower_top_mps'] },
  { id: 'chopsticks', category: 'pad', fly: 90, keys: ['pad.chopstick_carriage_height_in_photo', 'pad.chopstick_open_span_photo', 'pad.chopstick_arm_length', 'pad.chopstick_reach_from_tower_face', 'pad.qd_arm_boom_height_in_photo'] },
  { id: 'olm', category: 'pad', fly: 90, keys: ['olm_height_m', 'deluge_pad2_test_flow_gpm', 'deluge_pad2_test_flow_m3ps', 'launch_table_mass_pad1_t'] },
  { id: 'trench', category: 'pad', fly: 120, keys: ['olm_height_m', 'deluge_pad2_test_flow_m3ps'] },
  { id: 'tankfarm', category: 'pad', fly: 300, keys: ['pad.vaporizers', 'booster_prop_mass_b3_t', 'ship_prop_mass_b3_t'] },
  { id: 'plume', category: 'fx', fly: 160, keys: ['raptor_exhaust_velocity_sl_mps', 'raptor_chamber_temperature_K', 'raptor_exit_static_temperature_K', 'mdot_booster_total_kgps'] },
  { id: 'machdiamonds', category: 'fx', fly: 70, keys: ['raptor_exit_pressure_bar', 'raptor_exit_mach', 'raptor_nozzle_exit_diameter_m', 'raptor_nozzle_expansion_ratio'] },
  { id: 'steam', category: 'fx', fly: 450, keys: ['deluge_water_pad1_gal', 'deluge_vaporised_fraction', 'combustion_h2o_tps', 'combustion_co2_tps', 'deluge_vaporisation_energy_J', 'scene.sun_altitude'] },
  { id: 'fireball', category: 'fx', fly: 200, keys: ['raptor_of_ratio', 'raptor_chamber_temperature_K', 'chemical_power_GW'] },
  { id: 'soundfront', category: 'physics', fly: 6000, keys: ['sound_speed_25C_mps', 'engine_start_lead_s', 'sound_power_level_dB', 'spl_100m_dB', 'spl_10km_measured_dB', 'spl_20km_measured_dB', 'near_field_dB'] },
];

export type DiagramId =
  | 'forces' | 'thrust' | 'rocketeq' | 'steam' | 'diamonds' | 'colour' | 'sound' | 'staging' | 'catch' | 'frost' | 'heat' | 'fuel';

export interface ExplainerDef {
  id: string;
  diagram: DiagramId;
  keys: string[];
  /** The T/W explainer carries a liftoff-mass slider. */
  slider?: boolean;
}

export const EXPLAINER_DEFS: ExplainerDef[] = [
  { id: 'tw', diagram: 'forces', slider: true, keys: ['liftoff_mass_used_t', 'liftoff_thrust_b3_MN', 'liftoff_tw_central', 'liftoff_tw_range_low', 'liftoff_tw_range_high', 'a_net_at_tower_top_mps2', 't_base_at_tower_top_s', 'v_base_at_tower_top_mps'] },
  { id: 'isp', diagram: 'thrust', keys: ['raptor3_isp_sl_used_s', 'raptor3_isp_vac_s', 'mdot_booster_total_kgps', 'raptor_exhaust_velocity_sl_mps', 'vac_thrust_booster_MN', 'thrust_gain_150m_pct'] },
  { id: 'rocketeq', diagram: 'rocketeq', keys: ['raptor_exhaust_velocity_sl_mps', 'liftoff_mass_used_t', 'booster_dry_mass_b3_t', 'ship_dry_mass_b3_t', 'ship_prop_mass_b3_t', 'payload_mass_f14_t', 'meco_speed_est_mps'] },
  { id: 'steam', diagram: 'steam', keys: ['deluge_water_pad1_kg', 'deluge_vaporisation_energy_J', 'chemical_power_GW', 'combustion_h2o_tps', 'scene.sun_altitude'] },
  { id: 'diamonds', diagram: 'diamonds', keys: ['raptor_exit_pressure_bar', 'raptor_exit_mach', 'raptor_nozzle_expansion_ratio', 'raptor_nozzle_exit_diameter_m', 'raptor3_chamber_pressure_bar'] },
  { id: 'colour', diagram: 'colour', keys: ['raptor_of_ratio', 'raptor_chamber_temperature_K'] },
  { id: 'sound', diagram: 'sound', keys: ['sound_speed_25C_mps', 'engine_start_lead_s', 'sound_front_radius_at_photo_m', 'acoustic_eff_central', 'sound_power_level_dB', 'jet_mechanical_power_GW', 'spl_10km_measured_dB', 'spl_20km_measured_dB'] },
  { id: 'staging', diagram: 'staging', keys: ['max_q_time_f14_s', 'max_q_model_kPa', 'meco_time_f14_s', 'hot_staging_time_f14_s', 'meco_alt_est_km'] },
  { id: 'catch', diagram: 'catch', keys: ['vehicle.booster.catch_pin_count', 'vehicle.booster.catch_pin_height', 'pad.tower2_height', 'booster_dry_mass_b3_t'] },
  { id: 'frost', diagram: 'frost', keys: ['vehicle.photo.frost_boundary_height', 'vehicle.booster.frost.lox_tank_fraction_of_height'] },
  { id: 'heat', diagram: 'heat', keys: ['plume_radiant_flux_100m_kWm2', 'plume_radiant_flux_1km_kWm2', 'chemical_power_GW', 'jet_mechanical_power_GW'] },
  { id: 'fuel', diagram: 'fuel', keys: ['raptor_of_ratio', 'mdot_lox_total_kgps', 'mdot_ch4_total_kgps', 'booster_full_thrust_burn_time_s', 'meco_time_f14_s', 'booster_prop_mass_b3_t'] },
];

/** Spec keys shown in the "Moment" tiles (in addition to model output). */
export const TILE_KEYS = ['liftoff_mass_used_t', 'liftoff_thrust_b3_MN', 'raptor3_isp_sl_used_s', 'raptor_exhaust_velocity_sl_mps', 'mdot_booster_total_kgps', 'liftoff_tw_central', 'engine_start_lead_s', 'scene.t_freeze', 'scene.vehicle_base_height', 'scene.olm_deck_height'];

/** Every spec key referenced by the UI (for the Sources tab), in a stable order, deduplicated. */
export function allUiKeys(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (k: string) => { if (!seen.has(k)) { seen.add(k); out.push(k); } };
  TILE_KEYS.forEach(add);
  HOTSPOT_DEFS.forEach((h) => h.keys.forEach(add));
  EXPLAINER_DEFS.forEach((e) => e.keys.forEach(add));
  return out;
}

export const DEF_BY_ID: Record<string, HotspotDef> = Object.fromEntries(HOTSPOT_DEFS.map((h) => [h.id, h]));
