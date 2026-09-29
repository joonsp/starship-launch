// Template variables for the educational text: every {name} in content.en.ts / content.fi.ts is
// filled from here, LIVE from the spec and the liftoff model, and formatted with fmt() so Finnish
// gets decimal commas. Nothing in the prose is a hard-coded number.
import { val, raw_ } from '../specs.ts';
import { fmt } from '../i18n.ts';
import {
  P, defaultSim, G0, idealDeltaV, exhaustVelocity, soundFrontRadius, splFreeField, splAt, radiantFlux, vacuumThrust,
  centreOfMassHeight, simulate, THROTTLE_BUCKET_START_S, vacuumGainPct, pressureMatchAltitude, massAtCutoffT,
} from '../physics/liftoff.ts';

/**
 * Mass at MECO used by the Tsiolkovsky explainer (t): the liftoff mass minus the propellant burned at the
 * model's full-thrust flow until the cut-off time. (The old parts-sum version mixed a 5,400 t start mass with
 * dry masses that add up to 5,700 t.)
 */
export function massAtMecoT(): number {
  return massAtCutoffT();
}

/** Booster propellant left at MECO (t), from the same full-flow burn: the reserve for boostback and landing. */
export function boosterReserveT(): number {
  return P('booster_prop_mass_b3_t') - (P('mdot_booster_total_kgps') / 1000) * P('meco_time_f14_s');
}

const obj = (k: string) => raw_(k) as Record<string, number>;
const arr = (k: string) => raw_(k) as number[];

/** All template variables as formatted strings for the current language. */
export function templateVars(): Record<string, string> {
  const sim = defaultSim();
  const tf = sim.solveFreezeTime();
  const s = sim.stateAt(tf);
  const s0 = sim.series[0];
  const towerH = val('pad.tower2_height');
  const tTower = sim.timeAtAltitude(towerH);
  const f = (n: number, dgt = 0) => fmt(n, dgt);
  const aftFlap = arr('vehicle.ship.aft_flap.size'), fwdFlap = arr('vehicle.ship.forward_flap.size');
  const lox = obj('pad.tank_horizontal_lox_ln2'), ch4l = obj('pad.tank_horizontal_ch4_large'), ch4s = obj('pad.tank_horizontal_ch4_small');
  const water = obj('pad.tank_water_deluge');
  const tankEnd = raw_('pad.tank_farm_pad2_end_centre') as number[];
  const trench = arr('pad.flame_trench_pad2_size');
  const olm = arr('pad.olm_footprint_pad2');
  const m1 = massAtMecoT();
  const dvIdeal = idealDeltaV(exhaustVelocity(), P('liftoff_mass_used_t') * 1000, m1 * 1000);
  const chemW = P('chemical_power_GW') * 1e9;
  const mLight = Math.min(P('liftoff_mass_published_t'), P('liftoff_mass_sum_of_parts_t')), mHeavy = Math.max(P('liftoff_mass_published_t'), P('liftoff_mass_sum_of_parts_t'));
  return {
    // vehicle
    h_booster: f(P('booster_height_m'), 1), h_stack: f(P('stack_height_m'), 1), h_ship: f(P('ship_height_m'), 1), dia: f(P('diameter_m')),
    n_eng: f(P('booster_engines')), n_ship_eng: f(P('ship_engines')),
    prop_b: f(P('booster_prop_mass_b3_t')), prop_s: f(P('ship_prop_mass_b3_t')), dry_b: f(P('booster_dry_mass_b3_t')),
    dry_s: f(P('ship_dry_mass_b3_t')), payload: f(P('payload_mass_f14_t')),
    m0: f(P('liftoff_mass_used_t')), m0_pub: f(P('liftoff_mass_published_t')), m0_sum: f(P('liftoff_mass_sum_of_parts_t')),
    m_meco: f(m1), reserve: f(boosterReserveT()),
    // engines and thrust
    mdot: f(P('mdot_booster_total_kgps') / 1000, 1), mdot_lox: f(P('mdot_lox_total_kgps') / 1000, 1), mdot_ch4: f(P('mdot_ch4_total_kgps') / 1000, 1),
    burn_s: f(P('booster_full_thrust_burn_time_s')),
    thrust: f(P('liftoff_thrust_b3_MN'), 1), thrust_Mlbf: f(P('liftoff_thrust_b3_Mlbf'), 1), thrust_vac: f(vacuumThrust() / 1e6, 1),
    raptor_tf: f(P('raptor3_thrust_sl_tf')), raptor_tf_alt: f(P('raptor3_thrust_sl_alt_tf')),
    pc: f(P('raptor3_chamber_pressure_bar')), pc_alt: f(P('raptor3_chamber_pressure_alt_bar')),
    ve: f(P('raptor_exhaust_velocity_sl_mps')), ve_km: f(P('raptor_exhaust_velocity_sl_mps') / 1000, 1),
    isp: f(P('raptor3_isp_sl_used_s')), isp_vac: f(P('raptor3_isp_vac_s')), gain150: f(P('thrust_gain_150m_pct'), 2),
    of: f(P('raptor_of_ratio'), 1), t_chamber: f(P('raptor_chamber_temperature_K')), t_exit: f(P('raptor_exit_static_temperature_K')),
    exit_p: f(P('raptor_exit_pressure_bar'), 2), exit_mach: f(P('raptor_exit_mach'), 1), eps: f(P('raptor_nozzle_expansion_ratio'), 1),
    d_exit: f(P('raptor_nozzle_exit_diameter_m'), 1), engine_mass: f(P('raptor3_engine_mass_kg')),
    // liftoff model (frozen instant)
    tf: f(tf, 1), tf2: f(tf, 2), alt_tf: f(s.altitude), rise_tf: f(s.height), v_tf: f(s.velocity), v_tf_kmh: f(s.velocity * 3.6),
    a_tf: f(s.accel, 1), g_net_tf: f(s.accel / G0, 2), g_tf: f(s.gLoad, 2), tw_tf: f(s.twr, 2), m_tf: f(s.mass / 1000), burned_tf: f(s.burned / 1000),
    thrust_tf: f(s.thrust / 1e6, 1), weight_tf: f(s.weight / 1e6, 1), net_tf: f((s.thrust - s.drag - s.weight) / 1e6, 1),
    tw0: f(s0.twr, 2), w0: f(s0.weight / 1e6, 1), a0: f(s0.accel, 1), g_net0: f(s0.accel / G0, 2), g0_load: f(s0.gLoad, 2),
    t_tower: f(tTower, 1), tower_h: f(towerH, 1), olm_h: f(val('scene.olm_deck_height')),
    com_h: f(centreOfMassHeight()), drag_kn_tf: f(s.drag / 1000),
    t_maxq: f(P('max_q_time_f14_s')), t_meco: f(P('meco_time_f14_s')), t_stage: f(P('hot_staging_time_f14_s')),
    maxq_kpa: f(P('max_q_model_kPa')), meco_alt: f(P('meco_alt_est_km')), meco_speed: f(P('meco_speed_est_mps')),
    dv_ideal: f(dvIdeal / 1000, 2), dv_meco: f(P('meco_speed_est_mps') / 1000, 1), mass_ratio: f(P('liftoff_mass_used_t') / m1, 1),
    // model extras
    gain_tf: f((s.thrust / s0.thrust - 1) * 100, 2), gain_vac: f(vacuumGainPct(), 1), match_km: f(pressureMatchAltitude() / 1000, 1),
    tf_light: f(simulate({ m0: mLight * 1000 }).solveFreezeTime(), 1), tf_heavy: f(simulate({ m0: mHeavy * 1000 }).solveFreezeTime(), 1),
    thrust_report_Mlbf: f(P('liftoff_thrust_f14_report_Mlbf')), prop_total: f(P('booster_prop_mass_b3_t') + P('ship_prop_mass_b3_t')),
    tile_c: f(val('vehicle.ship.tile.rated_temp')),
    // steam and water
    water_gal: f(P('deluge_water_pad1_gal')), water_t: f(P('deluge_water_pad1_kg') / 1000), steam_t: f(P('deluge_water_pad1_kg') * P('deluge_vaporised_fraction') / 1000), water_ml: f(P('deluge_water_pad1_kg') / 1e6, 1),
    vap_pct: f(P('deluge_vaporised_fraction') * 100), h2o_tps: f(P('combustion_h2o_tps')), co2_tps: f(P('combustion_co2_tps'), 1),
    vap_tj: f(P('deluge_vaporisation_energy_J') / 1e12, 1), vap_s: f(P('deluge_vaporisation_energy_J') / chemW),
    chem_gw: f(P('chemical_power_GW')), jet_gw: f(P('jet_mechanical_power_GW')),
    flow_gpm: f(P('deluge_pad2_test_flow_gpm')), flow_m3: f(P('deluge_pad2_test_flow_m3ps')), table_t: f(P('launch_table_mass_pad1_t')),
    // sound and heat
    c: f(P('sound_speed_25C_mps')), r_tf_km: f(soundFrontRadius(tf) / 1000, 1), r_tf_m: f(soundFrontRadius(tf)),
    lead: f(P('engine_start_lead_s')), lw: f(P('sound_power_level_dB')), eff_pct: f(P('acoustic_eff_central') * 100, 1),
    spl100: f(P('spl_100m_dB')), spl10k: f(P('spl_10km_measured_dB')), spl20k: f(P('spl_20km_measured_dB')), near_db: f(P('near_field_dB')),
    spl_free10k: f(splFreeField(10_000)), lmax134: f(P('faa_lmax_contour_dB')), spl_1km: f(splAt(1000)), spl_5km: f(splAt(5000)),
    q100: f(P('plume_radiant_flux_100m_kWm2')), q1k: f(P('plume_radiant_flux_1km_kWm2'), 1), q500: f(radiantFlux(500), 1),
    // hardware details
    fins: f(val('vehicle.booster.grid_fin.count')), fin_scale: f(val('vehicle.booster.grid_fin.scale_vs_v2'), 1), fin_span: f(val('vehicle.booster.grid_fin.span'), 1),
    vents: f(val('vehicle.booster.hot_stage_vent_count')), pins: f(val('vehicle.booster.catch_pin_count')), pin_h: f(val('vehicle.booster.catch_pin_height')),
    tiles: f(val('vehicle.ship.tile.count_windward')), tile_cm: f(val('vehicle.ship.tile.hex_size') * 100), gap_mm: f(val('vehicle.ship.tile.gap') * 1000),
    aft_w: f(aftFlap[0], 1), aft_h: f(aftFlap[1], 1), fwd_w: f(fwdFlap[0], 1), fwd_h: f(fwdFlap[1], 1),
    n_aft_flaps: f(val('vehicle.ship.aft_flap.count')), n_fwd_flaps: f(val('vehicle.ship.forward_flap.count')),
    frost_h: f(val('vehicle.photo.frost_boundary_height')), frost_pct: f(val('vehicle.booster.frost.lox_tank_fraction_of_height') * 100),
    carriage_h: f(val('pad.chopstick_carriage_height_in_photo')), span: f(val('pad.chopstick_open_span_photo')), arm: f(val('pad.chopstick_arm_length')),
    reach: f(val('pad.chopstick_reach_from_tower_face')), boom_h: f(val('pad.qd_arm_boom_height_in_photo')),
    tr_l: f(trench[0]), tr_w: f(trench[1]), tr_d: f(trench[2]), olm_w: f(olm[0]),
    lox_n: f(lox.count), lox_d: f(lox.diameter, 1), lox_l: f(lox.length, 1),
    ch4_n: f(ch4l.count + ch4s.count), ch4_d: f(ch4l.diameter, 1), ch4_l: f(ch4l.length, 1),
    water_n: f(water.count), water_d: f(water.diameter, 1), vap_n: f(val('pad.vaporizers')),
    tank_dist: f(Math.hypot(tankEnd[0], tankEnd[2])), coast: f(val('pad.coast_distance_east')),
    bucket: f(THROTTLE_BUCKET_START_S),
    // sun
    sun_alt: f(val('scene.sun_altitude'), 1),
  };
}

/** Explainer helper: T_F for arbitrary liftoff mass (t), used by the T/W slider. */
export function freezeTimeForMass(massT: number): { tf: number; aRelease: number; twr: number; vAt: number } {
  const sim = simulate({ m0: massT * 1000 });
  const tf = sim.solveFreezeTime();
  return { tf, aRelease: sim.series[0].accel, twr: sim.series[0].twr, vAt: sim.stateAt(tf).velocity };
}
