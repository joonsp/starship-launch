# Starship Flight 14 · T+7.2 s

An interactive 3D freeze-frame of a Starship launch: Flight 14, Super Heavy B21 + Starship S41 (Block 3),
leaving Starbase Pad 2 at sunrise on 2026-09-28, 07:48 CDT, about 7.2 seconds after liftoff. The scene is
rebuilt from published research and calibrated against a reference photograph. You can orbit it, walk the pad,
fly a drone through the steam, change the light, and open an education layer that explains the physics of that
instant.

Built with three.js r186, pmndrs postprocessing, TypeScript and Vite. The models are scripted in Blender.

## Running it

```sh
npm i            # once
npm run dev      # http://127.0.0.1:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck (`tsc --noEmit`) and production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Unit tests (vitest): physics, plume, volume layout, pad, vehicle, controls, UI strings, core |
| `npm run typecheck` | Typecheck only |
| `npm run models` | Rebuild `public/models/starship.glb` and `public/models/pad.glb` with Blender (headless) |

`npm run models` needs Blender 4.x or 5.x on the `PATH`; each build takes about a second. `blender/run.sh`
removes version-manager Pythons from the `PATH` first, because they shadow Blender's own standard library. The
preview renders are made with `bash blender/run.sh blender/vehicle_previews.py` and `bash blender/run.sh blender/pad_previews.py`.
See `blender/README.md`.

A WebGL 2 browser is required. A desktop GPU is recommended; the design target is 60 fps at *High* on an
AMD Radeon 8060S iGPU at 1080p.

### URL parameters

These are useful for deep links and scripted screenshots.

| Parameter | Values |
|---|---|
| `preset` | `photo` (default), `noon`, `night`, `thermal`, `clay` |
| `mode` | `photo` (default), `orbit`, `walk`, `fly` |
| `quality` | `auto` (default), `low`, `medium`, `high`, `ultra` |
| `edu` | `1` opens the education layer |
| `lang` | `en` (default), `fi` |
| `ui` | `0` hides all interface chrome |
| `drift` | `1` starts in slow-drift mode |
| `probe` | `0` disables the automatic quality probe |
| `idle` | `0` draws every frame (turns the idle gate off; see *How it renders*) |
| `bake` | Sky cube face size override, e.g. `512` (only for software-rendered QA) |

Example: `?preset=night&mode=walk&quality=low&edu=1&lang=fi&ui=0`.

`window.app` exposes `{ ctx, controller, modules, pipeline, ui, gpu, setPreset, setQuality, setMode, setEdu, setLang,
setDrift, exportStill, invalidate, stats, ready, frames, drawn }` for automation. `frames` counts animation ticks and
`drawn` counts frames actually drawn (the idle gate skips the rest); `stats` holds the draw calls, triangles and
programs of the last drawn frame plus `stats.idle`; `gpu` is the GPU-name quality guess. `invalidate()` wakes the idle
gate. `scripts/qa-shoot.mjs` takes headless screenshots with scripted steps:

```sh
VIEWPORT=1280x720 node scripts/qa-shoot.mjs steps.json out/shots \
  "http://127.0.0.1:5173/?quality=low&bake=512" "window.app && window.app.ready && window.app.frames > 10"
```

## Controls

| Key | Action |
|---|---|
| `1` `2` `3` `4` | Orbit, Photo, Walk, Fly |
| `L` / `Shift+L` | Next / previous lighting preset |
| `R` | Back to the photo camera and reset the lens |
| `[` `]` (`{` `}`) | Field of view −/+ 2° (±10°) |
| `-` `+` (`=`) | The same field-of-view step, for layouts where `[` `]` need AltGr (Finnish, Swedish, German) |
| `,` `.` (`<` `>`) | Roll (Dutch angle) −/+ 1° (±5°) |
| `E` | Education layer (not in fly mode, where E means *up*) |
| `H` | Hide or show all interface chrome (the touch joystick included) |
| `?` | Keyboard help |
| `Esc` | Close panels and menus; release the mouse |
| `Ctrl` | Walk mode: toggle the 40 m/s hyper walk |

**Orbit / Photo.** Drag to orbit, scroll to zoom, right-drag to pan. Photo mode is the calibrated reference
camera; the first drag turns it into orbit at the same pose.

**Walk.** Click the view to capture the mouse. `WASD` or the arrow keys move you at 1.6 m/s, `Shift` runs at
6 m/s, `Ctrl` toggles a 40 m/s "hyper" walk, `Space` jumps and `C` crouches. You collide with the pad
structures, tanks and fences, and you can step onto kerbs up to 0.35 m.

**Fly.** A free drone. `WASD` moves, `Q`/`E` (or `C`/`Space`) descend and climb, `Shift` boosts x3, and the mouse
wheel sets the speed from 1 to 200 m/s. Fly mode has no collisions.

On touch devices there is a virtual joystick at the lower left, and you drag to look and double-tap to jump. `H`
(or the menu) hides all of it, joystick included; on touch a faint eye button in the corner brings it back.

**Lens panel.** Field of view with optional dolly zoom, roll, and tilt-shift (focus height, band and blur).
**Export still** saves a converged PNG at twice the screen resolution.

## Modes and presets

- **Camera modes:** Orbit, Photo, Walk, Fly (see above).
- **Lighting presets:**
  - *Photo*: the sunrise of the reference photo, with the sun 5.7° high at azimuth 95°.
  - *Noon*: sun 65° high.
  - *Night launch*: the plume lights everything.
  - *Thermal camera*: false-colour temperature, from about 80 K on the cryogenic tanks to about 3500 K in the Mach
    diamonds, with a kelvin scale bar burned into the image (it is also in exported stills).
  - *Clay*: albedo-neutral form study, lit by a white sun raised to 28° in the south-east (the camera side) so the
    forms are modelled by light and shade and the long shadows draw them on the ground.
- **Slow drift:** a gentle animation around the frozen instant. The steam billows and drifts, the plume flickers,
  the engines rumble and the aviation beacons flash. Switching it off returns to the exact frozen still.
- **Quality:**
  - *Auto* makes a first guess from the GPU name.
  - After loading, a short frame-time probe steps the level down if the frame rate is too low. It only samples
    back-to-back drawn frames while the clouds are still marching (converged frames are nearly free and would hide a
    slow GPU), and it runs again when the canvas becomes much larger (fullscreen, a 4K monitor).
  - *Low* to *Ultra* scale the pixel ratio, cloud march resolution and steps, bake resolutions, shadow map size
    and post effects. The surface-detail octave count of the vehicle and pad materials is a uniform, so a switch
    relinks only a couple of programs instead of about seventy.
- **Education:** hotspots with cards (live key numbers, each marked *sourced* or *estimate*), force arrows, and
  the sound-front sphere. There is also a walk HUD and a "Physics of this moment" panel with four tabs: Moment,
  Explainers, Sources and model notes. It is available in English and Finnish.

## How it renders

The scene is frozen, so everything that can be baked is baked, and **once nothing changes nothing is drawn**. The sky, the cumulus and the cloud density are
baked once. The launch-cloud light volume is re-baked in time slices when the light changes. The shadow map is
rendered once per preset and once after the camera settles. The volumetric clouds accumulate progressively to a
converged full-resolution image while the camera is still.

**Idle gate** (`src/core/idle.ts`, wired in `src/main.ts`). Every animation tick still runs the camera, the module
updates and the DOM UI, but the frame graph runs only while something can still change: an event owes frames (camera,
preset, quality, language, education, resize, tab visible again), the clouds are still accumulating (128 frames), the
shadow map is settling after a camera move, a sky re-bake is running, the 3D overlay changed, or slow drift is on. After
that the canvas keeps its last image and the GPU idles. While a quality change links its new shader programs the last
frame is held (`compileAsync`), and the canvas is resized only afterwards, because a resize blanks it.

Frame graph (`src/core/pipeline.ts`, specified in `src/contracts.ts`):

1. **RenderPass.** Sky dome, terrain, ocean, pad and vehicle go into a HalfFloat HDR buffer with a float depth
   buffer. The depth is copied to a stable depth texture (`ctx.targets.sceneDepth`).
2. **Plume.** The 33 raymarched Raptor jets and the merged column, rendered into their own target and occluded
   manually against the scene depth.
3. **Volume.** The steam, smoke and ground fireball are raymarched at reduced resolution and accumulated at full
   resolution. This pass owns the composite:
   `opaque × T + in-scatter + plume × T(plume distance)`.
4. **Overlay.** The education arrows and the sound-front sphere, depth-tested against the scene.
5. **Post.** Heat haze, bloom, AgX, grade and LUT, tilt-shift, SMAA, then chromatic aberration, vignette and grain.

Lighting comes from:

- one sun with a light-space-fitted orthographic shadow frustum covering both pads and the long sunrise shadows;
- hemisphere ambient;
- a PMREM environment built from the environment module's sky;
- the plume as a line light, injected into every PBR material by `src/core/material-hooks.ts`.

Tidal pools get a planar reflection. It uses a world-space clip plane, so the steam in the mirror is composited
at the correct depth.

## Project layout

```
index.html              entry page (canvas + UI root)
src/main.ts             app entry: context, modules, UI wiring, frame loop, URL parameters, auto quality
src/contracts.ts        shared contracts: units, world frame, frame graph, ownership rules, module interface
src/scene-config.ts     anchors, calibrated photo camera, photo preset, quality tiers
src/specs.ts            typed access to specs/starship.json (every number with its source or estimate)
src/core/               pipeline.ts (renderer, lights, shadows, PMREM, frame graph, renderView),
                        quality.ts (GPU guess + frame probe), material-hooks.ts, context.ts, engine-layout.ts
src/vehicle/            Super Heavy + Starship: GLB loading, procedural frost, tiles, steel and Raptor materials
src/pad/                Pad 2 tower, chopsticks, launch mount, flame trench, tank farm, Pad 1, colliders
src/env/                sky and cloud bakes, terrain with tidal pools, ocean, OSM roads, buildings, grass
src/fx/plume/           the raymarched 33-engine plume and its line light
src/fx/volume/          volumetric launch clouds (puff authoring, bakes, march, accumulation, composite)
src/post/               post chain, lighting presets, still export
src/controls/           orbit / photo / walk / fly camera, lens, collision, touch joystick
src/edu/                education layer (hotspots, cards, charts, explainers, sources), EN + FI content
src/physics/            liftoff integrator, acoustics, mass budget (pure TypeScript)
src/ui/                 UI shell: loading screen, top bar, dock, menus, lens panel, help, toasts
src/styles/             design tokens and the page frame
src/shaders/common.glsl shared GLSL (view modes, thermal ramp, fog, blackbody)
public/models/          starship.glb, pad.glb (built by blender/)
public/data/            OSM site data, pad colliders
blender/                headless Blender build scripts for the vehicle and the pad, plus preview renders
research/               research notes, specs, palette, camera calibration, reference photo (not shipped)
sandbox/                per-module development pages (npx vite, then /sandbox/<module>.html)
scripts/                headless screenshot tools (shoot.mjs, qa-shoot.mjs)
tests/                  cross-module unit tests (module tests live next to their code)
```

## Accuracy

- **Sourced values and estimates are kept apart.**
  - Every dimension and physical constant lives in `specs/starship.json` with its source (`src`) or the
    reason it is an estimate (`est`).
  - The education layer shows each number with a *sourced* or *estimate* badge, and the **Sources** tab lists every
    spec value with its status.
- **Sourced** (published or computed from a published source):
  - vehicle dimensions: stack 124 m, booster 72.3 m, ship 52.1 m; Block 3 engine counts;
  - tower height 144.5 m (OSM and the FAA filing) and the site geography (OpenStreetMap);
  - the sun: 5.7° at azimuth 95.2°, computed from an almanac for the pad at the launch time;
  - Raptor 3 thrust of 250 tf (33 × 250 tf = 80.8 MN, the published booster thrust), Isp 330 s;
  - deluge water 358,000 gal and 92 % vaporised (FAA re-evaluation, from search excerpts);
  - max-Q about T+58 s, MECO about T+140 s and hot staging about T+142 s (launch schedule sites, Spaceflight Now, NSF).
- **Estimated or judged** (each is marked in the app):
  - **Which flight it is.** Most likely Flight 14, about 85 %, inferred from the lighting and timing. The photo's
    caption and original post were not found, so the flight-specific text (payload, the booster's ending) holds only
    if that is right.
  - liftoff mass 5,400 t (published figures range from 5,300 to 5,700 t), the dry masses, the mount height of 20 m
    (it sets the freeze time of 7.2 s), the 1-D vertical flight model (firm for the first ~10 s only);
  - nozzle exit size, expansion ratio and exit pressure (Raptor 1 values reused), tile size and gap, hot-stage vent
    count;
  - the launch mount, flame trench, diverter and tank-farm details (OSM footprints plus the photo);
  - the ship's nose profile and grid-fin clocking, which follow the photo rather than the drawings;
  - the launch clouds: art-directed volumes fitted to the photo's silhouettes (IoU about 0.9), not a fluid simulation.
- **Key decisions and open items** are in `research/notes.md`; the full research is in the other `research/*.md` files.
  The physics numbers that depend on each other are pinned by tests (`tests/physics.test.ts`).
- **Reference photo.** It is used only to calibrate the camera and the look, and it is not part of the build.

## Known limitations

- **Frozen instant.** The scene is one moment. Slow drift animates the steam, the plume flicker and the beacons
  around it, but nothing moves on: no ascent, no ground shake, no sound.
- **Approximate look.** The clouds are art-directed, not simulated. Distant terrain, buildings and roads come from
  OpenStreetMap footprints and are not photogrammetry. The palette is fitted to the reference photo at the photo
  camera; the other presets and views are physically motivated, not calibrated against anything.
- **Identification.** The flight is inferred (about 85 %), not read from a caption.
- **Performance.** The 60 fps target is for *High* at 1080p on an AMD Radeon 8060S iGPU. Software rendering
  (SwiftShader) works for QA but takes minutes per converged frame. *Ultra* and 4K need a discrete GPU.
- **Input.** Walk and fly have no collision with the vehicle or the plume in fly mode; walk collision covers the pad
  structures, tanks and fences only. Touch has a joystick and drag-to-look, but the education panel is a bottom
  sheet that covers much of a phone screen.
- **Browsers.** WebGL 2 with half-float render targets is required.
- **Languages.** English and Finnish only; the education content is written for those two.

## Credits

- Map data © OpenStreetMap contributors, available under the Open Database Licence (ODbL):
  <https://www.openstreetmap.org/copyright>. The coastline, tidal flats, roads, buildings, tank farm and tower
  footprints come from it.
- three.js (MIT), pmndrs postprocessing (Zlib), lil-gui (MIT).
- This is an independent educational project. It is not affiliated with or endorsed by SpaceX.
