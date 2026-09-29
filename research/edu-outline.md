# Educational content outline (educational mode, off by default)

Numeric keys refer to `research/physics.spec.json`. Values marked (est) there are estimates; the UI should show a small "estimate" badge on them. Card word counts are 60 to 120. Scene anchors use the project frame: origin = launch mount centre, x east, y up, z south. Finnish terms follow `glossary-fi.json`; titles below are draft Finnish (FI), to be checked against the glossary certainty column.

Timing framing for all cards: the frozen moment is about T+7 to 8 s (`photo_time_estimate_s`), with the booster base a few tens of metres above the tower top. If the flight identification lands on Flight 14 (Booster 21 / Ship 41, 2026-09-28 12:48:59 UTC), the cards can say so; otherwise leave the flight-specific sentences out.

## Hotspot cards (14)

**C1. Super Heavy booster** (FI: Super Heavy -ensimmäinen vaihe). Anchor: booster body.
Super Heavy is the first stage: 72.3 m tall and 9 m wide, built of stainless steel. At liftoff its 33 Raptor engines burn about 25 tonnes of propellant every second, and the tanks hold roughly 3,650 tonnes of liquid oxygen and liquid methane in Block 3. That is about two thirds of the whole stack's weight. The booster is designed to fly back and be caught by the tower, so its useful life is measured in flights, not launches. Even in this frozen instant, most of what you see is propellant tank.
Keys: booster_height_m, diameter_m, booster_engines, booster_prop_mass_b3_t, mdot_booster_total_kgps.

**C2. Ship (upper stage)** (FI: Starship-alus). Anchor: black-tipped top of the stack.
The black upper part is the Starship itself, the second stage, with six Raptor engines (three sea-level, three vacuum-optimised). Its front and sides are covered with heat-shield tiles so it can survive re-entry at orbital speed. In Block 3 the ship carries about 1,600 tonnes of propellant. On Flight 14 it carried 26 Starlink V3 satellites (est. about 44 tonnes). For now it is just a passenger, lifted by the booster below it.
Keys: ship_engines, ship_prop_mass_b3_t, ship_height_m, payload_mass_f14_t.

**C3. 33 Raptor engines** (FI: 33 Raptor-moottoria). Anchor: engine skirt.
Each Raptor 3 makes about 250 tonnes-force at sea level (some sources quote 280) from a chamber at 330 to 350 bar, more than 300 times atmospheric pressure. Methane and oxygen are burned in a full-flow staged-combustion cycle, so nothing is wasted through a separate exhaust. All 33 together give about 80.8 MN, about 18 million pounds-force, the strongest rocket ever flown. The engines mount as 20 fixed outer and 13 gimbaling inner ones, which steer the vehicle.
Keys: raptor3_thrust_sl_tf, raptor3_chamber_pressure_bar, liftoff_thrust_b3_MN, booster_engines, raptor3_engine_mass_kg.

**C4. The exhaust plume** (FI: Pakokaasusuihku). Anchor: pink column under the booster.
Behind each engine, a jet moves at about 3.2 km/s, roughly ten times the speed of sound in air. The combined plume here is about 100 m long. Methane burns cleanly with almost no soot, so the core glows faintly violet-pink rather than sooty orange, and looks like a brilliant fluorescent column against the pad. Its temperature at the nozzle exit is over 1,000 K after expanding from about 3,600 K in the chamber.
Keys: raptor_exhaust_velocity_sl_mps, raptor_chamber_temperature_K, raptor_exit_static_temperature_K, mdot_booster_total_kgps.

**C5. Mach diamonds** (FI: Iskuaaltokuvio, "Machin timantit"). Anchor: bright bands in the plume core.
Rocket exhaust leaves the nozzle at higher pressure or lower pressure than the surrounding air. Near sea level the Raptor jet is slightly overexpanded (exit pressure about 0.6 to 0.9 bar against 1.01 bar outside), so oblique shock waves form, bounce off the plume boundary as expansion fans, and repeat. Each repetition is a bright cell, called a Mach or shock diamond, where the gas is briefly compressed and hotter. They fade as the rocket climbs and the outside pressure drops.
Keys: raptor_exit_pressure_bar, raptor_exit_mach, raptor_nozzle_exit_diameter_m, raptor_nozzle_expansion_ratio.

**C6. The steam clouds** (FI: Höyrypilvet). Anchor: the two huge clouds either side of the pad.
Most of the giant clouds are not smoke: they are water. The pad sprays up to about 350,000 US gallons (1.3 million litres) of water onto the mount and flame deflector. Over 90 percent is flashed to steam, which condenses into droplets in the cool humid air. The exhaust itself adds less: only around 11 tonnes of water and 13 tonnes of CO2 per second from combustion. The orange colour is low morning sunlight (Flight 14 lifted off at 7:49 am CDT) plus glow from the plume.
Keys: deluge_water_pad1_gal, deluge_vaporised_fraction, combustion_h2o_tps, combustion_co2_tps, deluge_vaporisation_energy_J.

**C7. Flame deflector and mount** (FI: Liekinohjain ja laukaisualusta). Anchor: base of the tower area.
The rocket stands on a raised launch mount above a water-cooled steel plate and a flame trench. Pad 2 was designed after the damage from the first Starship launch, when concrete was blasted up to kilometres away. Water is released from several points, and sump pumps collect and reuse it. A July 2026 test reportedly flowed 650,000 gallons per minute. The mount itself is about 20 m tall (estimate), so at this instant the booster base is still level with the upper tower.
Keys: deluge_pad2_test_flow_gpm, deluge_pad2_test_flow_m3ps, olm_height_m, launch_table_mass_pad1_t.

**C8. The launch tower (Mechazilla)** (FI: Laukaisutorni). Anchor: red-orange tower.
The tower is about 145 m tall and carries two large arms ("chopsticks") that stack the rocket, and in the future catch it. The booster base is just clearing the tower top about 7 seconds after release, moving at only about 130 to 150 km/h. The tower survives the launch inside a pillar of noise and heat because the vehicle is climbing away from it and the flame trench turns the exhaust sideways.
Keys: tower_height_used_m, base_rise_to_tower_top_m, t_base_at_tower_top_s, v_base_at_tower_top_mps.

**C9. Grid fins** (FI: Ritilä-evät). Anchor: lattice panels near the top of the booster.
Near the top of the booster sit lattice-like panels that steer the booster on its way back down. They are folded and passive while the engines burn on the way up. Block 3 uses one fewer, larger set than V2 (each about 50 percent larger, per a V3 review), and the fins are also strong points the tower arms can catch. The booster returns without wings, using the fins and engine gimbals like a controllable falling rocket.
Keys: booster_height_m, meco_time_f14_s, hot_staging_time_f14_s.

**C10. Hot-staging ring** (FI: Aktiivinen vaiheiden irrotus). Anchor: junction between booster and ship.
Between the booster and ship sits a ventilated ring. About 2 minutes 20 seconds after liftoff the booster shuts down most engines, then the ship lights its own engines while the two are still joined, and they separate. The ship's exhaust blows through the ring's vents. It avoids a gap with no thrust and saves a separate interstage motor. Flight 14 staged at T+2:22 at roughly 55 to 70 km altitude (estimate).
Keys: max_q_time_f14_s, meco_time_f14_s, hot_staging_time_f14_s, meco_alt_est_km, meco_speed_est_mps.

**C11. Thrust and weight** (FI: Työntövoima ja paino). Anchor: engine skirt.
The rocket is roughly 5,400 tonnes at release (published 5,300, sum of parts 5,700), pushing with 80.8 MN. Weight is mass times g: about 53 MN. So thrust exceeds weight by only about 50 percent (T/W of about 1.5), and the net acceleration is only 5.7 m/s2, about 0.58 g. The people aboard a crewed version would feel 1.58 g, since g-force is thrust per unit mass. That is a gentle first few seconds for a machine this powerful.
Keys: liftoff_mass_used_t, liftoff_thrust_b3_MN, liftoff_tw_central, a_net_at_tower_top_mps2.

**C12. The sound front** (FI: Ääniaaltorintama). Anchor: a translucent sphere around the pad.
Sound travels at only about 346 m/s at 25 C, so the sound of ignition, emitted 3 seconds before release, is now about 3.8 km from the pad, expanding as a sphere. Inside it the noise is intense: about 160 dB at 100 m by a simple calculation, and near the plume approaching 200 dB. Farther out it was measured at about 105 dB at 10 km and 90 dB at 20 km on an earlier flight. You would see the rocket well before you heard anything.
Keys: sound_speed_25C_mps, sound_front_radius_at_photo_m, sound_power_level_dB, spl_100m_dB, spl_10km_measured_dB, spl_20km_measured_dB, near_field_dB.

**C13. Radiant heat** (FI: Lämpösäteily). Anchor: bright plume at pad level.
The plume is a thermal radiator as well as a jet. Order-of-magnitude estimates give about 40 kW/m2 at 100 m, enough to ignite paper, and only about 0.4 kW/m2 at 1 km, less than sunlight. This is why the pad is cleared for kilometres, and why viewers a few kilometres away feel warmth only as a brief glow. The energy source: about 271 GW of chemical power, roughly a hundred large power stations.
Keys: plume_radiant_flux_100m_kWm2, plume_radiant_flux_1km_kWm2, chemical_power_GW, jet_mechanical_power_GW.

**C14. Propellant: methane and oxygen** (FI: Ajoaineet: metaani ja happi). Anchor: tank section of booster.
Raptor burns liquid methane with liquid oxygen at a mass ratio of 3.6 to 1: fuel-rich compared with the perfect 4.0. Methane is cheap, can be made on Mars from CO2 and water, and burns clean. About 19.5 tonnes of oxygen and 5.4 tonnes of methane are consumed per second, so the 3,650 tonnes would last about 146 seconds at full thrust. Real MECO comes at T+140 s because the booster keeps a reserve for landing.
Keys: raptor_of_ratio, mdot_lox_total_kgps, mdot_ch4_total_kgps, booster_full_thrust_burn_time_s, meco_time_f14_s.

## "Physics of this moment" explainers (8)

**P1. Why T/W of 1.5 gives a slow start.** Net acceleration is (T - W)/m = g(T/W - 1) = 9.8 x 0.53 = 5.2 to 5.7 m/s2. Height after t seconds: s = 0.5 a t^2, so 125 m takes about 6.9 s and the speed is only about 37 m/s (133 km/h). Interactive: slider for liftoff mass (5,300 to 5,650 t) that moves the time to clear the tower (6.7 to 7.9 s). Keys: liftoff_tw_central, liftoff_tw_range_low, liftoff_tw_range_high, t_base_at_tower_top_s, v_base_at_tower_top_mps, a_net_at_tower_top_mps2.

**P2. Thrust from momentum, and Isp.** F = mdot x ve + (pe - pa) Ae. With mdot = 24,968 kg/s and ve = 3,236 m/s, F = 80.8 MN. Specific impulse Isp = ve/g0 = 330 s. At 150 m, thrust rises only 0.1 percent because ambient pressure is nearly unchanged. In vacuum it gains 5.5 percent (85 MN, Isp about 348 s). Keys: raptor3_isp_sl_used_s, raptor3_isp_vac_s, mdot_booster_total_kgps, vac_thrust_booster_MN, thrust_gain_150m_pct.

**P3. The Tsiolkovsky rocket equation.** dv = ve ln(m0/m1). With ve = 3.24 km/s and a mass ratio of 5,400/2,100 = 2.6, the ideal delta-v of the booster phase is about 3.06 km/s; gravity and drag losses reduce the real speed at staging to about 1.7 km/s (estimate). Explain why staging is needed: dropping dry mass. Keys: raptor_exhaust_velocity_sl_mps, liftoff_mass_used_t, meco_speed_est_mps, booster_dry_mass_b3_t.

**P4. Why the steam is white and how much energy the water takes.** 1.3 million kg of water x 2.6 MJ/kg = 3.4 TJ to vaporise, about 13 seconds of the plume's chemical power (271 GW). Steam condenses on the humid Gulf air into micrometre droplets; Mie scattering makes them white. Only about 10 percent of the cloud mass is combustion water. Keys: deluge_water_pad1_kg, deluge_vaporisation_energy_J, chemical_power_GW, combustion_h2o_tps.

**P5. Overexpanded nozzles and Mach diamonds.** Exit pressure (0.6 to 0.9 bar) versus ambient (1.01 bar) decides the shock pattern. Show a cut-away of one Raptor plume with cells of length about 1.3 D sqrt(M^2 - 1) (textbook rule, not verified in session), and how the diamonds stretch and wash out as pa falls with altitude. Keys: raptor_exit_pressure_bar, raptor_exit_mach, raptor_nozzle_expansion_ratio, raptor_nozzle_exit_diameter_m, raptor3_chamber_pressure_bar.

**P6. The sound front.** Sound emitted at time t reaches distance r at t + r/c. Draw the sphere of radius c(t + 3 s) from ignition; at T+7.5 s it is 3.8 km. Compare: source acoustic power about 0.65 GW (0.5 percent of the 131 GW jet power, estimate) gives Lw about 208 dB. Show the difference between the free-field estimate (about 120 dB at 10 km) and the measured 105 dB. Keys: sound_speed_25C_mps, sound_front_radius_at_photo_m, acoustic_eff_central, sound_power_level_dB, spl_10km_measured_dB, jet_mechanical_power_GW.

**P7. Hot staging and max-Q.** Dynamic pressure q = 0.5 rho v^2 peaks around T+45 to 60 s at about 30 kPa (model) when the vehicle is near Mach 1; the engines throttle down to limit loads. Then MECO at about T+140 s and hot staging 2 s later. Show a timeline with flights 10 to 14 event times. Keys: max_q_time_f14_s, max_q_model_kPa, meco_time_f14_s, hot_staging_time_f14_s, meco_alt_est_km.

**P8. Tower catch and why it matters.** The booster (and later the ship) is caught by the tower arms, so it needs no landing legs and can be reflown quickly. Flight 14's booster made an offshore landing burn with 11 of 13 engines instead of a catch (https://en.wikipedia.org/wiki/Starship_flight_test_14). Wikipedia's Flight 13 page says Musk announced that a Flight 14 ship catch would first require reaching orbit; Flight 14 did reach orbit but the ship deorbited to a Pacific splashdown, so no ship catch has yet happened. Keys: tower_height_used_m, booster_dry_mass_b3_t, hot_staging_time_f14_s.

## Notes for the writer
- Keep numbers linked to their spec key; badge est vs src.
- Finnish UI: use "ensimmäinen vaihe" for the booster, "toinen vaihe" for the ship, "hot staging" with explanation, and avoid "kuumaerotus".
- Do not state "T+7 s" as measured; it is an integrator result (see physics.md).
- Where sources conflict (250 vs 280 tf; 5,300 vs 5,700 t; 330 vs 350 bar) show the chosen value with a "sources differ" note.
