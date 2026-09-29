// Pure, DOM-free helpers of the camera controller (unit-tested in tests/controls.test.ts).
// OWNER: src/controls. Conventions follow src/contracts.ts (metres, radians unless the name says Deg).
import type { LensState } from '../contracts.ts';

export const DEG = Math.PI / 180;

/** Lens limits enforced by CameraController.setLens (match the UI slider ranges). */
export const FOV_MIN = 10;
export const FOV_MAX = 110;
export const ROLL_MIN = -45;
export const ROLL_MAX = 45;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent exponential approach: returns `current` moved toward `target` with rate `lambda` (1/s). */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export const clampFov = (fovDeg: number): number => clamp(fovDeg, FOV_MIN, FOV_MAX);
export const clampRoll = (rollDeg: number): number => clamp(rollDeg, ROLL_MIN, ROLL_MAX);

/**
 * Dolly-zoom distance. A subject at distance d with vertical FOV f0 fills the same fraction of the frame at
 * distance d' with FOV f1 when d * tan(f0/2) = d' * tan(f1/2):   d' = d * tan(f0/2) / tan(f1/2).
 * Narrower FOV -> the camera backs away (flat, telephoto look); wider FOV -> it moves in (exaggerated perspective).
 */
export function dollyDistance(d: number, fovFromDeg: number, fovToDeg: number): number {
  return (d * Math.tan((fovFromDeg * DEG) / 2)) / Math.tan((fovToDeg * DEG) / 2);
}

/** The apparent size (in units of the frame height) of a subject of height h at distance d for vertical FOV f. */
export function apparentSize(h: number, d: number, fovDeg: number): number {
  return h / (2 * d * Math.tan((fovDeg * DEG) / 2));
}

/**
 * Dutch angle. MUST be called AFTER the pose was set (OrbitControls.update() ends with lookAt(), which resets the
 * orientation every frame, so a roll applied afterwards never accumulates and never fights the controls).
 * Same sign convention as applyPhotoCamera in scene-config: positive = clockwise, right side down.
 */
export function applyRoll(obj: { rotateZ(angle: number): unknown }, rollDeg: number): void {
  if (rollDeg !== 0) obj.rotateZ(-rollDeg * DEG);
}

/** Unit forward vector for a compass heading (deg from north, clockwise) and pitch (radians); writes into `out`. */
export function forwardFromYawPitch(yaw: number, pitch: number, out: { x: number; y: number; z: number }): void {
  const cp = Math.cos(pitch);
  out.x = Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
}

export function defaultLens(fovDeg: number): LensState {
  return { fovDeg, dollyZoom: false, rollDeg: 0, tiltShift: { enabled: false, focusY: 0.5, band: 0.2, blur: 0.5 } };
}

export function cloneLens(l: LensState): LensState {
  return { fovDeg: l.fovDeg, dollyZoom: l.dollyZoom, rollDeg: l.rollDeg, tiltShift: { ...l.tiltShift } };
}
