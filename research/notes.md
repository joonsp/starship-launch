# Research notes: conflicts and orchestrator decisions

Full research: flight-id.md, vehicle.md, pad.md, camera-estimate.md, physics.md, rendering.md, edu-outline.md.

| Topic | Values found | Chosen | Why |
|---|---|---|---|
| Flight | Flight 14 (≈85 %); Flights 12, 13 and 11 less likely | Flight 14: B21/S41, Block 3, Pad 2, 2026-09-28 12:48:59 UTC | Morning sun from the right (ESE) and posted the same day. The X post itself was not found. |
| Raptor 3 sea-level thrust | 250 tf; 280 tf (press) | 250 tf | 33 × 250 tf = 80.8 MN, which matches the published booster thrust |
| Sun position | 8° (R4), 19°/100° (R2) | alt 5.7°, az 95.2° | Computed myself (almanac) for the pad location at liftoff time |
| Tower height | 130 m (photo est.), 143–146 m | 144.5 m | OSM and the FAA OE filing for tower 2 |
| Booster base height in photo | 140 m (R1), 160 m (R2) | 158 m | Recomputed with the calibrated camera (105 m up, about 705 m away) |
| Ship length | 52.1 m; 61 m (Wikipedia, est.) | 52.1 m | 124 m stack − 72.3 m booster |
| Liftoff mass | 5,300 t published; about 5,700 t sum of parts | 5,400 t | R4's central estimate |
| Freeze time | 6.9–8 s | 7.2 s | Integrator estimate; the physics module recomputes it and a test checks it |

The camera calibration was checked with a 50/50 overlay of a placeholder stack and tower on the reference photo. The nose tip, engine plane and tower top align within a few pixels.

## Fact-check of the educational content (polish round 2)

Every claim in the cards, explainers, stat tiles, walk HUD, sound-front text and Sources tab was checked against sources (Wikipedia and its citations, Spaceflight Now, NASASpaceflight, FAA re-evaluation excerpts, JASA-EL) and against the physics. Numbers that depend on each other are now pinned by tests (`tests/physics.test.ts`, "fact-check" blocks).

### Errors found and fixed
| Claim | Problem | Fix and source |
|---|---|---|
| "In vacuum thrust gains 5.5 %" | Left over from a 1.3 m nozzle; the model (1.2 m nozzles) gives 4.7 % | Computed live from the model. The sourced Isp ratio 350/330 would suggest about 6 %, so the nozzle size stays an open estimate |
| Thrust gain "0.1 % at 150 m" note used 43.8 m² | 33 x 1.131 m² = 37.3 m² | 0.08 %, computed live |
| Exit pressure 0.77 bar | Computed with Pc 300 bar (Raptor 2), the app uses 330 bar | 0.84 bar (isentropic, gamma 1.2, eps 34.3). Still overexpanded at sea level; crossover at about 1.6 km. Tests recompute it |
| "Roughly a hundred large power stations" for 271 GW | About 270 stations of 1 GW | Reworded |
| Tower "in the future, catches it" | Boosters have been caught since Flight 5 (13 Oct 2024) | https://en.wikipedia.org/wiki/SpaceX_Super_Heavy ; https://en.wikipedia.org/wiki/SpaceX_Starbase |
| Afterburn "hot water vapour and carbon dioxide glow yellow-orange" | H2O and CO2 emit mainly in the infrared; the orange is thermal glow of hot particles (soot, dust) and traces such as sodium | Reworded, hedged ("is thought to") |
| Core tint "from excited OH and CO" | OH* emits in the ultraviolet | "Blue emission by excited CH and CO2, plus shock cells, plus the camera's colour balance" |
| Frost "condenses and freezes" | Below 0 C, vapour deposits directly as ice (frost), plus condensed droplets that freeze | Reworded |
| Tiles "far beyond the melting point of steel" | Tiles are rated 1,400 C, about where stainless steel melts | https://en.wikipedia.org/wiki/SpaceX_Starship_(spacecraft) |
| Hot staging "saves a separate separation motor" | Documented advantages: no ullage motors (acceleration keeps propellant settled), simpler separation, small payload gain | https://en.wikipedia.org/wiki/Hot_staging |
| Grid fins "also strong points near the catch pins", "folded and passive" | Block 3 fins are integrated with the catch pins; "folded" is unsourced | https://en.wikipedia.org/wiki/SpaceX_Super_Heavy |
| Passenger feels 1.53 g "because the seat pushes with the whole thrust" | The seat pushes with T/W times the passenger's weight | Reworded |
| Isp explainer mixed momentum thrust and effective velocity | F = mdot x v_eff already contains the pressure term | Reworded |
| Rocket equation: start 5,400 t but end mass 2,099 t from parts summing to 5,700 t | Inconsistent | End mass = liftoff mass minus full-flow burn to MECO (1,904 t), reserve derived (154 t) |
| Fuel explainer "reserve for landing explains T+140 s" | Not supported: the model's flow is approximate | Reworded as a check |
| Max-Q "58 s" sourced to Wikipedia flight 14 | That page gives no max-Q time. The value itself is right: spacelaunchschedule.com lists Max-Q at T+58 s (MECO 2:20, separation 2:22); live blogs say "about T+1 min" | Value kept, source corrected |
| Max-Q "the model reaches about 30 kPa" | The shipped 1-D model peaks at 25 kPa near T+45 s | 25 kPa, tested |
| Sun "about 35 minutes after sunrise" | Almanac: sunrise 12:20 UTC, launch 29 minutes later | "About 30 minutes"; a test recomputes the sun |
| Flights 12 and 13 "in the afternoon" | Sun 31-34 deg high in the west | "Late afternoon, sun high in the west" |
| Deluge "350,000 gal, over 90 % vaporised", unverified | FAA Written Re-evaluation: 358,000 gal, SpaceX estimates 92 % vaporised (via search excerpts; PDF returned 403) | Values and URL updated; energy recomputed (3.2 TJ) |
| Sound: "air absorbs sound and terrain blocks it" | Not the main reasons; the plume is directional, the deluge and pad take some, ground and weather effects do the rest | Reworded |
| Sound measurement "earlier flight" (a blog said IFT-6) | The JASA-EL paper measured Flight 5 (9.7-35.5 km) | https://pubs.aip.org/asa/jel/article/4/11/113601/3320807 |
| HUD sound bands ("painful" at 100 dB) | Pain starts near 120-130 dB; damage in minutes from about 100 dB | Labels reworded, thresholds unchanged |
| Tank farm "loading about 5,400 t of propellant" | 5,400 t is the liftoff mass; the propellant is 5,250 t (SpaceX said "~12 million pounds" before Flight 14); loading takes about 45 minutes (Flight 7: T-46 to T-3 min) | New variable |
| Heat "enough to ignite paper" | Unsupported for an order-of-magnitude estimate | "Roughly 40 times full sunlight" |
| "Liftoff mass, published 5,300 t" | It is one blog's figure ("in the vicinity of 5,300 tons") that assumes a 3,400 t booster load | Relabelled "one review" |
| Vaporizers 30 | The OpenStreetMap extract has 22 | 22, with a URL |
| Trench "east to west" | OSM axis is ESE-WNW | "Roughly east to west" |
| Ship: 26 Starlink V3 stated as fact | Only true if the photo is Flight 14 | "If this is Flight 14, as is likely" (and in hot staging, staging, catch texts) |

### Open items (not resolved)
- Liftoff mass 5,300 vs 5,700 t: 5,400 t is a judgement call; it moves T/W between 1.55 and 1.45 and the freeze time between 7.0 and 7.8 s. The 285 t and 120 t dry masses are unpublished estimates.
- Raptor 3 sea-level Isp: 330 s (Super Heavy page) vs 350 s (Raptor page). 330 s is kept. Nozzle exit size, expansion ratio and the exit pressure are estimates (Raptor 1 values reused).
- Flight 14 thrust: Spaceflight Now wrote "some 16 million pounds"; 33 x 250 tf gives 18.2 Mlbf. Not reconciled (one engine shut down early, which would only explain 17.7).
- Mount height 20 m: no published figure found (fandom and NSF pages returned 402/403). It sets the freeze time.
- Flame trench size (60 x 25 x 8 m) is an estimate; OSM maps 84 x 18 m. Deck size 34 m is unsourced.
- Tank-farm counts from OpenStreetMap (raw extract has 10 LOX + 6 LN2 + 8 CH4 + 11 water tanks; the spec uses 14 / 8 / 13, counted near the Pad 2 rows).
- Wikipedia's Starbase page says Pad 2's first launch was Flight 13, while Spaceflight Now says Flight 12 debuted V3 from Pad 2. Not needed for the UI text.
- Booster catches: Wikipedia Starbase says 3 (Flights 5, 7, 8), the Super Heavy page says 2. The text says only "since Flight 5".
- Max-Q and staging times: MECO about T+140 s (SFN, Wikipedia) and hot staging T+142 s (NSF) are sourced; some live blogs gave T+2:31 for separation. Max-Q T+58 s comes from one launch-schedule site (live blogs say about T+1 min).
- Hot-stage vent count (12) is a placeholder; tile size (about 32 cm) and gap (about 6 mm) have no official figure.
- `ui.about.p1` in src/ui/strings.ts states "Flight 14" without the 85 % caveat (not part of this module).
- FAA figures (358,000 gal, 92 %) come from search excerpts of https://www.faa.gov/media/72826; the PDF itself could not be fetched. The 2025 tiered EA reportedly allows up to about 422,000 gal per operation at Pad 2 (unverified).
