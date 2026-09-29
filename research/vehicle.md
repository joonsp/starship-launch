# Starship V3 (Block 3) external geometry

All heights are metres above the local stage base (booster: engine nozzle exit plane; ship: base of the engine bay skirt). Provenance is "src" (URL) or "est" (reasoning). Machine-readable form is in vehicle.spec.json.
Configuration: Flight 14 (B21 + S41), Block 3. Runner-up is V2 (Flight 11 and earlier). See flight-id.md.

## Source notes and conflicts
- Booster 72.3 m (src, https://en.wikipedia.org/wiki/SpaceX_Super_Heavy). V2 was 71 m.
- Stack 124 m (src, https://spaceflightnow.com/2026/09/28/live-coverage-spacex-to-launch-first-starlink-v3-satellites-to-orbit-on-starship/).
- Ship: 124 minus 72.3 gives about 51.7 m. V2 ship 52.1 m (src, https://en.wikipedia.org/wiki/SpaceX_Starship_(spacecraft)). Wikipedia's Starship page lists Block 3 as "61 m (est)", which conflicts with the 124 m stack. CHOICE: 52.1 m.
- Propellant: Block 3 3,650 t (src, https://en.wikipedia.org/wiki/SpaceX_Starship) versus 3,400 t on the Super Heavy page (older blocks). Not needed for geometry.
- Rings: 9 m dia, 1.83 m tall (src, Super Heavy page). Four shorter 1.4 m rings in the aft booster. Stainless 4 mm plate. Ring weld seams therefore every 1.83 m (photo cannot resolve them).
- I could not retrieve NSF's Block 3 booster article (403). Its search-result summary said: three grid fins, each about 50% larger than before and placed lower on the trunk to avoid hot-stage heat; integrated N1-style open hot-stage truss; the ship exhaust hits the booster's forward dome; engines mount to a steel plate, not the dome; the 10-ring is rotated for the pad deflector; the centre three are clocked 108-108-144.

## Booster (Super Heavy V3), 72.3 m, R = 4.5 m
| Height (m) | Radius (m) | Feature | Prov |
|---|---|---|---|
| -0.5 to 0 | engine bells | 33 Raptor 3 nozzles, exit dia about 1.3 m, length about 3.1 m (bells extend from about y=-0.1 to about y=3) | est |
| 0 | 4.5 | Aft skirt bottom lip. Raptor 3 has no separate engine shielding; the skirt is simplified with fewer shrouds | src (NSF summary) |
| 0 to 5.6 | 4.5 | Four 1.4 m aft rings. Thrust plate about 3.2 m up | src rings, est plate |
| 5.6 to 44 | 4.5 | LOX tank, rings of 1.83 m. Heavy frost | est |
| 44 | 4.5 | Common dome. Fits the frost boundary in the photo (row 366) | est |
| 44 to 62 | 4.5 | CH4 tank, thinner frost | est |
| 62 to 72.3 | 4.5 | Forward dome plus integrated open vented hot-stage truss (about 10 m). Three grid fins on it. Catch pins on the trunk | est / src |
| 72.3 | | Top of the stage. The ship's 6 engines sit nested inside the truss at stack-up | est |

Grid fins (src count 3, size 1.5x): azimuths 0, 120, 240 (est), hinge height about 62.5 m (est), fin span about 3.6 m (est).
Catch pins: 2 (est), height about 64 m.
Raceways: 2 (est), full length. Chines: minimal on the booster (est). The ship's nose cone is black-tiled on the visible side.

### Booster engine layout (src counts: 20 fixed outer, 13 gimballing = 10 + 3)
| Ring | Count | Radius (m) | Angle | Prov |
|---|---|---|---|---|
| Outer | 20 | 4.0 | k x 18 deg, phase 0 | est radius |
| Middle | 10 | 2.4 | k x 36 deg + about 9 deg offset | est |
| Centre | 3 | 0.85 | 108-108-144 deg spacing | src (NSF summary) |
The 3/10/20 layout gives 33 Raptor engines. The pad deflector ridge is avoided by the middle-ring rotation (src, NSF summary).

## Ship (Starship V3), 52.1 m, R = 4.5 m
| Height (m) | Radius (m) | Feature | Prov |
|---|---|---|---|
| 0 | 4.5 | Skirt base. 6 engines: 3 RVac r=1.7 m (az 0/120/240), 3 sea-level r=3.3 m (az 60/180/300) | src counts, est radii |
| 4.5 | 4.5 | Aft flap hinge line (2 flaps, side-mounted, about 9 x 4 m). Flap span in photo about 15 m at the flare | est |
| 7 to 22.5 | 4.5 | LOX tank | est |
| 22.5 | 4.5 | Common dome | est |
| 22.5 to 38 | 4.5 | CH4 tank | est |
| 38 to 42.5 | 4.5 | Payload bay (Starlink V3 26 sats, dispensed through a wide door). Forward flap hinge at about 42 m, 2 flaps about 5.5 x 2.5 m, about 140 deg angle | est / src angle |
| 42.5 to 52.1 | 4.5 to 0.3 | Nose ogive, 9.6 m tall | est |
| 45 to 50 | inside nose | Header tanks (LOX/CH4) | est |

Nose ogive (tangent, R=4.5, L=9.6, x measured from tip): x=0 r=0.3 blunt tip, 0.5 0.57, 1 1.07, 2 1.92, 3 2.61, 4 3.17, 5 3.62, 6 3.97, 7 4.23, 8 4.40, 9 4.49, 9.6 4.50 (est).
Heat shield: about 18,000 (another source: 20,000) hexagonal tiles on the windward half (src, Starship (spacecraft) page). Tile about 32 cm across flats (est), gap about 5 mm (est), colour in the photo is near-black (15,14,17). Ship 41 carries two reflown tiles from Ship 40 (src: https://www.nasaspaceflight.com/2026/09/ship-41-pad-2-two-tiles-ship-40/ , title only). White or missing tiles are not visible at this resolution.
Leeward side: bare stainless steel (est), not visible in the photo. Quick-disconnect plate: about 41-42 m, near the forward tank end (est). Block 3 adds refuelling hardware (src: https://en.wikipedia.org/wiki/SpaceX_Starship).

## Runner-up: V2 (Flight 11)
Booster 71 m, four grid fins on the interstage (about 69 m), separate hot-stage ring (about 1.8 m tall, vented, src Super Heavy page), Raptor 2 with engine shielding, ship 52.1 m, 3 RSL + 3 RVac. Pad 1 tower with longer chopsticks (about 10 m longer than Pad 2).

## Photo-derived checks
- Scale 0.60 m/px: ship 88 px = 52 m, booster 119 px = 72 m.
- Ship black over full visible length: tiled side toward the camera.
- Frost: lower about 60% bright, upper about 40% dark steel (est).
- Booster base is about 140 m above the pad at this instant (est), about T+6 to 8 s.
- Plume: core RGB (245,215,210) pinkish-white; ground glare (245,221,129). Smoke is warm orange where sunlit and blue-grey in shadow.
