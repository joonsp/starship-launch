# Launch pad, tower, site and photo camera

Coordinates: metres, origin = Pad 2 vehicle axis at ground, x east, y up, z south. Tags: src = sourced, est = estimated (reasoning given). Numbers are also in pad.spec.json.

## 1. Which pad and which flight
Pad 2 (Pad B, OLP-2), the western Starbase pad on the site of the old suborbital launch site. Flight is most likely Starship Flight 14 (Booster 21 / Ship 41, first orbital flight, 26 Starlink V3), liftoff 2026-09-28 12:48:59 UTC = 07:48:59 CDT = 15:48 in Finland [src: https://en.wikipedia.org/wiki/Starship_flight_14; https://spaceflightnow.com/2026/09/28/live-coverage-spacex-to-launch-first-starlink-v3-satellites-to-orbit-on-starship/ for the pad and vehicles]. Reasoning (est):
- Pad 1 tower is WEST of its mount with arms pointing east (OSM); Pad 2 tower is NORTH of its mount with arms pointing south. In the photo the tower is directly behind and slightly left of the vehicle with the sea to the right and behind, which needs a camera south of the pad looking NNE: only Pad 2's layout does that. An OSM overlay projected with the fitted camera lines up on tower, apron edge, coast and tidal flats (camera-estimate.md).
- Pad 1 was decommissioned 14 Oct 2025 and is under reconstruction [src: https://en.wikipedia.org/wiki/SpaceX_Starbase]. Flights 12 (2026-05-22), 13 (2026-07-24) and 14 all used Pad 2 [src: Wikipedia flight 12/14 pages]. Flight 13 (17:51 CDT) and 12 (17:30 CDT) had the sun in the west; the photo is lit from the right/rear (ESE sun, alt ~19 deg at flight 14 time; est), so flight 14. Posted 22:30 on 2026-09-28 is consistent.
- Note: Wikipedia's Starbase page says OLP-2 launches "2, first July 24, 2026", conflicting with the flight 12 page (first Pad 2 launch May 22, 2026). Irrelevant to this photo.
- Photo moment (est): vehicle engine skirt ~160 m above ground, about 8 s after liftoff (range 7-10); the tower top is just below the booster.

## 2. Pad 2 geometry (local frame)
| item | value | prov |
|---|---|---|
| tower centre | (-3, -27), 27 m north of axis, footprint 16x16 m | src OSM way 1207227015 |
| tower height | 144.5 m incl. lightning masts (FAA OE 619969843; Fandom OLIT-3 474 ft). Range across towers 143-146 m; Wikipedia says 146 m | src |
| tower body width aloft | ~12.5 m (photo, 18-20 px) | est |
| lattice | lightning masts on top; open steel lattice with X-bracing; bay spacing roughly 8-12 m from the photo, low confidence; three main pillars carry the chopstick rails (Fandom/Tesla Oracle) | est / src |
| chopsticks | carriage on the tower face (z -19), arms reach south to z ~ +8: 27 m from tower face; arm length ~17 m; closed gap 12 m (x -5..+7). Pad B arms are shorter than Pad A's | src OSM ways 1540152640-52; src SpaceExplored, Tesla Oracle |
| chopsticks in the photo | carriage near 124 m height (+-6), arms swung open, ~44 m tip to tip | est |
| boom left of tower | ~65 m height, hanging line; probable QD/service arm; low confidence | est |
| booster QDs | two (LCH4, LOX), on the opposite side of the mount vs Pad 1 | src NSF (snippet) |
| OLM | square ("quadratic") water-cooled deck with central round opening, 20 hold-down clamp arms, on columns; height about 20 m, footprint about 34 m square, LOW confidence | src (shape, clamps) / est (dims) |
| flame trench | dedicated concrete bathtub trench, stainless lined, water-cooled double-sided flame-bucket diverter. Orientation est east-west (clouds go left and right in the photo). Size est 60 x 25 x 8 m, low confidence | src (type), est (dims) |
| deluge runoff pond | basin centred (-25, 57), ~35 m across | src OSM way 1486752424 |
| tank farm | east-north-east, 150-470 m away (polygon x 145..467, z -110..+24). LOX GSE (196, -85) 58x42 m and CH4 GSE (182, -59) 64x35 m nearest Pad 2. 14 LOX/LN2 horizontal tanks ~5.8 m dia x 48.4 m long; 6 CH4 tanks 6.5 x 50.2 m; 2 CH4 8 x 31 m; 13 water deluge tanks 3.4 m dia x 26/39 m at x 52..98 (west end); 30 vaporizers (3x3 m) | src OSM |
| other buildings | Power & Comms (81,-134), Gas generators (91,-86), Control Center (58,-124), Megabunker (133,-121), Power Bunker (233,-102), Starhopper display (67,-197) | src OSM |
| ground | 2.5 m ASL | src OSM ele tag |
| coast | Gulf beach ~750 m east, running NNW-SSE | src OSM |

## Pad 1 summary
Tower (331.5, 74.5), 143 m (OSM/FAA; Wikipedia 146 m), arms point east; axis est (359, 72). Distance from Pad 2: ~366 m at bearing ~101 deg (ESE, slightly south); tower to tower ~350 m. Original mount is a circular "donut" with a water-cooled steel deluge plate; a 67x77 m "Flame Trench" polygon at (366, 74) now exists in OSM (decommissioned 14 Oct 2025 for V3 rebuild). Launch table 370 t. Pad 1 tank farm is east of it (x 330..467). Sources: Wikipedia SpaceX Starbase; SpaceExplored; OSM.

## 3. site.json / OSM coverage notes
- Overpass bbox 25.975..26.019 N, -97.178..-97.130 E (about 4.9 x 4.8 km). Origin in site.json is the Pad 2 axis (lat 25.99680, lon -97.15804).
- 368 features (0.22 MB), simplified with Douglas-Peucker at 2 m (buildings 0.5 m), coordinates rounded to 0.1 m. Kinds: scrub 120, structure 106 (tanks, gantry, pipelines, vaporizers), building 45, road 52, water 30 (ponds and waterways), wetland 6 (tidal flat), coast 3, beach 1, sand 1, other 3.
- Extensions to the requested schema: polygons may carry "holes" (multipolygon inner rings); nodes appear as geom "point" (camera towers); relation rings cut off by the bbox are emitted as "line".
- Quality: site infrastructure (tanks, gantry/chopstick outlines, buildings, roads, Pad-2 and Pad-1 towers) is excellent and recent. Coastline is a single 3-way line; there is NO sea polygon (sea = everything east of the coast line; draw it yourself). Wetland/tidal-flat and scrub polygons are coarse; the small tidal pools seen in the photo foreground are only partly mapped (some as holes in the tidal-flat relation), so add procedural pools/roughness. Pad 2 OLM and flame trench are not mapped; Pad 1 has a trench polygon (its height tag 146 looks wrong). Raw merged responses: research/osm-raw.json (natural, waterway, highway, building/man_made/landuse/aeroway queries).
- Kind mapping: natural=grassland was not returned in this box.

## Open items
- OLM height/footprint and trench dimensions: unsourced (NSF forum thread and Fandom pages were blocked: 403/402). Worth a second source before modelling those parts; the photo hides them under smoke anyway.
- Pad 2 tank farm current layout may have changed after the OSM edits (NSF reported tank replacement work in 2026).
