# Starship liftoff physics and calibration numbers

Prepared 2026-09-29. Frame: origin = centre of the launch mount, x east, y up, z south (-z north). Every number is tagged `[src URL]` or `[est: reasoning]`. Where sources conflict both values are given, then "CHOICE". The tools available to the researcher could not open several primary pages (nasaspaceflight.com, faa.gov, spacex.com, pubs.aip.org and space.com all returned 403 or empty bodies), so most sources are Wikipedia pages and press articles, and some were read through a summarising fetcher. The confidence column says how far to trust each entry.

Source shorthand:
- W-F12 https://en.wikipedia.org/wiki/Starship_flight_test_12
- W-F13 https://en.wikipedia.org/wiki/Starship_flight_test_13
- W-F14 https://en.wikipedia.org/wiki/Starship_flight_test_14
- W-F11 https://en.wikipedia.org/wiki/Starship_flight_test_11
- W-F10 https://en.wikipedia.org/wiki/Starship_flight_test_10
- W-SH https://en.wikipedia.org/wiki/SpaceX_Super_Heavy
- W-SS https://en.wikipedia.org/wiki/SpaceX_Starship
- W-RAP https://en.wikipedia.org/wiki/SpaceX_Raptor
- W-BASE https://en.wikipedia.org/wiki/SpaceX_Starbase
- W-SUP https://en.wikipedia.org/wiki/Sound_suppression_system
- SFN-V3 https://spaceflightnow.com/2026/05/12/spacex-targets-may-19-for-debut-of-starship-super-heavy-version-3-launch-pad-2/
- SFN-F14 https://spaceflightnow.com/2026/09/21/spacexs-super-heavy-booster-arrives-at-pad-ahead-of-first-orbital-starship-launch/
- NSE https://newspaceeconomy.ca/2026/04/16/detailed-review-of-starship-v3/

## 0. Which flights exist (context for the flight-identification researcher)

| Flight | Date/time (liftoff) | Vehicles | Pad | Source |
|---|---|---|---|---|
| 10 | 2025-08-26 23:30 UTC (6:30 pm CDT) | V2 (Block 2), B16 | Pad 1 | W-F10 |
| 11 | 2025-10-13 (V2 final flight) | V2 | Pad 1 | W-F11 |
| 12 | 2026-05-22 22:30:22 UTC (5:30:22 pm CDT) | first V3 (Block 3): B19 / S39, Raptor 3 | first launch from Pad 2 (OLP-2) | W-F12 |
| 13 | 2026-07-24 22:51 UTC (5:51 pm CDT). Spaceflight Now prints "July 25 ... EDT", which conflicts with Wikipedia. CHOICE: Wikipedia, since 5:51 pm CDT = 22:51 UTC. | B20 / S40 | Pad 2 | W-F13, https://spaceflightnow.com/2026/07/25/super-heavy-starship-rocket-chalks-up-mostly-successful-test-flight/ |
| 14 | 2026-09-28 12:48:59 UTC (7:48:59 am CDT) | B21 / S41, V3, first orbital flight | Pad 2 | W-F14, SFN-F14 (target was 7:15 am CDT) |

Lighting hint (est): the reference photo shows very warm, low-angle sunlight (orange-lit cloud undersides). At Starbase on 28 Sep the sun rises about 7:15 am CDT, so a 7:49 am liftoff has the sun about 7 to 8 degrees above the horizon, from the east/south-east (est: hand solar geometry, lat 26 N, declination -2.6 deg). Flights 12 and 13 lifted off at about 5:30 to 5:50 pm CDT in May/July, with the sun much higher (about 35 to 45 deg at 5:30 pm in May; est). The photo was posted on X at 10:30 pm on 2026-09-28, the same day as Flight 14. This makes Flight 14 the strongest candidate on lighting and timing grounds (the identification itself belongs to the other researcher).

## 1. Vehicle and mass numbers

| Quantity | Value | Prov | Notes / conflicts |
|---|---|---|---|
| Booster (Super Heavy) height, Block 3 | 72.3 m | src W-SH, NSE | Block 1/2: 71 m (src W-SH) |
| Stack height, Block 3 | 124.4 m | src W-SS, NSE | V2: 123.1 m (NSE) or "123.3" (W-SS): both given |
| Ship height Block 3 | about 52.1 m (stack minus booster) | est | W-SS lists "61 m" in one table, inconsistent with the 124.4 m stack. CHOICE: 52.1 m. SFN-F14 says ship "171 ft (52 m)". |
| Diameter | 9 m | src W-SS | |
| Booster propellant, Block 2 | 3,400 t (about 2,700 t LOX + 700 t CH4) | src W-SH | |
| Booster propellant, Block 3 | 3,650 t | src W-SH | |
| Booster dry mass, Block 2 | 275 t | src W-SH | Block 3 dry mass not found; est 275 to 300 t. |
| Ship propellant Block 2 / Block 3 | 1,500 t / 1,600 t | src W-SS | |
| Ship dry mass Block 2 | 85 t | src W-SS | Block 3 ship dry mass not found: est about 100 to 130 t. |
| Payload F12 / F13 | about 37,500 kg / about 34,100 kg | src W-F12, W-F13 | F14: 26 Starlink V3 sats (SFN-F14); mass not found, est about 26 x 1.7 t = 44 t (from F13 per-satellite ratio). |
| Gross liftoff mass Block 3 | about 5,300 t | src NSE | Sum of parts: 275 + 3,650 + about 115 + 1,600 + about 40 = about 5,700 t. Conflict. CHOICE: 5,400 t central for the integrator (est), range 5,300 to 5,650 t. Real liftoff loads may be below capacity, or dry masses smaller. |
| Booster engines | 33 Raptor: 20 fixed outer, 13 gimballed inner (Block 1/2 layout; Block 3 also 33) | src W-SH | |
| Ship engines Block 3 | 3 sea-level + 3 vacuum = 6 | src NSE, W-F12 ("all six lit") | W-SS table says "3 SL + 6 vac". CHOICE: 6, since flights 12 to 14 report six engines. |

## 2. Raptor 2 and Raptor 3

| Quantity | Raptor 2 | Raptor 3 | Prov / conflict |
|---|---|---|---|
| Sea-level thrust | 230 tf = 2,256 kN | 250 tf = 2,452 kN | src W-RAP, SFN-V3 ("250 tf up from 230 tf"). CONFLICT: NSE and other press quote 280 tf (Musk target) and "9,240 t total". CHOICE 250 tf, because 33 x 250 tf = 8,250 tf = 80.9 MN matches the 80.8 MN / 18.2 Mlbf liftoff figure in W-SH and CBS ("18 million pounds"). |
| Vacuum thrust (RVac) | 258 tf | 275 tf | src W-RAP, SFN-V3. Note this is the sea-level engine's vacuum variant per SFN. |
| Isp sea level | 327 s (W-SH Block 1/2) or 347 s (W-RAP Raptor 2 row) | 330 s (W-SH Block 3) or 350 s (W-RAP Raptor 3 row) | Conflict inside Wikipedia. CHOICE 330 s (W-SH) as the effective figure. Check: the 350 s reading gives mdot = 714 kg/s per engine, and the 330 s reading 757 kg/s. |
| Isp vacuum | about 350 to 356 s | about 350 s (some sources 380 s for RVac) | est/src mixed (W-RAP). The est value from Ae, p0 in section 3 gives 348 s for the SL engine in vacuum. |
| Chamber pressure | 300 bar | 330 bar (W-RAP, SFN) or 350 bar (NSE, Musk statements) | Conflict, both recorded. CHOICE 330 bar for the calculation, 350 bar quoted as target. |
| Engine mass | 1,630 kg | 1,525 kg | src SFN-V3, W-RAP. NSE adds 1,720 kg with all vehicle-side hardware. |
| O/F mass ratio | 3.6 | 3.6 | src W-RAP; stoichiometric methalox is 4.0, so the exhaust is fuel-rich (excess CH4 gives CO + H2). |
| Nozzle exit diameter (sea-level) | about 1.3 m | about 1.3 m | Raptor 1 figure only in W-RAP (expansion ratio 34.34); Raptor 2/3 not found. est: unchanged, 1.3 m, exit area 1.327 m2. |
| Chamber temperature | about 3,500 to 3,700 K | same | est: methane/LOX adiabatic flame temperature at O/F 3.6, from general combustion knowledge; not read in session. |
| Nozzle exit static temperature | about 1,300 to 1,700 K | | est: isentropic, expansion ratio 34, gamma 1.15 to 1.25 (section 6). |
| Exhaust velocity (SL) | | 3,236 m/s | est: 330 s x 9.80665 |
| Throttle range | 40 to 100 % | not updated | src W-RAP (Raptor 1 row) |
| Mass flow per engine | 703 kg/s (Isp 327) or 663 kg/s (347) | 757 kg/s (330 s) or 714 (350 s) | est: F/(Isp g0). The "650 kg/s (LOX 510 + CH4 140)" in W-RAP does not equal F/(Isp g0) for Raptor 1 at 327 s (566 kg/s); treat it as a rough design figure. |

Total booster: F_SL = 80.8 MN (src W-SH: 80.8 MN = 18.2 Mlbf), Block 2: 73.5 MN (16.5 Mlbf; W-SH). SFN's flight-13 report says "16 million pounds" (source https://spaceflightnow.com/2026/07/25/super-heavy-starship-rocket-chalks-up-mostly-successful-test-flight/), which matches the older Block 2 figure; treat as stale.
Total mass flow at 100 % (est): 80.8e6 / (330 x 9.80665) = 24,968 kg/s = 25.0 t/s = 19.54 t/s LOX + 5.43 t/s CH4 (O/F 3.6). Full-thrust burn time of 3,650 t = 146 s, consistent with observed MECO at T+138 to 142 s once the booster's landing reserve and throttle-down are included.

Engine start sequence (src W-SH: "At three seconds before launch, the engine startup sequence begins"; the outer 20 engines of Block 1/2 are lit using ground support equipment). Timing used here (est): ignition command T-3 s, thrust ramp over about 2.5 to 3 s, hold-down release/liftoff = T+0 at about full thrust with vehicle-computer confirmation. Known deviations: Flight 1 lifted with 30 of 33 lit (https://en.wikipedia.org/wiki/Starship_flight_test_1, not fetched this session), and the first Flight 13 attempt aborted at T-0 with four (W-F13) or six (Wikipedia search summary) engines not starting, so the count is stated inconsistently and both are recorded. Flight 12: "All engines lit at liftoff" (W-F12).

## 3. Liftoff integrator model

State: altitude y, vertical speed v (start: booster base at rest on the mount; y = 0 there), mass m.

```
mdot   = F_SL / (Isp_SL * g0)                      # constant, choked; F_SL = 80.8e6 N, Isp_SL = 330 s -> 24,968 kg/s
A_e    = N * pi * (D_e/2)^2                        # N = 33, D_e = 1.3 m (est) -> 43.8 m^2
F(h)   = mdot*throttle*Isp_SL*g0 + (p0 - p_a(h)) * A_e * throttle    # thrust rises as ambient pressure falls
p_a(h) = p0 * exp(-h/8400)                          # (ISA in the code)
D      = 0.5 * rho(h) * v^2 * Cd(M) * S             # S = pi*4.5^2 = 63.6 m^2
dv/dt  = (F - D)/m - g(h);   dm/dt = -mdot*throttle
```
Check on thrust vs altitude: at h = 150 m, p_a = 99.5 kPa, so dF = (101,325 - 99,530) x 43.8 = +79 kN = +0.10 % of 80.8 MN. Negligible, as expected; the vacuum value would be 80.8 + 4.44 = 85.2 MN (Isp_vac about 348 s, est), a 5.5 % increase spread over the whole ascent.

Drag: Cd 0.35 subsonic, peaking about 0.7 at Mach 1 to 1.2 (est; generic launch-vehicle behaviour, not from a Starship source). At 40 m/s, q = 0.5 x 1.2 x 1600 = 1 kPa, drag = 1,000 x 0.35 x 63.6 = 22 kN = 0.03 % of thrust, so drag is negligible before about T+15 s.

Throttle: full thrust on the pad and to about T+35 s. Max-Q throttle-down is a real feature but its depth is not published; est bucket used in the trajectory table: linear to 70 % between T+35 and T+50 s, 70 % until T+70 s, back to 90 % by T+85 s, 90 % to MECO. This is a placeholder; do not present it as SpaceX data.

### Tower-level result (vertical, full thrust, drag on, dt = 1 ms)

Booster base rest = 0 m. Tower height: Pad 2 tower (OLIT-3) 474 ft = 144.5 m (src: Fandom summary via web search, https://starship-spacex.fandom.com/wiki/Orbital_Launch_and_Integration_Tower_(OLIT), not fetched directly), Pad 1 tower 146 m / 479 ft (src W-BASE, citing the FAA hazard determination of March 2021); a third listing says 143 to 146 m incl. lightning mast. VERIFIED to about +/- 2 m: "about 145 m", measured from the ground and including the mast. The base of the booster does not start at ground level: it sits on the orbital launch mount (OLM). OLM height is not found in a source; est about 20 m (a Pad 1 legs height I recall, unverified; range 15 to 25 m). So "base level with tower top" means the base has climbed s = 145 - 20 = about 125 m (range 120 to 130 m).

| M0 (t) | T/W at T-0 | t at s=100 m | t at s=125 m | v at 125 m | proper accel F/m | net accel | t at s=145 m (if OLM=0) |
|---|---|---|---|---|---|---|---|
| 5,300 | 1.55 | 5.98 s | 6.68 s | 38.0 m/s | 1.61 g | 5.94 m/s2 | 7.19 s |
| **5,400 (central)** | **1.53** | **6.14 s** | **6.86 s** | **37.0 m/s (133 km/h)** | **1.58 g** | **5.66 m/s2 = 0.58 g** | **7.38 s (v 40.0 m/s)** |
| 5,650 | 1.46 | 6.57 s | 7.33 s | 34.7 m/s | 1.51 g | 4.98 m/s2 | 7.88 s |

Rule of thumb: s = 0.5 a t^2 with a about 5.5 m/s2 gives t = 6.7 s for 125 m. Whole tolerance is T+6.7 to 7.9 s. Time for the booster base to clear the tower top (est, not found in any source; the webcast "cleared tower" callout time was not located): about T+7 to 8 s.

Reading the photo (est, by eye on the 1677x943 image): booster base (engine skirt) at about 10 to 15 m above the tower top, camera slightly high, perspective error maybe 15 %. That corresponds to s = 135 to 140 m, T+7.1 to 7.4 s, v about 39 m/s, and a bright column of exhaust about 115 m long (from the pixel scale of about 1.65 px/m using the 124.4 m stack). The scene builder should treat the frame as "T+7 to 8 s, base a few tens of metres above the tower top".

### Trajectory table (2-D point mass, gravity turn after a 3 deg kick at T+10 s, throttle bucket above; est, illustrative, +/- 20 % beyond T+30 s)

| T+ (s) | altitude (m) | speed (m/s) | Mach | q (kPa) |
|---|---|---|---|---|
| 5 | 66 | 26.7 | 0.08 | 0.4 |
| 10 | 270 | 55 | 0.16 | 1.8 |
| 15 | 621 | 86 | 0.25 | 4.2 |
| 20 | 1,130 | 118 | 0.35 | 7.7 |
| 30 | 2,661 | 192 | 0.58 | 17 |
| 45 | 6,338 | 304 | 0.97 | 29 |
| 60 | 11,150 | 378 | 1.28 | 25 |
| 90 | 23,340 | 664 | 2.2 | 11 |
| 120 | 40,800 | 1,218 | 3.9 | 2.6 |
| 140 | 55,300 | 1,725 (6,200 km/h) | 5.4 | 0.7 |

Sanity checks: model max-Q about 30 kPa at T+45 to 60 s, altitude 7 to 11 km; real max-Q times are T+45 s (F12), 58 s (F13, F14), 62 s (F10, F11), so the max-Q time differs by flight (V3 max-Q times are earlier and vary; the exact times are src, the model's location is est). My recollection of webcast HUD values (not verified, low confidence) is staging at about 65 to 70 km at about 1.6 to 1.8 km/s; the model gives 55 km and 1.73 km/s, so treat the altitude at MECO as 55 to 70 km. Idealised delta-v check: 330 x 9.80665 x ln(5400/2100) = 3.06 km/s before gravity and drag losses, so the assumed reserve/throttle values have to be large; this is why the profile ends at about 1.7 km/s.

### Telemetry: what was and was not found
The SpaceX webcast HUD numbers (speed km/h, altitude km at T+10, 20, 30, 60 s) could not be retrieved: no accessible text source reports them. Only T+ event times are src. `telemetry.json` therefore holds src event times with null alt/speed, plus a separate model_est series. Do not label the model series as measured.

Event times (src):

| Event | F10 (V2) | F11 (V2) | F12 (V3) | F13 (V3) | F14 (V3) |
|---|---|---|---|---|---|
| Max-Q | 62 s | 62 s | 45 s | 58 s | 58 s |
| MECO | 156 s | 157 s | 142 s | 138 s | 140 s |
| Hot staging / separation | 158 s | 159 s | 144 s | 141 s | 142 s |
| Boostback start | 168 s | 169 s | 150 s | 145 s | 147 s |
| Landing burn start | 380 s | 380 s | 394 s | 387 s | 395 s |

Sources: W-F10, W-F11, W-F12, W-F13, W-F14. Flight 14: a search summary said "at two minutes and twenty seconds Ship 41 separated", which conflicts by 2 s with Wikipedia's separation at 2:22; both stated, choice Wikipedia (MECO 2:20 then separation 2:22). Flight 12 max-Q at T+45 s is inconsistent with the others; possibly recorded differently (booster tumbled later at staging: W-F12), recorded as given.

## 4. Pad water system

- Pad 1: SpaceX told the FAA the deluge could discharge up to 350,000 gallons (1.3 million litres) per launch (src https://gizmodo.com/spacex-starship-rocket-artemis-mechazilla-launch-guide-1850249132 and https://interestingengineering.com/innovation/spacex-starship-water-deluge-system, reached via search; the primary FAA re-evaluation https://www.faa.gov/media/72826 returned 403). A search summary of the FAA document says more than 90 % of it is almost instantly converted into steam.
- Pad 2 (OLP-2): "integrated, advanced deluge with a robust water-cooled OLM deck and enhanced flame deflection"; water discharges from the flame-bucket halves, the ridge on top of them and a steel plate on the launch mount; sump pumps collect and recycle water (src https://starship-spacex.fandom.com/wiki/Pad_B_(Starbase), via search summary; page itself returned 402). A July 2026 test reportedly flowed 650,000 US gallons per minute (about 41 m3/s) (src https://www.basenor.com/blogs/news/spacex-tests-starship-pad-2-flame-deflector-at-650-000-gpm; that blog cites an X post by a third party, so low reliability; duration and tank size unknown). For comparison, SLS Pad 39B is rated 400,000 gal with peak 1,100,000 gal/min (src W-SUP), and the Shuttle poured 300,000 gal in 41 s (src W-SUP).
- Pad 1 launch table: 370 t steel (src W-BASE).
- Energy budget (est): 350,000 gal = 1.32e6 kg; heating 20 C to steam = 2.6 MJ/kg gives 3.4e12 J. The chemical power of 5.43 t/s of CH4 at 50 MJ/kg is 271 GW, so vaporising all the water equals about 12.7 s of chemical output, or about 26 s of the 131 GW jet kinetic power. So the water absorbs a large but not dominant slice, mostly in the first 10 to 15 s.
- Combustion water (est): at O/F 3.6 the 19.5 t/s of LOX would produce up to 11 t/s of H2O and 13.4 t/s of CO2, with about 0.54 t/s of excess CH4 going to CO + H2 (dissociation lowers these). Over 10 s that is about 110 t of combustion water against about 1,300 t of deluge water, so the pad cloud is dominated by deluge water, roughly 10:1 (est).
- Why the cloud is white: hot steam and exhaust mix with cool humid Gulf air, water vapour condenses into micron-sized droplets that scatter light equally across colours (Mie scattering), so the cloud looks white; it is not smoke (src W-SUP: "not smoke, but rather wet steam"). In the photo the cloud is orange because of the low sun (Rayleigh-reddened light, section 0) and glow from the plume (est).
- Dust and ablation: Flight 1 (no deluge) threw concrete debris and fine particles over kilometres (src title only, https://arxiv.org/pdf/2403.10788, "A new launch pad failure mode: Analysis of fine particles from the launch of the first Starship orbital test flight"; quantities not extracted because the PDF would not parse). With a deluge, particles are largely suppressed; expect a tan/brown tint near the ground from lifted sand and mud flats (est), and small amounts of ablated steel and paint.

## 5. Acoustics and heat

- Sound power (est): mechanical jet power = 0.5 x F x ve = 0.5 x 80.8e6 x 3,236 = 1.31e11 W (131 GW). With acoustic efficiency eta = 0.2 %, 0.5 %, 1 % (typical published rule-of-thumb range for rockets, NASA SP-8072; recalled, not fetched), acoustic power = 0.26, 0.65, 1.3 GW, i.e. sound power level (re 1 pW) Lw = 204, 208, 211 dB. Central 208 dB.
- Free-field SPL from a point source on the ground (hemisphere): Lp = Lw - 20 log10(r) - 8. At eta 0.5 %: 160 dB at 100 m, 152 at 250 m, 146 at 500 m, 140 at 1 km, 131 at 3 km, 120 at 10 km (no absorption). This clearly overpredicts far-field levels (see next).
- Measured far field (src https://old-man-par.com/2024/12/11/starship-measured-at-ten-times-falcon-9-sound-level/ summarising a Gee et al. paper in JASA Express Letters, 15 Nov 2024; the paper title "Starship Super Heavy acoustics: Far-field noise measurements during launch and the first-ever booster catch" puts it at Flight 5, while the blog says IFT-6; both recorded, CHOICE Flight 5 per the paper title): about 105 dB at 6.2 mi (10 km, Port Isabel), about 90 dB at 12.4 mi (20 km, Laguna Vista); "at least ten times that of Falcon 9" and "equivalent to 4 to 6 SLS launches"; measurements up to 22 mi. The blog's 105 dB and 90 dB have no stated weighting; treat with medium confidence. The measured decay of 15 dB per doubling from 10 to 20 km is steeper than spherical spreading (6 dB), so atmospheric absorption and terrain matter.
- Near field: "noise levels approaching 200 dB" at launch pads (src W-SUP); FAA re-evaluation: the 134 dB Lmax contour for all Starship flight/test operations lies within Starbase property (src search summary of https://www.faa.gov/media/72826; unverified). Deluge water can cut noise (Shuttle system: to about 142 dB, src W-SUP).
- Speed of sound: 331.3 x sqrt(1 + T/273.15) = 340 m/s at 15 C, 346 at 25 C, 349 at 30 C (src physics identity; est for local temperature about 25 C on a Gulf morning, use 346 m/s). "Sound front" sphere: sound emitted at engine ignition (T-3 s) has radius 346 x (t + 3) at time T+t: 3.5 km at T+7 s, 4.5 km at T+10 s, 9.7 km at T+25 s. Sound emitted at time t_e reaches distance r at t_e + r/c; a camera 1 km away hears the liftoff moment 2.9 s late. The vehicle passes Mach 1 at about T+45 s at about 6 to 7 km altitude (model, est) and near max-Q.
- Thermal radiation (est): for a luminous plume of area about 30 m x 100 m at 2,000 to 2,500 K with effective emissivity 0.2, sigma T^4 x eps = 0.2 to 0.4 MW/m2, and a view factor of area / (pi r^2) gives about 40 kW/m2 at 100 m, 0.4 kW/m2 at 1 km (sun = 1 kW/m2). Rough order of magnitude only.
- Shock waves and overpressure: the acoustic energy is dominated by the turbulent mixing region 5 to 10 nozzle diameters downstream (which is why the deflector and water are placed at the exit).

## 6. Plume physics

- Nozzle: expansion ratio 34.3 (Raptor 1 sea-level; src W-RAP; Raptor 3 est similar or a little larger). Isentropic estimate (est, hand-coded): for gamma 1.15 to 1.25 the exit Mach number is 3.9 to 4.4 and exit pressure p_e = 0.64 to 0.93 bar at 300 bar chamber pressure, so slightly overexpanded at sea level (p_e below 1.013 bar) and matched at about 0 to 1 km, then underexpanded as ambient pressure drops. Exit velocity 3.14 to 3.36 km/s (agrees with 330 s x g0 = 3.24 km/s, a consistency check of the model). Exit static temperature about 1,050 to 1,700 K.
- Shock diamonds (Mach diamonds): standing oblique shocks and expansion fans form as the jet adjusts to ambient pressure (src https://en.wikipedia.org/wiki/Shock_diamond: overexpanded jets form oblique shocks first, then expansion fans). Empirical relation quoted there for the first cell: x = 0.67 D0 sqrt(P0/P1) (D0 nozzle diameter, P0 chamber pressure, P1 ambient). With 1.3 m, 300 bar and 1 atm this gives x about 15 m, which is well beyond what 33 merged plumes show, so use it only qualitatively; a textbook cell length L ~ 1.3 D_j sqrt(M_j^2 - 1) (recalled, unverified) gives about 2 to 6 m per cell for the single engine plume. In the merged 33-engine plume near the mount, individual diamonds blur; visible near the core in the photo as bright pink streaks.
- Colours (est physics, with a source for the mechanisms: unburned fuel mixing with ambient air gives a hotter afterburning zone up to about 3,000 K, and emitters are H2O, CO2, excited OH and CO chemiluminescence; src https://www.science.gov/topicpages/r/rocket+exhaust+plumes.html snippet): inside the core the gas is fuel-rich (O/F 3.6 < 4.0, CH4 -> CO + H2) and only weakly luminous (no soot; methane burns clean), with a violet/pink tint from OH/CO band emission and the Mach-diamond glow. Where the excess CO and H2 mix with air the afterburning heats the gas and gives yellow-orange (hot H2O and CO2 emission, and a little incandescent particulate from the pad). Ground-hugging orange near the flames = afterburning fire plus deluge steam lit from within.
- Grey/white column above the booster: "the smoke trail" = ice/water condensation in the exhaust and frost from cold tanks (est).

## 7. Anything the scene builder should not assume
- 5,300 t vs 5,700 t liftoff mass conflict: the shot is within +/-0.5 s either way.
- 250 vs 280 tf per engine: the 80.8 MN liftoff thrust figure is used; 33 x 280 tf would give 90.6 MN and T/W 1.71.
- OLM height 20 m is an estimate.
- Everything beyond T+30 s in the trajectory table is a rough model.
