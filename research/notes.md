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
