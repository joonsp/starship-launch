// Camera modes and lens controls. OWNER: src/controls.
//
// Modes (CameraModeId):
//   orbit  OrbitControls around the stack (damped, 15 m .. 8 km, never below the ground).
//   photo  the calibrated reference-photo camera (eased fly-to); the first drag / wheel turns it into orbit.
//   walk   first person on the pad: pointer-lock mouse look, WASD / arrows, Shift sprint, Ctrl "hyper" toggle,
//          Space jump, capsule collision against ctx.colliders (slide response, sub-stepped), touch joystick fallback.
//   fly    free drone: WASD + Q/E (or Space) for altitude, wheel = speed 1..200 m/s, smooth acceleration.
// Lens: vertical FOV 10..110 deg (optionally as a DOLLY ZOOM), Dutch roll -45..45 deg, tilt-shift state (rendered by
// the post module; this class only owns and emits the state).
//
// Per-frame order in update(): [transition tween | mode step] -> pose -> ROLL (after OrbitControls' lookAt, so it never
// fights the controls) -> fov -> emit 'camera-moved' once if pose / fov / roll changed.
//
// Integration (see the module report): construct, `await init(ctx)`, call update(dt, t) every frame BEFORE the render,
// subscribe to ctx.events 'camera-mode' and to onLensChange() to keep the UI shell and the post module in sync.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AppContext, CameraModeId, LensState, Module } from '../contracts.ts';
import { APRON, dirFromHeading } from '../scene-config.ts';
import { BODY_HEIGHT, BODY_RADIUS, STEP_HEIGHT, moveHorizontal, supportHeight } from './collision.ts';
import {
  DEG, applyRoll, clamp, clampFov, clampRoll, cloneLens, damp, defaultLens, dollyDistance, easeInOutCubic, forwardFromYawPitch,
} from './math.ts';
import { VirtualJoystick } from './touch.ts';

export type Vec3Like = THREE.Vector3 | readonly [number, number, number];

export interface FlyToPose { pos: Vec3Like; target: Vec3Like; fovDeg?: number }

/** Scripted input for debugMove() (QA): axes are -1..1 and held for the whole duration. */
export interface MoveInput {
  forward?: number;   // +1 = forward
  right?: number;     // +1 = strafe right
  up?: number;        // fly only: +1 = ascend
  sprint?: boolean;   // Shift (walk: 6 m/s; fly: x3 boost)
  hyper?: boolean;    // walk: 40 m/s for the duration of the call
  jump?: boolean;     // walk: Space held
  crouch?: boolean;   // walk: C held
  yawDeg?: number;    // set the absolute compass heading first
  pitchDeg?: number;  // set the absolute pitch first
}

export interface CameraPose {
  mode: CameraModeId;
  pos: [number, number, number];
  /** Soles position in walk mode (equals `pos` minus eye height), else the camera position. */
  feet: [number, number, number];
  yawDeg: number;    // compass heading of the view direction, 0 = north, clockwise
  pitchDeg: number;
  fovDeg: number;
  rollDeg: number;
  grounded: boolean;
  speed: number;     // current horizontal speed (walk) or speed (fly), m/s
}

export interface CameraControllerOptions {
  /** Handle the 1-4, R, [ ], comma, period hotkeys (skipped when another handler already called preventDefault). Default true. */
  hotkeys?: boolean;
  /** Touch joystick: 'auto' shows it after the first touch on the canvas / on coarse-pointer devices. Default 'auto'. */
  touch?: 'auto' | boolean;
  /** Request pointer lock on a mouse press in walk / fly (default true). Drag-to-look always works without it. */
  pointerLock?: boolean;
  /** Mode the app opens in. The pose is always the calibrated photo camera. Default 'orbit'. */
  initialMode?: CameraModeId;
  /** Terrain height under (x, z) for walking / altitude limits. Default: apron top (0.12 m) inside APRON, else 0. */
  groundHeight?: (x: number, z: number) => number;
}

// ── Tuning constants ──────────────────────────────────────────────────────────────────────────────────────────────
const ORBIT_MIN_DIST = 15;
const ORBIT_MAX_DIST = 8000;
const ORBIT_MIN_ALT = 2;         // camera stays this far above the ground in orbit / photo
const FLY_MIN_ALT = 1;
const EYE_HEIGHT = 1.7;
const EYE_CROUCH = 1.0;
const WALK_SPEED = 1.6;
const SPRINT_SPEED = 6;
const HYPER_SPEED = 40;
const GRAVITY = 9.81;
const JUMP_SPEED = 4.4;
const WALK_BOUNDS = 4000;
const FLY_BOUNDS = 30000;
const FLY_SPEED_MIN = 1;
const FLY_SPEED_MAX = 200;
const LOOK_SENS = 0.0022;        // rad per pixel
const LOCK_SETTLE_MS = 250;      // ignore mouse movement this long after the pointer lock engages (first-event glitch)
const LOOK_SPIKE = 1000;         // px: an absurd single delta is a driver glitch, not a flick
const PITCH_LIMIT = 88 * DEG;
const PHOTO_SECONDS = 1.2;
const STACK_CENTRE = new THREE.Vector3(0, 100, 0);
const WALK_NEAR = 0.12;          // walk mode pulls the near plane in so a wall 0.35 m away is not clipped
const WALK_PITCH = 3 * DEG;      // slight upward tilt at the spawn so the tower base reads as tall

const MOVE_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyQ', 'KeyE', 'KeyC', 'Space', 'ShiftLeft', 'ShiftRight',
]);

interface Transition {
  fromPos: THREE.Vector3; toPos: THREE.Vector3;
  fromTgt: THREE.Vector3; toTgt: THREE.Vector3;
  fromFov: number; toFov: number;
  fromRoll: number; toRoll: number;
  fromBase: number; toBase: number;
  t: number; dur: number; arc: number;
  endMode: CameraModeId;
  /** Walk focus-in-place: keep the walk body (feet, velocity) instead of re-deriving it from the end pose. */
  keepBody: boolean;
  /** A pointer press / wheel during the tween cancels it and hands the camera to the user. */
  interruptible: boolean;
  resolve: () => void;
}

interface LensAnim { f0: number; f1: number; r0: number; r1: number; t: number; dur: number }

const v3 = (v: Vec3Like): THREE.Vector3 => (v instanceof THREE.Vector3 ? v.clone() : new THREE.Vector3(v[0], v[1], v[2]));
const wrapDeg = (d: number): number => ((d % 360) + 360) % 360;

function isTextEntry(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  if (tag === 'INPUT') return /^(text|search|number|email|url|password|tel|)$/i.test((el as HTMLInputElement).type);   // sliders / checkboxes keep the hotkeys
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

export class CameraController implements Module {
  readonly name = 'controls';

  /** Live lens state (mutated in place by setLens/resetLens/transitions). Treat as read-only; listeners get copies. */
  readonly lens: LensState;

  private ctx!: AppContext;
  private camera!: THREE.PerspectiveCamera;
  private canvas!: HTMLCanvasElement;
  private orbit!: OrbitControls;
  private mode: CameraModeId = 'orbit';
  private readonly opts: Required<Omit<CameraControllerOptions, 'groundHeight'>> & { groundHeight?: CameraControllerOptions['groundHeight'] };
  private groundFn: (x: number, z: number) => number = (x, z) =>
    (x >= APRON.minX && x <= APRON.maxX && z >= APRON.minZ && z <= APRON.maxZ ? APRON.topY : 0);

  private readonly lensListeners = new Set<(l: LensState) => void>();
  private lensSnap: LensState = defaultLens(45);
  private lensAnim: LensAnim | null = null;
  private tr: Transition | null = null;
  /** Interpolated look-at point of the running transition (also the orbit target while it runs). */
  private readonly trTgt = new THREE.Vector3();
  /** Calibrated photo roll, kept while the view is still the photo composition, faded out once the user moves. */
  private baseRoll = 0;
  private userMoved = false;
  private lastOrbit: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;

  // Walk state. `feet` are the soles; the camera eye is feet + eye height (+ step smoothing + head bob).
  private readonly walk = {
    feet: new THREE.Vector3(), vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0, grounded: true, hyper: false,
    eye: EYE_HEIGHT, stepOffset: 0, bobPhase: 0, bobAmp: 0, speed: 0,
  };
  // Fly state.
  private readonly fly = {
    vel: new THREE.Vector3(), yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, speed: 40,
  };

  // Input.
  private readonly keys = new Set<string>();
  private lookDX = 0;
  private lookDY = 0;
  private dragging = false;
  private dragId = -1;
  private lastX = 0;
  private lastY = 0;
  private lastTap = 0;
  private lockedAt = 0;
  private jumpQueued = false;
  private joystick: VirtualJoystick | null = null;
  private touchSeen = false;
  private disposers: Array<() => void> = [];

  // Change detection for 'camera-moved'.
  private readonly lastPos = new THREE.Vector3(NaN, NaN, NaN);
  private readonly lastQuat = new THREE.Quaternion();
  private lastFov = NaN;
  private baseNear = 0.5;

  // Scratch.
  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _v3 = new THREE.Vector3();
  private readonly _e = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(options: CameraControllerOptions = {}) {
    this.opts = { hotkeys: true, touch: 'auto', pointerLock: true, initialMode: 'orbit', ...options };
    if (options.groundHeight) this.groundFn = options.groundHeight;
    this.lens = defaultLens(45);
  }

  // ── Module lifecycle ───────────────────────────────────────────────────────────────────────────────────────────

  init(ctx: AppContext): void {
    this.ctx = ctx;
    this.camera = ctx.camera;
    this.canvas = ctx.canvas;
    this.baseNear = ctx.camera.near;
    const photo = ctx.anchors.photoCamera;
    Object.assign(this.lens, defaultLens(photo.fovDeg));

    const o = (this.orbit = new OrbitControls(this.camera, this.canvas));
    o.enableDamping = true;
    o.dampingFactor = 0.07;
    o.rotateSpeed = 0.8;
    o.zoomSpeed = 1.0;
    o.minDistance = ORBIT_MIN_DIST;
    o.maxDistance = ORBIT_MAX_DIST;
    o.maxTargetRadius = ORBIT_MAX_DIST;
    o.screenSpacePanning = true;
    o.addEventListener('start', this.onOrbitStart);

    // Start on the calibrated photo composition (a still of the reference photo), whatever the initial mode.
    this.camera.position.copy(photo.pos);
    o.target.copy(photo.target);
    this.baseRoll = photo.rollDeg;
    this.camera.fov = this.lens.fovDeg;
    this.camera.updateProjectionMatrix();
    o.update();
    this.mode = this.opts.initialMode === 'photo' ? 'photo' : 'orbit';

    const on = <K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void, capture = false): void => {
      window.addEventListener(t, fn as EventListener, capture);
      this.disposers.push(() => window.removeEventListener(t, fn as EventListener, capture));
    };
    on('keydown', this.onKeyDown);
    on('keyup', this.onKeyUp);
    on('blur', () => this.keys.clear());
    on('pointermove', this.onPointerMove);
    on('pointerup', this.onPointerUp);
    on('pointercancel', this.onPointerUp);
    // Capture phase on the canvas: a press during a transition cancels it BEFORE OrbitControls reads the event.
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onPointerDown, true);
    c.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    this.disposers.push(() => c.removeEventListener('pointerdown', this.onPointerDown, true));
    this.disposers.push(() => c.removeEventListener('wheel', this.onWheel, true));
    const dl = (): void => { if (document.pointerLockElement === this.canvas) this.lockedAt = performance.now(); else this.dragging = false; };
    document.addEventListener('pointerlockchange', dl);
    this.disposers.push(() => document.removeEventListener('pointerlockchange', dl));

    if (this.opts.touch === true || (this.opts.touch === 'auto' && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)) this.enableTouch();

    this.lensSnap = cloneLens(this.lens);
    if (this.opts.initialMode === 'walk' || this.opts.initialMode === 'fly') this.setMode(this.opts.initialMode, { instant: true });
  }

  update(dt: number, _t?: number): void {
    if (!this.ctx) return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.stepLensAnim(dt);
    if (this.tr) this.stepTransition(dt);
    else {
      this.stepBaseRoll(dt);
      switch (this.mode) {
        case 'orbit': case 'photo': this.updateOrbit(dt); break;
        case 'walk': this.stepWalk(dt, this.readInput()); this.poseWalk(true); break;
        case 'fly': this.stepFly(dt, this.readInput()); this.poseFly(); break;
      }
    }
    this.finishFrame();
  }

  dispose(): void {
    this.cancelTransition();
    this.exitLock();
    for (const d of this.disposers) d();
    this.disposers = [];
    this.orbit?.removeEventListener('start', this.onOrbitStart);
    this.orbit?.dispose();
    this.joystick?.dispose();
    this.joystick = null;
    this.lensListeners.clear();
  }

  // ── Public API ─────────────────────────────────────────────────────────────────────────────────────────────────

  getMode(): CameraModeId { return this.mode; }

  /** Replace the terrain height function used for walking and altitude limits. */
  setGroundHeight(fn: (x: number, z: number) => number): void { this.groundFn = fn; }

  /** True while the pointer is captured by the canvas (walk / fly mouse look). */
  get pointerLocked(): boolean { return document.pointerLockElement === this.canvas; }

  /** Walk-mode 40 m/s "hyper" toggle state (Ctrl). */
  get hyper(): boolean { return this.walk.hyper; }
  set hyper(v: boolean) { this.walk.hyper = v; }

  /** Fly speed in m/s (wheel). */
  get flySpeed(): number { return this.fly.speed; }
  set flySpeed(v: number) { this.fly.speed = clamp(v, FLY_SPEED_MIN, FLY_SPEED_MAX); }

  /**
   * Switch camera mode with an eased fly-to (no snapping). Walk flies to anchors.walkSpawn; photo flies to the calibrated
   * photo camera; orbit from walk/fly flies back to the last orbit pose; fly simply detaches from the current pose.
   * `instant` skips the tween (QA); `seconds` overrides the duration. Emits 'camera-mode'.
   */
  setMode(m: CameraModeId, o: { instant?: boolean; seconds?: number } = {}): void {
    if (!this.ctx || m === this.mode) return;
    const prev = this.mode;
    const cur = this.currentPose();
    if (this.tr) this.cancelTransition(false);
    if (prev === 'orbit' || prev === 'photo') this.lastOrbit = { pos: cur.pos.clone(), target: this.orbit.target.clone() };
    if (prev === 'walk' || prev === 'fly') this.exitLock();
    this.mode = m;
    const photo = this.ctx.anchors.photoCamera;
    const instant = !!o.instant;

    switch (m) {
      case 'photo':
        this.userMoved = false;
        this.beginMove(photo.pos, photo.target, { seconds: o.seconds ?? PHOTO_SECONDS, instant, fov: photo.fovDeg, roll: 0, base: photo.rollDeg, endMode: 'photo', from: cur });
        break;
      case 'orbit': {
        this.userMoved = true;
        if (prev === 'photo') { this.resetOrbitState(cur.tgt); this.orbit.enabled = true; break; }   // same pose, just stop holding the photo roll
        const home = this.lastOrbit ?? { pos: photo.pos, target: photo.target };
        this.beginMove(home.pos, home.target, { seconds: o.seconds, instant, base: 0, endMode: 'orbit', from: cur });
        break;
      }
      case 'walk': {
        this.userMoved = true;
        const sp = this.ctx.anchors.walkSpawn;
        const pos = sp.pos.clone();
        const gy = this.groundFn(pos.x, pos.z);
        if (pos.y < gy + EYE_HEIGHT) pos.y = gy + EYE_HEIGHT;
        const fwd = dirFromHeading(sp.yawDeg, WALK_PITCH / DEG);
        this.beginMove(pos, pos.clone().addScaledVector(fwd, 40), { seconds: o.seconds ?? 1.6, instant, base: 0, endMode: 'walk', from: cur, interruptible: false });
        break;
      }
      case 'fly':
        this.userMoved = true;
        this.initFlyFromCamera();
        break;
    }
    this.ctx.events.emit({ type: 'camera-mode', mode: m });
  }

  /** Merge a partial lens update. FOV changes dolly the camera when `dollyZoom` is on. Emits camera-moved + lens change. */
  setLens(p: Partial<LensState>): void {
    const l = this.lens;
    if (p.dollyZoom !== undefined) l.dollyZoom = !!p.dollyZoom;
    if (p.tiltShift) {
      const t = { ...l.tiltShift, ...p.tiltShift };
      Object.assign(l.tiltShift, { enabled: !!t.enabled, focusY: clamp(t.focusY, 0, 1), band: clamp(t.band, 0, 1), blur: clamp(t.blur, 0, 1.5) });   // in place: GUI bindings keep working
    }
    if (p.fovDeg !== undefined) {
      const f = clampFov(p.fovDeg);
      if (Math.abs(f - l.fovDeg) > 1e-9) {
        this.lensAnim = null;
        if (this.tr) { this.tr.fromFov = this.tr.toFov = f; }
        else if (l.dollyZoom) this.dollyMove(l.fovDeg, f);
        l.fovDeg = f;
      }
    }
    if (p.rollDeg !== undefined) {
      const r = clampRoll(p.rollDeg);
      this.lensAnim = null;
      if (this.tr) this.tr.fromRoll = this.tr.toRoll = r;
      l.rollDeg = r;
    }
    this.syncCameraFov();
    this.notifyLens(true);
    this.ctx?.events.emit({ type: 'camera-moved' });
  }

  /** Back to the calibrated lens: photo FOV, no roll, no dolly zoom, tilt-shift off. FOV and roll ease in 0.4 s; the camera does not move. */
  resetLens(): void {
    const d = defaultLens(this.ctx.anchors.photoCamera.fovDeg);
    this.lens.dollyZoom = false;
    Object.assign(this.lens.tiltShift, d.tiltShift);
    if (this.tr) { this.tr.toFov = d.fovDeg; this.tr.toRoll = 0; }
    else this.lensAnim = { f0: this.lens.fovDeg, f1: d.fovDeg, r0: this.lens.rollDeg, r1: 0, t: 0, dur: 0.4 };
    this.notifyLens(true);
    this.ctx.events.emit({ type: 'camera-moved' });
  }

  /** Subscribe to lens changes (fov/roll/dolly/tilt-shift, also while transitions animate them). Returns an unsubscribe. */
  onLensChange(cb: (lens: LensState) => void): () => void {
    this.lensListeners.add(cb);
    return () => this.lensListeners.delete(cb);
  }

  /**
   * Eased fly-to of the camera. From orbit/photo it ends in orbit around `target`; from fly it stays in fly; from walk it
   * leaves walk for orbit. Resolves when the motion ends (or is cancelled by the user).
   */
  flyTo(pose: FlyToPose, seconds = 1.5): Promise<void> {
    this.detachToOrbit();
    return this.beginMove(v3(pose.pos), v3(pose.target), {
      seconds, instant: seconds <= 0, fov: pose.fovDeg !== undefined ? clampFov(pose.fovDeg) : undefined, base: 0, endMode: this.mode,
    });
  }

  /**
   * Frame `point` (hotspots): keeps the current viewing direction and flies to `distance` metres from it (default 40 % of
   * the current distance, 20..600 m). In walk mode the player only turns to look at the point.
   */
  focusOn(point: Vec3Like, distance?: number, seconds = 1.3): Promise<void> {
    const p = v3(point);
    if (this.mode === 'walk') {
      this.userMoved = true;
      return this.beginMove(this.camera.position.clone(), p, { seconds: Math.min(seconds, 0.9), base: 0, endMode: 'walk', keepBody: true, interruptible: false });
    }
    if (this.mode !== 'fly') this.detachToOrbit();
    this.userMoved = true;
    const dir = this._v1.copy(this.camera.position).sub(p);
    const cur = dir.length();
    if (cur < 1e-3) dir.set(0, 0.2, 1);
    dir.normalize();
    const dist = clamp(distance ?? cur * 0.4, 5, ORBIT_MAX_DIST);
    return this.beginMove(p.clone().addScaledVector(dir, dist), p, { seconds, base: 0, endMode: this.mode });
  }

  /** Leave photo / walk for orbit at the current pose (no tween) so a fly-to can start from here. */
  private detachToOrbit(): void {
    this.userMoved = true;
    if (this.mode === 'orbit' || this.mode === 'fly') return;
    const cur = this.currentPose();
    if (this.tr) this.cancelTransition(false);
    if (this.mode === 'walk') this.exitLock();
    this.mode = 'orbit';
    this.resetOrbitState(cur.tgt);
    this.orbit.enabled = true;
    this.ctx.events.emit({ type: 'camera-mode', mode: 'orbit' });
  }

  /** Request pointer lock on the canvas (walk / fly). Also happens automatically on a mouse press in those modes. */
  requestLock(): void {
    this.lockedAt = performance.now();   // the glitchy first delta can arrive before pointerlockchange: settle from the request on
    try {
      const r = this.canvas.requestPointerLock?.() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => { /* denied / unsupported: drag-look still works */ });
    } catch { /* ignore */ }
  }

  /**
   * Put the camera at `pos` (the EYE position in walk mode) facing `yawDeg` / `pitchDeg` (compass heading, 0 = north), no
   * tween. Works in walk and fly; in orbit / photo it moves the camera and keeps the orbit target. For deep links and QA.
   */
  teleport(pos: Vec3Like, yawDeg?: number, pitchDeg?: number): void {
    if (this.tr) this.finishTransition();
    const p = v3(pos);
    const yaw = yawDeg !== undefined ? yawDeg * DEG : undefined;
    const pitch = pitchDeg !== undefined ? clamp(pitchDeg * DEG, -PITCH_LIMIT, PITCH_LIMIT) : undefined;
    if (this.mode === 'walk') {
      const w = this.walk;
      w.feet.set(p.x, p.y - EYE_HEIGHT, p.z);
      w.vx = w.vz = w.vy = 0; w.stepOffset = 0; w.speed = 0;
      w.grounded = w.feet.y <= this.groundFn(p.x, p.z) + 0.05;
      if (yaw !== undefined) w.yaw = yaw;
      if (pitch !== undefined) w.pitch = pitch;
      this.poseWalk(false);
    } else if (this.mode === 'fly') {
      this.camera.position.copy(p);
      this.fly.vel.set(0, 0, 0);
      if (yaw !== undefined) this.fly.yaw = this.fly.tYaw = yaw;
      if (pitch !== undefined) this.fly.pitch = this.fly.tPitch = pitch;
      this.poseFly();
    } else {
      this.camera.position.copy(p);
      if (yaw !== undefined || pitch !== undefined) {
        const cur = this.camera.getWorldDirection(this._v1);
        const y = yaw ?? Math.atan2(cur.x, -cur.z), pi = pitch ?? Math.asin(clamp(cur.y, -1, 1));
        const d = new THREE.Vector3(); forwardFromYawPitch(y, pi, d);
        this.orbit.target.copy(p).addScaledVector(d, Math.max(15, p.distanceTo(this.orbit.target)));
      }
      this.resetOrbitState(this.orbit.target);
      this.updateOrbit(0);
    }
    this.finishFrame();
  }

  /** Current pose for HUDs and QA. */
  getPose(): CameraPose {
    const cam = this.camera;
    const f = cam.getWorldDirection(this._v1);
    const w = this.walk;
    const walking = this.mode === 'walk';
    return {
      mode: this.mode,
      pos: [cam.position.x, cam.position.y, cam.position.z],
      feet: walking ? [w.feet.x, w.feet.y, w.feet.z] : [cam.position.x, cam.position.y, cam.position.z],
      yawDeg: wrapDeg(Math.atan2(f.x, -f.z) / DEG),
      pitchDeg: Math.asin(clamp(f.y, -1, 1)) / DEG,
      fovDeg: this.lens.fovDeg,
      rollDeg: this.lens.rollDeg,
      grounded: w.grounded,
      speed: walking ? w.speed : this.mode === 'fly' ? this.fly.vel.length() : 0,
    };
  }

  /**
   * Scripted, deterministic input for QA: steps the walk or fly simulation SYNCHRONOUSLY at 60 Hz for `seconds` of game time
   * with the given held input, then updates the camera and returns the pose. Has no effect in orbit / photo mode.
   * Any running transition is finished first.
   */
  debugMove(input: MoveInput, seconds: number): CameraPose {
    if (this.tr) this.finishTransition();
    const dt = 1 / 60;
    const n = Math.max(0, Math.round(seconds / dt));
    if (this.mode === 'walk') {
      if (input.yawDeg !== undefined) this.walk.yaw = input.yawDeg * DEG;
      if (input.pitchDeg !== undefined) this.walk.pitch = clamp(input.pitchDeg * DEG, -PITCH_LIMIT, PITCH_LIMIT);
      const keepHyper = this.walk.hyper;
      if (input.hyper !== undefined) this.walk.hyper = input.hyper;
      const inp = { fwd: input.forward ?? 0, right: input.right ?? 0, up: 0, sprint: !!input.sprint, jump: !!input.jump, crouch: !!input.crouch };
      for (let i = 0; i < n; i++) this.stepWalk(dt, inp);
      this.walk.hyper = keepHyper;
      this.poseWalk(false);
    } else if (this.mode === 'fly') {
      if (input.yawDeg !== undefined) this.fly.yaw = this.fly.tYaw = input.yawDeg * DEG;
      if (input.pitchDeg !== undefined) this.fly.pitch = this.fly.tPitch = clamp(input.pitchDeg * DEG, -PITCH_LIMIT, PITCH_LIMIT);
      const inp = { fwd: input.forward ?? 0, right: input.right ?? 0, up: input.up ?? 0, sprint: !!input.sprint, jump: false, crouch: false };
      for (let i = 0; i < n; i++) this.stepFly(dt, inp);
      this.poseFly();
    } else this.updateOrbit(0);   // re-establish the un-rolled orientation before finishFrame() rolls it again
    this.finishFrame();
    return this.getPose();
  }

  // ── Frame tail: roll, fov, change events ───────────────────────────────────────────────────────────────────────

  private finishFrame(): void {
    // ROLL goes last: OrbitControls.update() ends in lookAt(), which resets the orientation every frame, so this never accumulates.
    applyRoll(this.camera, this.lens.rollDeg + this.baseRoll);
    this.syncCameraFov();
    this.notifyLens(false);
    const cam = this.camera;
    cam.updateMatrixWorld();
    const moved = this.lastPos.distanceToSquared(cam.position) > 1e-8 || 1 - Math.abs(this.lastQuat.dot(cam.quaternion)) > 1e-12 || this.lastFov !== cam.fov;
    if (moved || Number.isNaN(this.lastFov)) {
      this.lastPos.copy(cam.position); this.lastQuat.copy(cam.quaternion); this.lastFov = cam.fov;
      this.ctx.events.emit({ type: 'camera-moved' });
    }
  }

  /** Keep camera.fov (and the walk-mode near plane) in step with the lens / mode. */
  private syncCameraFov(): void {
    const cam = this.camera;
    const walkNear = this.mode === 'walk' && (!this.tr || (this.tr.endMode === 'walk' && this.tr.keepBody));   // no pop during a walk focus-turn
    const near = walkNear ? Math.min(WALK_NEAR, this.baseNear) : this.baseNear;
    if (cam.fov !== this.lens.fovDeg || cam.near !== near) { cam.fov = this.lens.fovDeg; cam.near = near; cam.updateProjectionMatrix(); }
  }

  private notifyLens(force: boolean): void {
    const a = this.lens, b = this.lensSnap, ta = a.tiltShift, tb = b.tiltShift;
    const same = a.fovDeg === b.fovDeg && a.rollDeg === b.rollDeg && a.dollyZoom === b.dollyZoom
      && ta.enabled === tb.enabled && ta.focusY === tb.focusY && ta.band === tb.band && ta.blur === tb.blur;
    if (!force && same) return;
    this.lensSnap = cloneLens(a);
    if (!this.lensListeners.size) return;
    const c = cloneLens(this.lens);
    for (const cb of this.lensListeners) cb(cloneLens(c));
  }

  private stepLensAnim(dt: number): void {
    const a = this.lensAnim;
    if (!a) return;
    a.t = Math.min(1, a.t + dt / a.dur);
    const e = easeInOutCubic(a.t);
    this.lens.fovDeg = a.f0 + (a.f1 - a.f0) * e;
    this.lens.rollDeg = a.r0 + (a.r1 - a.r0) * e;
    if (a.t >= 1) this.lensAnim = null;
  }

  // ── Orbit / photo ──────────────────────────────────────────────────────────────────────────────────────────────

  /** Fade out the calibrated photo roll once the user has left the photo composition. */
  private stepBaseRoll(dt: number): void {
    const target = this.mode === 'photo' || !this.userMoved ? this.ctx.anchors.photoCamera.rollDeg : 0;
    this.baseRoll = damp(this.baseRoll, target, 5, dt);
    if (Math.abs(this.baseRoll - target) < 1e-4) this.baseRoll = target;
  }

  /** Ground limit as a polar-angle limit so OrbitControls itself stops (no fighting): y = target.y + r cos(phi) >= minY. Returns minY. */
  private applyOrbitLimits(): number {
    const o = this.orbit, cam = this.camera;
    if (o.target.y < 0) o.target.y = 0;
    const minY = this.groundFn(cam.position.x, cam.position.z) + ORBIT_MIN_ALT;
    const r = Math.max(cam.position.distanceTo(o.target), 1e-3);
    o.maxPolarAngle = Math.acos(clamp((minY - o.target.y) / r, -1, 1));
    return minY;
  }

  private updateOrbit(dt: number): void {
    const o = this.orbit, cam = this.camera;
    o.enabled = true;
    const minY = this.applyOrbitLimits();
    o.update(dt);
    if (cam.position.y < minY) { cam.position.y = minY; cam.lookAt(o.target); }   // safety net (zoom / dolly moved it)
  }

  private readonly onOrbitStart = (): void => {
    this.userMoved = true;
    if (this.mode === 'photo') {
      this.mode = 'orbit';
      this.ctx.events.emit({ type: 'camera-mode', mode: 'orbit' });
    }
  };

  private resetOrbitState(target: THREE.Vector3): void {
    const o = this.orbit as unknown as { _sphericalDelta?: THREE.Spherical; _panOffset?: THREE.Vector3; _scale?: number; target: THREE.Vector3 };
    o.target.copy(target);
    o._sphericalDelta?.set(0, 0, 0);
    o._panOffset?.set(0, 0, 0);
    if (o._scale !== undefined) o._scale = 1;
  }

  // ── Transitions ────────────────────────────────────────────────────────────────────────────────────────────────

  private currentPose(): { pos: THREE.Vector3; tgt: THREE.Vector3 } {
    const pos = this.camera.position.clone();
    if (this.tr) return { pos, tgt: this.trTgt.clone() };
    if (this.mode === 'orbit' || this.mode === 'photo') return { pos, tgt: this.orbit.target.clone() };
    const f = new THREE.Vector3();
    const yaw = this.mode === 'walk' ? this.walk.yaw : this.fly.yaw;
    const pitch = this.mode === 'walk' ? this.walk.pitch : this.fly.pitch;
    forwardFromYawPitch(yaw, pitch, f);
    return { pos, tgt: pos.clone().addScaledVector(f, 40) };
  }

  private beginMove(
    toPos: THREE.Vector3, toTgt: THREE.Vector3,
    o: {
      seconds?: number; instant?: boolean; fov?: number; roll?: number; base?: number; endMode: CameraModeId;
      keepBody?: boolean; interruptible?: boolean; from?: { pos: THREE.Vector3; tgt: THREE.Vector3 };
    },
  ): Promise<void> {
    const from = o.from ?? this.currentPose();
    if (this.tr) this.cancelTransition(false);
    this.lensAnim = null;
    const dist = from.pos.distanceTo(toPos);
    const seconds = o.seconds ?? clamp(0.9 + 0.4 * Math.log10(1 + dist / 20), 1.0, 2.6);
    return new Promise<void>((resolve) => {
      const tr: Transition = {
        fromPos: from.pos.clone(), toPos: toPos.clone(), fromTgt: from.tgt.clone(), toTgt: toTgt.clone(),
        fromFov: this.lens.fovDeg, toFov: o.fov ?? this.lens.fovDeg,
        fromRoll: this.lens.rollDeg, toRoll: o.roll ?? this.lens.rollDeg,
        fromBase: this.baseRoll, toBase: o.base ?? this.baseRoll,
        t: 0, dur: Math.max(seconds, 1e-3), arc: dist > 120 ? Math.min(0.08 * dist, 45) : 0,
        endMode: o.endMode, keepBody: !!o.keepBody, interruptible: o.interruptible !== false, resolve,
      };
      this.tr = tr;
      this.trTgt.copy(tr.fromTgt);
      this.orbit.enabled = false;
      if (o.instant) { this.finishTransition(); }
    });
  }

  private stepTransition(dt: number): void {
    const tr = this.tr!;
    tr.t = Math.min(1, tr.t + dt / tr.dur);
    const e = easeInOutCubic(tr.t);
    const cam = this.camera;
    cam.position.lerpVectors(tr.fromPos, tr.toPos, e);
    if (tr.arc) cam.position.y += Math.sin(Math.PI * e) * tr.arc;
    this.trTgt.lerpVectors(tr.fromTgt, tr.toTgt, e);
    this.lens.fovDeg = tr.fromFov + (tr.toFov - tr.fromFov) * e;
    this.lens.rollDeg = tr.fromRoll + (tr.toRoll - tr.fromRoll) * e;
    this.baseRoll = tr.fromBase + (tr.toBase - tr.fromBase) * e;
    const minAlt = tr.endMode === 'walk' ? 0 : tr.endMode === 'fly' ? FLY_MIN_ALT : ORBIT_MIN_ALT;
    const floor = this.groundFn(cam.position.x, cam.position.z) + minAlt;
    if (cam.position.y < floor) cam.position.y = floor;
    if (cam.position.distanceToSquared(this.trTgt) > 1e-6) cam.lookAt(this.trTgt);
    if (tr.t >= 1) this.finishTransition();
  }

  /** Complete the running transition exactly at its end pose and hand the camera to the target mode. */
  private finishTransition(): void {
    const tr = this.tr;
    if (!tr) return;
    this.tr = null;
    const cam = this.camera;
    cam.position.copy(tr.toPos);
    this.trTgt.copy(tr.toTgt);
    this.lens.fovDeg = tr.toFov;
    this.lens.rollDeg = tr.toRoll;
    this.baseRoll = tr.toBase;
    this.enterMode(tr.endMode, tr.toTgt, tr.keepBody);
    this.notifyLens(true);
    tr.resolve();
  }

  /** Stop a running transition where it is. `handover` = give the camera to the user's mode now. */
  private cancelTransition(handover = true): void {
    const tr = this.tr;
    if (!tr) return;
    this.tr = null;
    let mode = tr.endMode;
    if (mode === 'photo' && handover) { mode = 'orbit'; this.mode = 'orbit'; this.ctx.events.emit({ type: 'camera-mode', mode: 'orbit' }); }
    const e = easeInOutCubic(tr.t);
    this.lens.fovDeg = tr.fromFov + (tr.toFov - tr.fromFov) * e;
    this.lens.rollDeg = tr.fromRoll + (tr.toRoll - tr.fromRoll) * e;
    this.baseRoll = tr.fromBase + (tr.toBase - tr.fromBase) * e;
    if (handover) this.enterMode(mode, this.trTgt, tr.keepBody);
    tr.resolve();
  }

  private enterMode(mode: CameraModeId, tgt: THREE.Vector3, keepBody = false): void {
    switch (mode) {
      case 'orbit': case 'photo':
        this.resetOrbitState(tgt);
        this.orbit.enabled = true;
        this.applyOrbitLimits();   // the polar limit of the PREVIOUS view (e.g. 8 km out) would otherwise lift the camera onto the target's height
        this.orbit.update();
        break;
      case 'walk': this.initWalkFromPose(tgt, keepBody); this.poseWalk(false); break;
      case 'fly': this.initFlyFromPose(tgt); this.poseFly(); break;
    }
  }

  // ── Dolly zoom ─────────────────────────────────────────────────────────────────────────────────────────────────

  /** Move the camera along its view axis so the focus subject keeps its size when the FOV goes oldFov -> newFov. */
  private dollyMove(oldFov: number, newFov: number): void {
    const cam = this.camera;
    if (this.mode === 'walk') return;                    // walking through the scene for a lens change would be wrong
    const focus = this._v2;
    if (this.mode === 'fly') {
      const f = cam.getWorldDirection(this._v1);
      const along = this._v3.copy(STACK_CENTRE).sub(cam.position).dot(f);
      focus.copy(cam.position).addScaledVector(f, along > 5 ? along : 60);
    } else focus.copy(this.orbit.target);
    const d = this._v1.copy(cam.position).sub(focus);
    const dist = d.length();
    if (dist < 1e-3) return;
    d.divideScalar(dist);
    const nd = this.mode === 'fly' ? clamp(dollyDistance(dist, oldFov, newFov), 1, FLY_BOUNDS) : clamp(dollyDistance(dist, oldFov, newFov), ORBIT_MIN_DIST, ORBIT_MAX_DIST);
    cam.position.copy(focus).addScaledVector(d, nd);
    if (this.mode === 'photo') {                          // the calibrated pose no longer holds
      this.mode = 'orbit';
      this.userMoved = true;
      this.ctx.events.emit({ type: 'camera-mode', mode: 'orbit' });
    }
    if (this.mode === 'fly') cam.position.y = Math.max(cam.position.y, this.groundFn(cam.position.x, cam.position.z) + FLY_MIN_ALT);
  }

  // ── Walk ───────────────────────────────────────────────────────────────────────────────────────────────────────

  private initWalkFromPose(tgt: THREE.Vector3, keepBody: boolean): void {
    const w = this.walk;
    const d = this._v1.copy(tgt).sub(this.camera.position);
    if (d.lengthSq() > 1e-9) {
      d.normalize();
      w.yaw = Math.atan2(d.x, -d.z);
      w.pitch = clamp(Math.asin(clamp(d.y, -1, 1)), -PITCH_LIMIT, PITCH_LIMIT);
    }
    if (!keepBody) {
      w.eye = EYE_HEIGHT;
      w.feet.set(this.camera.position.x, this.camera.position.y - w.eye, this.camera.position.z);
      w.vx = w.vz = w.vy = 0;
      w.stepOffset = 0; w.bobAmp = 0; w.speed = 0;
      const g = this.groundFn(w.feet.x, w.feet.z);
      w.grounded = w.feet.y <= g + 0.05;
    }
    this.orbit.enabled = false;
  }

  private stepWalk(dt: number, inp: StepInput): void {
    const w = this.walk;
    const colliders = this.ctx.colliders;
    // Look.
    this.consumeLook(w);
    // Horizontal velocity: smooth toward the wish velocity (fast on the ground, slow in the air = momentum).
    const speed = w.hyper ? HYPER_SPEED : inp.sprint ? SPRINT_SPEED : WALK_SPEED;
    let fx = inp.fwd, rx = inp.right;
    const l = Math.hypot(fx, rx);
    if (l > 1) { fx /= l; rx /= l; }
    const sy = Math.sin(w.yaw), cy = Math.cos(w.yaw);
    const wishX = (sy * fx + cy * rx) * speed;
    const wishZ = (-cy * fx + sy * rx) * speed;
    const k = w.grounded ? (w.hyper ? 9 : 14) : 2.2;
    const a = 1 - Math.exp(-k * dt);
    w.vx += (wishX - w.vx) * a;
    w.vz += (wishZ - w.vz) * a;
    if (Math.abs(w.vx) < 1e-4) w.vx = 0;
    if (Math.abs(w.vz) < 1e-4) w.vz = 0;

    // Crouch (eye height and body height).
    const crouch = inp.crouch;
    w.eye = damp(w.eye, crouch ? EYE_CROUCH : EYE_HEIGHT, 12, dt);
    const bodyH = crouch ? 1.2 : BODY_HEIGHT;

    // Horizontal move with collision (sub-stepped inside moveHorizontal, slide response).
    const px = w.feet.x, pz = w.feet.z;
    const p = { x: px, z: pz };
    const hit = moveHorizontal(p, w.vx * dt, w.vz * dt, w.feet.y, colliders, { radius: BODY_RADIUS, height: bodyH, bounds: WALK_BOUNDS });
    if (hit) { w.vx = (p.x - px) / dt; w.vz = (p.z - pz) / dt; }   // keep only the sliding component
    w.feet.x = p.x; w.feet.z = p.z;
    w.speed = Math.hypot(w.vx, w.vz);

    // Vertical: ground / apron / low obstacles under the capsule, step-up, jump, gravity.
    const g = supportHeight(w.feet.x, w.feet.z, BODY_RADIUS, w.feet.y, colliders, this.groundFn(w.feet.x, w.feet.z), STEP_HEIGHT);
    if (inp.jump && w.grounded && w.vy <= 0) { w.vy = JUMP_SPEED; w.grounded = false; }
    if (w.grounded && w.vy <= 0 && w.feet.y - g <= 0.4) {
      // Stick to the surface (steps up to STEP_HEIGHT, down to 0.4 m); the eye is smoothed so a 12 cm kerb is a bump, not a snap.
      const dy = g - w.feet.y;
      if (Math.abs(dy) > 1e-6) w.stepOffset = clamp(w.stepOffset - dy, -0.4, 0.4);
      w.feet.y = g; w.vy = 0;
    } else {
      w.grounded = false;
      w.vy -= GRAVITY * dt;
      w.feet.y += w.vy * dt;
      if (w.feet.y <= g && w.vy <= 0) {
        w.feet.y = g; w.vy = 0; w.grounded = true;
      }
    }
    w.stepOffset = damp(w.stepOffset, 0, 14, dt);

    // Head bob amplitude (visual only; applied in poseWalk).
    const bobTarget = w.grounded && w.speed > 0.2 && w.speed < 8 ? Math.min(w.speed, SPRINT_SPEED) / SPRINT_SPEED * 0.024 + 0.006 : 0;
    w.bobAmp = damp(w.bobAmp, bobTarget, 8, dt);
    w.bobPhase += w.speed * dt * 2.1;
  }

  private poseWalk(bob: boolean): void {
    const w = this.walk, cam = this.camera;
    const bobY = bob ? Math.sin(w.bobPhase * 2) * w.bobAmp : 0;
    const bobX = bob ? Math.sin(w.bobPhase) * w.bobAmp * 0.5 : 0;
    cam.position.set(w.feet.x, w.feet.y + w.eye + w.stepOffset + bobY, w.feet.z);
    if (bobX) {
      // Sideways sway along the camera's right vector.
      cam.position.x += Math.cos(w.yaw) * bobX; cam.position.z += Math.sin(w.yaw) * bobX;
    }
    this._e.set(w.pitch, -w.yaw, 0, 'YXZ');
    cam.quaternion.setFromEuler(this._e);
  }

  // ── Fly ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private initFlyFromCamera(): void {
    const f = this.camera.getWorldDirection(this._v1);
    this.setFlyLook(f);
    this.fly.vel.set(0, 0, 0);
    this.orbit.enabled = false;
    const g = this.groundFn(this.camera.position.x, this.camera.position.z) + FLY_MIN_ALT;
    if (this.camera.position.y < g) this.camera.position.y = g;
  }

  private initFlyFromPose(tgt: THREE.Vector3): void {
    const d = this._v1.copy(tgt).sub(this.camera.position);
    if (d.lengthSq() > 1e-9) this.setFlyLook(d.normalize());
    this.fly.vel.set(0, 0, 0);
    this.orbit.enabled = false;
  }

  private setFlyLook(f: THREE.Vector3): void {
    const yaw = Math.atan2(f.x, -f.z);
    const pitch = clamp(Math.asin(clamp(f.y, -1, 1)), -PITCH_LIMIT, PITCH_LIMIT);
    this.fly.yaw = this.fly.tYaw = yaw;
    this.fly.pitch = this.fly.tPitch = pitch;
  }

  private stepFly(dt: number, inp: StepInput): void {
    const f = this.fly, cam = this.camera;
    // Look (raw target, smoothed for a cinematic feel).
    f.tYaw += this.lookDX * LOOK_SENS;
    f.tPitch = clamp(f.tPitch - this.lookDY * LOOK_SENS, -PITCH_LIMIT, PITCH_LIMIT);
    this.lookDX = 0; this.lookDY = 0;
    const kl = 1 - Math.exp(-32 * dt);
    f.yaw += (f.tYaw - f.yaw) * kl;
    f.pitch += (f.tPitch - f.pitch) * kl;

    const fv = this._v1;
    forwardFromYawPitch(f.yaw, f.pitch, fv);
    const rv = this._v2.set(Math.cos(f.yaw), 0, Math.sin(f.yaw));
    const wish = this._v3.set(0, 0, 0)
      .addScaledVector(fv, inp.fwd)
      .addScaledVector(rv, inp.right);
    wish.y += inp.up;
    const has = wish.lengthSq() > 1e-6;
    if (has) wish.normalize().multiplyScalar(f.speed * (inp.sprint ? 3 : 1));
    // Smooth acceleration; a little quicker braking than pick-up.
    const a = 1 - Math.exp(-(has ? 3.2 : 5.5) * dt);
    f.vel.x += (wish.x - f.vel.x) * a;
    f.vel.y += (wish.y - f.vel.y) * a;
    f.vel.z += (wish.z - f.vel.z) * a;
    if (f.vel.lengthSq() < 1e-6) f.vel.set(0, 0, 0);
    cam.position.addScaledVector(f.vel, dt);
    cam.position.x = clamp(cam.position.x, -FLY_BOUNDS, FLY_BOUNDS);
    cam.position.z = clamp(cam.position.z, -FLY_BOUNDS, FLY_BOUNDS);
    cam.position.y = Math.min(cam.position.y, FLY_BOUNDS);
    const floor = this.groundFn(cam.position.x, cam.position.z) + FLY_MIN_ALT;
    if (cam.position.y < floor) { cam.position.y = floor; if (f.vel.y < 0) f.vel.y = 0; }
  }

  private poseFly(): void {
    this._e.set(this.fly.pitch, -this.fly.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this._e);
  }

  // ── Input ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private consumeLook(w: { yaw: number; pitch: number }): void {
    if (this.lookDX === 0 && this.lookDY === 0) return;
    w.yaw += this.lookDX * LOOK_SENS;
    w.pitch = clamp(w.pitch - this.lookDY * LOOK_SENS, -PITCH_LIMIT, PITCH_LIMIT);
    this.lookDX = 0; this.lookDY = 0;
  }

  private readInput(): StepInput {
    const k = this.keys;
    let fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const js = this.joystick?.value;
    if (js) { fwd = clamp(fwd - js.y, -1, 1); right = clamp(right + js.x, -1, 1); }
    const space = k.has('Space');
    const jump = space || this.jumpQueued;
    this.jumpQueued = false;
    return {
      fwd, right,
      up: (space || k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') || k.has('KeyC') ? 1 : 0),
      sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
      jump, crouch: k.has('KeyC'),
    };
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isTextEntry(e.target)) return;
    if (e.target instanceof Element && e.target.closest('dialog')) return;   // help / about are modal: no camera hotkeys behind them
    if (e.defaultPrevented && MOVE_CODES.has(e.code)) return;                  // a menu / slider already used this arrow key
    const m = this.mode;
    // Held keys for walk / fly. A focused slider keeps its arrow keys and a focused checkbox its Space (lens panel).
    if ((m === 'walk' || m === 'fly') && MOVE_CODES.has(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const el = e.target;
      if (el instanceof HTMLInputElement && ((el.type === 'range' && e.code.startsWith('Arrow')) || (el.type === 'checkbox' && e.code === 'Space'))) return;
      this.keys.add(e.code);
      if (m === 'walk' && e.code === 'Space' && !e.repeat) this.jumpQueued = true;   // a tap shorter than a frame still jumps
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      return;
    }
    if (m === 'walk' && !e.repeat && (e.code === 'ControlLeft' || e.code === 'ControlRight')) {
      this.walk.hyper = !this.walk.hyper;   // 40 m/s toggle for crossing kilometres
      return;
    }
    // Mode / lens hotkeys. The UI shell binds the same keys and calls preventDefault: then we skip (no double handling).
    if (!this.opts.hotkeys || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
    if (e.altKey && !e.getModifierState('AltGraph')) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const l = this.lens;
    switch (key) {
      case '1': this.setMode('orbit'); break;
      case '2': this.setMode('photo'); break;
      case '3': this.setMode('walk'); break;
      case '4': this.setMode('fly'); break;
      case 'r': if (this.mode !== 'photo') this.setMode('photo'); this.resetLens(); break;
      // Shift+[ arrives as '{' (US layout); accept the shifted glyphs as x5 / x10 steps.
      case '[': this.setLens({ fovDeg: l.fovDeg - 2 }); break;
      case ']': this.setLens({ fovDeg: l.fovDeg + 2 }); break;
      case '{': this.setLens({ fovDeg: l.fovDeg - 10 }); break;
      case '}': this.setLens({ fovDeg: l.fovDeg + 10 }); break;
      case ',': this.setLens({ rollDeg: l.rollDeg - 1 }); break;
      case '.': this.setLens({ rollDeg: l.rollDeg + 1 }); break;
      case '<': this.setLens({ rollDeg: l.rollDeg - 5 }); break;
      case '>': this.setLens({ rollDeg: l.rollDeg + 5 }); break;
      default: return;
    }
    e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => { this.keys.delete(e.code); };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') this.noteTouch();
    // A press during an interruptible transition cancels it; the same press then reaches the (re-enabled) controls.
    if (this.tr && this.tr.interruptible) this.cancelTransition(true);
    if (this.mode !== 'walk' && this.mode !== 'fly') return;
    if (this.tr) return;
    if (this.opts.pointerLock && e.pointerType === 'mouse' && e.button === 0 && !this.pointerLocked) this.requestLock();
    // Drag-to-look fallback (touch, or a mouse without pointer lock).
    if (e.button === 0 || e.pointerType !== 'mouse') {
      this.dragging = true; this.dragId = e.pointerId; this.lastX = e.clientX; this.lastY = e.clientY;
      if (e.pointerType !== 'mouse') {
        const now = performance.now();
        if (now - this.lastTap < 300) this.jumpQueued = true;   // double-tap = jump
        this.lastTap = now;
      }
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.mode !== 'walk' && this.mode !== 'fly') return;
    if (this.pointerLocked) {
      // Browsers / drivers may deliver one huge bogus delta right after the lock engages: settle first, then accept.
      if (performance.now() - this.lockedAt < LOCK_SETTLE_MS) return;
      if (Math.abs(e.movementX) < LOOK_SPIKE && Math.abs(e.movementY) < LOOK_SPIKE) { this.lookDX += e.movementX; this.lookDY += e.movementY; }
      return;
    }
    if (!this.dragging || e.pointerId !== this.dragId) return;
    this.lookDX += e.clientX - this.lastX; this.lookDY += e.clientY - this.lastY;
    this.lastX = e.clientX; this.lastY = e.clientY;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId === this.dragId) this.dragging = false;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (this.tr && this.tr.interruptible) this.cancelTransition(true);
    if (this.mode === 'fly') {
      this.fly.speed = clamp(this.fly.speed * Math.exp(-e.deltaY * 0.0015), FLY_SPEED_MIN, FLY_SPEED_MAX);
      e.preventDefault(); e.stopPropagation();
    } else if (this.mode === 'walk') e.preventDefault();
  };

  private exitLock(): void {
    this.keys.clear();
    this.dragging = false;
    this.joystick?.setVisible(false);
    try { if (document.pointerLockElement === this.canvas) document.exitPointerLock(); } catch { /* ignore */ }
  }

  private noteTouch(): void {
    if (this.touchSeen) return;
    this.touchSeen = true;
    if (this.opts.touch !== false) this.enableTouch();
  }

  private enableTouch(): void {
    if (this.joystick || !this.ctx) return;
    this.joystick = new VirtualJoystick(this.ctx.uiRoot);
    this.modeWatch();
  }

  /** Show the joystick only in walk / fly. */
  private modeWatch(): void {
    const off = this.ctx.events.on('camera-mode', (e) => this.joystick?.setVisible(e.mode === 'walk' || e.mode === 'fly'));
    this.disposers.push(off);
    this.joystick?.setVisible(this.mode === 'walk' || this.mode === 'fly');
  }
}

interface StepInput { fwd: number; right: number; up: number; sprint: boolean; jump: boolean; crouch: boolean }
