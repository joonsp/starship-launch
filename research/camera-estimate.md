# Camera estimate for reference.jpeg (1677 x 943)

Frame: metres, origin = Pad 2 vehicle axis at ground, x east, y up, z south (north = -z). Heading h = compass bearing of the optical axis (0 = north, 90 = east).
All values are estimates ("est"); inputs measured from pixels or taken from OSM (src).

## Result (best fit)
| item | value | uncertainty |
|---|---|---|
| position (x, y, z) | (-308, 105, +634) m = 634 m SOUTH, 308 m WEST of the vehicle axis, 105 m above ground (lat 25.99108, lon -97.16112) | depth +-80 m, height +-15 m |
| heading | 26.8 deg (NNE) | +-3 deg |
| pitch | +2.7 deg (camera tilted slightly UP) | +-0.5 deg |
| roll | +0.2 deg (clockwise, right side down) | +-0.3 deg |
| focal length | 1133 px on a 1677 px wide frame = HFOV 73 deg, VFOV 45 deg (about 24 mm 35mm-equivalent, a typical wide drone lens) | HFOV 62-85 deg plausible; trades off with distance (see below) |
| principal point | image centre (838.5, 471.5), assumed | |

## Measurements from the photo
- Sea horizon row: y = 525 at x = 617..1085; y = 522 at x = 0..60 (roll about +0.2 deg). Centre row is 471.5, so the horizon is 53 px BELOW centre.
- Tower (Pad 2 lattice): top (lightning masts) y ~ 463, x ~ 799-802; upper body 18-20 px wide. Base hidden by smoke.
- Vehicle: ship nose tip y = 233, x = 824; ship black width 14 px at y = 290 (9 m -> 1.56 px/m); booster frost body ends and plume begins at y ~ 440, x ~ 821. Vehicle pixel length 207 px.
- Chopstick crossbar at y ~ 495, span x 782-852.

## Working
1. Pad identity and geometry from OSM: tower centre (-3, -27) m, i.e. the tower is 27 m NORTH of the vehicle; chopsticks reach south from the tower. In the photo the tower is BEHIND the vehicle, so the camera is south of the pad looking roughly north. Sea on the right and the tidal flats in the foreground confirm this (Gulf lies east; foreground pools lie south of the pad).
2. Heading from the tower/vehicle lateral offset. Tower vs vehicle axis at ground: dx = -3, dz = -27. For heading h, right vector r = (cos h, sin h), forward = (sin h, -cos h). Lateral = r.(dx,dz) = -3 cos h - 27 sin h; depth = -3 sin h + 27 cos h.
   Image lateral offset = (799 - 822) px = -23 px; at 1.55 px/m that is -14.8 m. Solve 3 cos h + 27 sin h = 14.8 -> h ~ 26 deg (h=25 gives 14.1, h=30 gives 16.1).
   The coastline (bearing ~ 174 deg/354 deg) then runs from far-left to near-right, as seen. Sun (az ~ 100 deg, alt ~ 19 deg at 12:48:59 UTC) is ~73 deg to the right of the heading, matching the strong light on the right-hand smoke.
3. Pitch from the horizon: pitch = atan((525 - 471.5)/f) = atan(53.5/1133) = 2.7 deg up. (Horizon dip for h = 105 m is 0.32 deg = 6 px; it is included by matching the sea horizon at 525 after rendering, but the effect is within the error.)
4. Scale and height (independent of f): image scale at the pad s = 1.55 px/m (ship width) to 1.6 px/m (vehicle length). Tower height 144.5 m + 2.5 m ground -> base at y_top + 147 * s_vert (s_vert ~ 1.53) = 463 + 225 = 688. The tower base is thus ~163 px below the horizon: tan(dip) = H / D => H / D = 163 / f. With D = f / s (depth = focal length divided by scale) this gives H = 163 / s = 105 m regardless of f.
5. Distance depends on f: D = f / s = 1133 / 1.6 = 708 m (used D = 705 along bearing 25.9 deg back from the axis). If the lens is 60 deg HFOV (f = 1450), D = 900 m; if 85 deg (f = 915), D = 570 m. Height stays ~105 m in each case.
6. Choice of f: 73 deg was picked as the usual wide drone lens (24 mm equivalent, e.g. DJI Mavic-class 4/3 wide camera with 16:9 crop). Cross-check by projecting OSM linework onto the photo with this camera (renders kept out of the repo): the tower top/base project to (798, 458)/(799, 686) versus measured (799, 463)/(799, ~685), the ship nose at 284 m altitude to (820, 240) versus (824, 233), the pad apron edge and the eastern shoreline (right edge x~1650, y~635) and the pond field in the foreground fall within ~20-30 px. The vehicle bottom at 160 m projects to y = 437 (measured 440).
7. Vehicle altitude in the photo: engine skirt row 440 vs tower top row 463 at similar depth -> about 23 px / 1.55 = 15 m above the tower top -> ~160 m above ground (+-12). With ~5 m/s^2 net acceleration from rest this is about 8 s after liftoff.

## Sanity checks
- Height 105 m is under the 400 ft (122 m) recreational drone ceiling, plausible for a press drone.
- Camera position lies over the tidal flats south of Highway 4, consistent with the foreground pools seen at the bottom of the photo.
- Pad 1 (359, 72) would project at about (1320, 669) with this camera, i.e. behind the big right-hand smoke bank; only lower structures at the right frame edge (x >= 1550) are visible, consistent with the photo (tank-farm/GSE structures at 1550-1677, y 700-790).

## Use in three.js
camera.position.set(-308, 105, 634); heading 26.8 deg -> look direction (sin h, tan(pitch), -cos h) = (0.451, 0.047, -0.892); camera.fov (vertical) = 45.2 deg, aspect 1.778; roll +0.2 deg about the view axis. Note: y is height above local ground (ground is 2.5 m ASL).
