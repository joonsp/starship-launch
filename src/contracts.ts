// Shared contracts for every module of the Starship launch freeze-frame.
// OWNER: orchestrator. Builders import from here but never edit this file.
// If a builder needs a contract change, it says so in its final report instead.
//
// ── Conventions ─────────────────────────────────────────────────────────────
// Units: metres, seconds, kilograms, kelvin; angles in radians unless the name says Deg.
// Frame: origin = centre of the launch mount (OLM) at ground level (y = 0 is local
//        ground / mean water level of the tidal flats), x = east, y = up, z = south
//        (-z = north). three.js right-handed.
// Colour: scene-referred LINEAR HDR. Renderer toneMapping = NoToneMapping; the post
//        chain does AgX + grading. Rough radiance scale: sun-lit white diffuse ≈ 1-3,
//        sky ≈ 0.5-2, plume core ≈ 20-60 (drives bloom), fireball ≈ 5-20.
// Time: the scene is FROZEN at T_F seconds after liftoff. `globals.uTime` still
//        advances, but shaders must only use it scaled by `globals.uDrift`
//        (0 = frozen, which is the default; 1 = slow-drift mode). Frozen must look
//        perfect as a still.
// Shaders: WebGL2 / GLSL ES 3.0. Shared GLSL helpers are in src/shaders/common.glsl
//        (import with `?raw`). Every custom shader must honour uViewMode (see ViewMode).

//
// ── Frame graph (owned by src/core/pipeline.ts, the integrator) ──────────────
//  0. update(): modules update; globals (sun, plume light, camera) are refreshed.
//  1. RenderPass (pmndrs postprocessing EffectComposer, HalfFloat buffers): sky dome,
//     background cumulus/cirrus, ocean, terrain + pools, pad, vehicle. Opaque depth is
//     exposed as targets.sceneDepth (DepthTexture of the composer input buffer).
//  2. Plume pass: the plume module renders ITS OWN scene (plume.scene) into its own
//     HalfFloat RGBA target (targets.plume): rgb = premultiplied additive emission (linear),
//     a = linear view distance to the plume in metres (0 = no plume on this pixel).
//     It occludes MANUALLY by sampling targets.sceneDepth in the fragment shader (it cannot
//     share the composer's depth buffer).
//  3. Volume pass (pmndrs Pass subclass, needsDepthTexture = true, implements setDepthTexture):
//     raymarches the launch clouds at reduced resolution, stopping at the opaque depth, and
//     OWNS THE COMPOSITE. It outputs the final HDR colour:
//        out = opaque.rgb * T_total + L_inscatter + plume.rgb * T(plume.a)
//     where T(d) = the cloud transmittance from the camera to distance d along the ray.
//  4. Post effects: heat haze (masked by targets.plume) → bloom → AgX tone mapping + grade/LUT
//     → tilt-shift (lens) → SMAA → vignette / grain / chromatic aberration.
//
// ── Ownership rules ─────────────────────────────────────────────────────────
//  - Ground-level fire (the impingement fireball / hot gas in the trench and at the cloud
//    base) belongs to the VOLUME module (its emission/temperature channel). The PLUME module
//    owns only the jet column from the engine plane (anchors.vehicleBase) down to
//    anchors.plumeImpact, and it sets globals.uPlumeLight (the scene's plume line light).
//  - Nobody adds THREE lights except core (sun DirectionalLight + shadows, hemisphere
//    ambient, PMREM environment from the env module's environment scene). The plume
//    lights surfaces through src/core/material-hooks.ts, which is MANDATORY for every lit
//    MeshStandardMaterial / MeshPhysicalMaterial (applyGlobals()).
//  - Custom ShaderMaterials must implement uViewMode, fog and plume light themselves,
//    using src/shaders/common.glsl.
//
// ── GLB model-frame conventions (Blender builds; see blender/README.md) ─────
//  - Metres (set lib.py scale S = 1.0), y up in three.js after glTF export.
//  - Vehicle GLB: origin on the stack axis at the bottom edge of the booster aft skirt
//    (the engine plane); nozzles hang below y = 0. The ship's TILED windward belly faces -z.
//    The app places it at anchors.vehicleBase with rotation.y = anchors.vehicleYawDeg.
//  - Pad GLB: origin = the vehicle axis at ground level (world origin), so it needs no transform.
//    The tower is at pad.tower2_centre (-3, 0, -27) with the chopsticks reaching +z toward the
//    mount; carriage ≈ 124 m; arms open ≈ 44 m tip to tip (as in the photo); the west-side
//    boom ≈ 65 m. OLM deck top at scene.olm_deck_height (20 m), with the central booster
//    opening left clear for the plume; the trench runs east-west below ground level.

import type * as THREE from 'three';

/** Per-pixel shading mode shared by every material/shader through globals.uViewMode. */
export enum ViewMode {
  Photo = 0,   // normal physically based rendering
  Thermal = 1, // false-colour temperature: output thermalRamp(kelvin) from common.glsl
  Clay = 2,    // albedo -> 0.7 grey, no textures/detail maps; lighting unchanged
}

export type LightingPresetId = 'photo' | 'noon' | 'night' | 'thermal' | 'clay';

export interface LightingPreset {
  id: LightingPresetId;
  label: { en: string; fi: string };
  viewMode: ViewMode;
  sun: { dir: THREE.Vector3; color: THREE.Color; intensity: number }; // dir points FROM the scene TOWARD the sun
  sky: { turbidity: number; rayleigh: number; mieCoefficient: number; mieDirectionalG: number; brightness: number };
  ambient: { sky: THREE.Color; ground: THREE.Color; intensity: number };
  plumeLightScale: number;   // multiplier on the plume-as-light-source
  exposure: number;          // post exposure multiplier
  fog: { color: THREE.Color; density: number };   // aerial perspective (exp2)
  grade: { temperature: number; tint: number; contrast: number; saturation: number; lift: number; gain: number };
}

export type QualityId = 'low' | 'medium' | 'high' | 'ultra';
export type QualityChoice = QualityId | 'auto';

export interface QualitySettings {
  id: QualityId;
  pixelRatio: number;        // renderer pixel ratio cap
  volumeScale: number;       // volumetric pass resolution relative to the canvas (0.25..1)
  volumeSteps: number;       // primary raymarch steps
  volumeBakeRes: [number, number, number]; // density/light bake 3D texture resolution
  cumulusSteps: number;      // background cloud layer raymarch steps
  reflectionScale: number;   // planar reflection resolution relative to the canvas
  shadowMapSize: number;
  bloom: boolean;
  accumulate: boolean;       // progressive temporal accumulation when the camera is still
}

export type CameraModeId = 'orbit' | 'photo' | 'walk' | 'fly';

export interface LensState {
  fovDeg: number;            // vertical FOV
  dollyZoom: boolean;        // when changing FOV, keep the focus subject the same size
  rollDeg: number;           // Dutch angle
  /** focusY: centre of the sharp band measured from the TOP of the screen (0..1); band: full sharp-band height (0..1); blur: strength 0..1 (up to 1.5 accepted). */
  tiltShift: { enabled: boolean; focusY: number; band: number; blur: number };
}

/** Shared uniforms. Materials must reference these objects directly (not copies) so updates propagate. */
export interface Globals {
  uTime: THREE.IUniform<number>;
  uDrift: THREE.IUniform<number>;          // 0 frozen, 1 slow drift
  uViewMode: THREE.IUniform<number>;       // ViewMode
  uSunDir: THREE.IUniform<THREE.Vector3>;  // toward the sun, normalised
  uSunColor: THREE.IUniform<THREE.Color>;  // colour * intensity (linear)
  /** Hemisphere ambient RADIANCES (a white Lambert surface under them has this radiance; no 1/pi). */
  uSkyAmbient: THREE.IUniform<THREE.Color>;
  uGroundAmbient: THREE.IUniform<THREE.Color>;
  uFogColor: THREE.IUniform<THREE.Color>;
  uFogDensity: THREE.IUniform<number>;
  /** Plume light colour * intensity * preset.plumeLightScale (linear). OWNED by the plume module, which applies plumeLightScale in its onPreset. */
  uPlumeLight: THREE.IUniform<THREE.Color>;
  uPlumeAxisA: THREE.IUniform<THREE.Vector3>;     // plume segment start (engine plane centre)
  uPlumeAxisB: THREE.IUniform<THREE.Vector3>;     // plume segment end (ground impingement point)
  uCameraPos: THREE.IUniform<THREE.Vector3>;
  uResolution: THREE.IUniform<THREE.Vector2>;     // drawing-buffer pixels
  uFrame: THREE.IUniform<number>;                 // frame index since the last accumulation reset (core resets it on camera-moved/preset/quality/drift/reset-accumulation)
}

/** Named positions in the world frame (filled from specs; see src/scene-config.ts). */
export interface Anchors {
  olmCentre: THREE.Vector3;          // (0,0,0)
  olmTableTopY: number;              // height of the launch-mount deck the vehicle sat on
  vehicleBase: THREE.Vector3;        // centre of the booster engine plane at T_F
  vehicleTiltDeg: number;            // lean from vertical at T_F (about vehicleTiltAxis)
  vehicleTiltAxis: THREE.Vector3;
  vehicleYawDeg: number;             // rotation of the stack about its own axis (which side faces the photo camera)
  towerBase: THREE.Vector3;          // centre of the tower footprint at ground level
  towerHeight: number;
  plumeImpact: THREE.Vector3;        // where the plume hits the deflector/trench
  photoCamera: { pos: THREE.Vector3; target: THREE.Vector3; fovDeg: number; rollDeg: number };
  walkSpawn: { pos: THREE.Vector3; yawDeg: number };
  volumeBounds: THREE.Box3;          // launch-cloud volume domain
}

export type AppEvent =
  | { type: 'preset'; preset: LightingPreset }
  | { type: 'quality'; quality: QualitySettings }
  | { type: 'camera-moved' }         // any camera/lens change -> reset progressive accumulation
  | { type: 'camera-mode'; mode: CameraModeId }
  | { type: 'lang'; lang: Lang }
  | { type: 'edu'; enabled: boolean }
  | { type: 'drift'; enabled: boolean }
  | { type: 'reset-accumulation' };

export type Lang = 'en' | 'fi';

export interface Emitter {
  on<T extends AppEvent['type']>(type: T, fn: (e: Extract<AppEvent, { type: T }>) => void): () => void;
  emit(e: AppEvent): void;
}

/** Axis-aligned or oriented box collider for first-person walking (world metres). */
export interface Collider {
  id: string;
  kind: 'box' | 'cylinder';
  centre: [number, number, number];
  size?: [number, number, number];       // box full extents (before rotation)
  rotationY?: number;                    // box yaw (radians)
  radius?: number;                       // cylinder (vertical axis)
  height?: number;
}

/** Educational hotspot anchored in 3D. Content keys resolve in src/edu/content.{en,fi}.ts */
export interface Hotspot {
  id: string;
  position: THREE.Vector3;               // world anchor
  contentKey: string;
  category: 'vehicle' | 'pad' | 'fx' | 'physics';
  priority: number;                      // label collision priority (higher wins)
}

/** Render targets shared between passes. Filled in by core/pipeline.ts each frame. */
export interface SharedTargets {
  /** Opaque scene depth (after the main RenderPass). Perspective depth, 0..1 (DepthTexture). */
  sceneDepth: THREE.DepthTexture | null;
  /** Plume emission: rgb = premultiplied linear emission (additive); a = LINEAR distance along the view ray in metres (not view-space z); 0 = none. May be lower resolution than the drawing buffer. */
  plume: THREE.Texture | null;
}

export interface AppContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;                    // main opaque/transparent scene
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;                   // overlay root for DOM UI
  globals: Globals;
  anchors: Anchors;
  quality: QualitySettings;
  preset: LightingPreset;
  lang: Lang;
  events: Emitter;
  targets: SharedTargets;
  colliders: Collider[];                 // pad module pushes; controls read
  hotspots: Hotspot[];                   // modules push their hotspots; edu reads
  /** Render an arbitrary view of the full scene (sky, opaques, volume at low quality) into a target. Used by planar reflection.
   *  Pass a PerspectiveCamera and a target WITH a depthTexture (the volume marches up to that depth). Provided by core; a no-op stub in sandboxes. */
  renderView(camera: THREE.Camera, target: THREE.WebGLRenderTarget, opts?: { volume?: boolean }): void;
}

export interface Module {
  readonly name: string;
  init(ctx: AppContext): Promise<void> | void;
  update?(dt: number, t: number): void;  // t = seconds since app start (NOT launch time)
  onPreset?(p: LightingPreset): void;
  onQuality?(q: QualitySettings): void;
  dispose?(): void;
}
