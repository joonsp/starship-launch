// Scene-wide configuration derived from specs/starship.json. OWNER: orchestrator.
// Anchors, the photo camera, the canonical "photo" lighting preset and the quality presets.
import * as THREE from 'three';
import type { Anchors, LightingPreset, QualityId, QualitySettings } from './contracts.ts';
import { ViewMode } from './contracts.ts';
import { val, vec3 } from './specs.ts';

const DEG = Math.PI / 180;

/** Seconds after liftoff at which the scene is frozen (see spec scene.t_freeze; the physics module recomputes it). */
export const T_F = val('scene.t_freeze');

/** Direction (unit vector) for a compass heading (deg from true north, clockwise) and an elevation (deg above horizontal). */
export function dirFromHeading(headingDeg: number, elevDeg: number): THREE.Vector3 {
  const h = headingDeg * DEG, e = elevDeg * DEG;
  return new THREE.Vector3(Math.sin(h) * Math.cos(e), Math.sin(e), -Math.cos(h) * Math.cos(e)).normalize();
}

export const SUN_DIR = dirFromHeading(val('scene.sun_azimuth'), val('scene.sun_altitude'));

const camPos = new THREE.Vector3(...vec3('scene.camera.pos'));
const camDir = dirFromHeading(val('scene.camera.heading'), val('scene.camera.pitch'));
const towerC = vec3('pad.tower2_centre');
const vMin = vec3('scene.volume_bounds_min');
const vMax = vec3('scene.volume_bounds_max');

export const ANCHORS: Anchors = {
  olmCentre: new THREE.Vector3(0, 0, 0),
  olmTableTopY: val('scene.olm_deck_height'),
  vehicleBase: new THREE.Vector3(0, val('scene.vehicle_base_height'), 0),
  // Lean toward the photo camera's right (bearing 116.8 deg), i.e. rotation about axis = up x right.
  vehicleTiltDeg: val('scene.vehicle_tilt'),
  vehicleTiltAxis: new THREE.Vector3(0.451, 0, -0.893).normalize(),
  // Stack yaw: the ship's tiled windward belly faces the photo camera (bearing ~206 deg from the pad).
  // Convention: yaw 0 = belly toward -z (north); positive = counter-clockwise seen from above (three.js rotation.y).
  vehicleYawDeg: 180 - 25.9 + 0, // belly toward camera (south-south-west)
  towerBase: new THREE.Vector3(towerC[0], 0, towerC[2]),
  towerHeight: val('pad.tower2_height'),
  plumeImpact: new THREE.Vector3(0, -4, 0),
  photoCamera: {
    pos: camPos.clone(),
    target: camPos.clone().addScaledVector(camDir, 700),
    fovDeg: val('scene.camera.vfov'),
    rollDeg: val('scene.camera.roll'),
  },
  walkSpawn: { pos: new THREE.Vector3(20, 1.7, 75), yawDeg: 345 },
  volumeBounds: new THREE.Box3(new THREE.Vector3(...vMin), new THREE.Vector3(...vMax)),
};

/** Apply the calibrated photo camera to a PerspectiveCamera (also sets aspect-independent vertical FOV). */
export function applyPhotoCamera(cam: THREE.PerspectiveCamera): void {
  const p = ANCHORS.photoCamera;
  cam.position.copy(p.pos);
  cam.up.set(0, 1, 0);
  cam.lookAt(p.target);
  cam.rotateZ(-p.rollDeg * DEG);
  cam.fov = p.fovDeg;
  cam.near = 0.5;
  cam.far = 60000;
  cam.updateProjectionMatrix();
}

/** Canonical golden-hour preset matching the reference photo. Other presets live in src/post/presets.ts. */
export const PHOTO_PRESET: LightingPreset = {
  id: 'photo',
  label: { en: 'Photo (sunrise)', fi: 'Valokuva (auringonnousu)' },
  viewMode: ViewMode.Photo,
  sun: { dir: SUN_DIR.clone(), color: new THREE.Color(1.0, 0.74, 0.48), intensity: 3.2 },
  sky: { turbidity: 3.5, rayleigh: 1.6, mieCoefficient: 0.004, mieDirectionalG: 0.82, brightness: 1.0 },
  ambient: { sky: new THREE.Color(0.32, 0.46, 0.72), ground: new THREE.Color(0.16, 0.13, 0.1), intensity: 0.9 },
  plumeLightScale: 1.0,
  exposure: 1.0,
  fog: { color: new THREE.Color(0.62, 0.7, 0.8), density: 0.00007 },
  grade: { temperature: 0.08, tint: 0.0, contrast: 1.08, saturation: 1.12, lift: 0.0, gain: 1.0 },
};

export const QUALITY: Record<QualityId, QualitySettings> = {
  low:    { id: 'low',    pixelRatio: 1,    volumeScale: 0.33, volumeSteps: 48,  volumeBakeRes: [160, 64, 96],   cumulusSteps: 24, reflectionScale: 0.25, shadowMapSize: 1024, bloom: true, accumulate: true },
  medium: { id: 'medium', pixelRatio: 1,    volumeScale: 0.5,  volumeSteps: 80,  volumeBakeRes: [224, 80, 128],  cumulusSteps: 40, reflectionScale: 0.35, shadowMapSize: 2048, bloom: true, accumulate: true },
  high:   { id: 'high',   pixelRatio: 1.5,  volumeScale: 0.5,  volumeSteps: 128, volumeBakeRes: [288, 104, 168], cumulusSteps: 56, reflectionScale: 0.5,  shadowMapSize: 4096, bloom: true, accumulate: true },
  ultra:  { id: 'ultra',  pixelRatio: 2,    volumeScale: 0.75, volumeSteps: 192, volumeBakeRes: [384, 128, 224], cumulusSteps: 80, reflectionScale: 0.5,  shadowMapSize: 4096, bloom: true, accumulate: true },
};

/** Pad-complex yaw (three.js rotation.y, radians). Local +x (the trench axis) maps to world (0.838, 0, 0.546),
 *  i.e. bearing 123 deg (ESE-WNW), from the OSM flame-trench polygon. The trench, mount, apron and fire axis all use it. */
export const PAD_YAW = val('scene.trench_yaw') * DEG;
/** Flame-trench opening in the terrain, in PAD-LOCAL coordinates (rotate world points by -PAD_YAW about y first).
 *  The env module cuts it; the pad module fills it. */
export const TRENCH_CUTOUT = { halfX: 40, halfZ: 16, yaw: PAD_YAW };
/** Concrete pad apron owned by the pad module, in PAD-LOCAL coordinates (same yaw). */
export const APRON = { minX: -90, maxX: 90, minZ: -70, maxZ: 70, topY: 0.12, yaw: PAD_YAW };
/** World -> pad-local (x along the trench axis). */
export function toPadLocal(x: number, z: number): [number, number] {
  const c = Math.cos(PAD_YAW), s = Math.sin(PAD_YAW);
  // inverse of rotation.y(PAD_YAW): local = R(-yaw) * world
  return [c * x - s * z, s * x + c * z];
}
