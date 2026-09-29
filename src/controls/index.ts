// Public entry of the camera controls module. OWNER: src/controls.
//   import { CameraController } from './controls/index.ts';
export { CameraController } from './CameraController.ts';
export type { CameraControllerOptions, CameraPose, FlyToPose, MoveInput, Vec3Like } from './CameraController.ts';
export { dollyDistance, apparentSize, applyRoll, FOV_MIN, FOV_MAX, ROLL_MIN, ROLL_MAX } from './math.ts';
export { moveHorizontal, resolveXZ, supportHeight, circleVsCollider, BODY_RADIUS, BODY_HEIGHT, STEP_HEIGHT } from './collision.ts';
