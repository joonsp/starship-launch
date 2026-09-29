// Sandbox for src/controls: camera modes + lens on a placeholder pad (ground, apron, tower, OLM legs, stack, props).
// Everything you can do with the keyboard / mouse works here (1-4 modes, WASD, R, [ ] , .), and scripted QA goes
// through window.app.cc (the CameraController):
//   app.cc.setMode('walk', { instant: true }); app.cc.debugMove({ forward: 1, yawDeg: 30 }, 6); app.cc.setLens({ fovDeg: 20, dollyZoom: true })
//   app.inside() -> the id of a blocking collider the walker is inside (null = fine)
// Query flags: ?nogui hides lil-gui; ?tsband forces tilt-shift preview on.
import * as THREE from 'three';
import GUI from 'lil-gui';
import { createSandbox } from './harness.ts';
import { applyGlobals } from '../src/core/material-hooks.ts';
import { ANCHORS, APRON } from '../src/scene-config.ts';
import type { Collider } from '../src/contracts.ts';
import { CameraController } from '../src/controls/index.ts';
import { circleVsCollider, BODY_RADIUS } from '../src/controls/collision.ts';
import { blocksBody } from '../src/controls/collision.ts';

const params = new URLSearchParams(location.search);
const sb = await createSandbox({ title: 'Camera controls', lights: true, background: 0x86a9cf });
const ctx = sb.ctx, g = ctx.globals, scene = ctx.scene;
// The harness OrbitControls would fight ours: switch it off completely.
sb.controls.dispose();
sb.controls.update = () => false;

// ── Placeholder world ───────────────────────────────────────────────────────────────────────────────────────────
const mat = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial =>
  applyGlobals(new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o }), g);
const shadowed = <T extends THREE.Mesh>(m: T): T => { m.castShadow = true; m.receiveShadow = true; return m; };

const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), mat(0x6a6155, { roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
// A coarse grid on the ground so motion / roll / dolly read clearly.
const grid = new THREE.GridHelper(2000, 200, 0x000000, 0x000000);
(grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.18; grid.position.y = 0.02; scene.add(grid);

const apronW = APRON.maxX - APRON.minX, apronD = APRON.maxZ - APRON.minZ;
const apron = shadowed(new THREE.Mesh(new THREE.BoxGeometry(apronW, APRON.topY, apronD), mat(0x9a9a96)));
apron.position.set((APRON.minX + APRON.maxX) / 2, APRON.topY / 2, (APRON.minZ + APRON.maxZ) / 2); scene.add(apron);

const colliders: Collider[] = ctx.colliders;
function box(id: string, c: [number, number, number], size: [number, number, number], rotY: number, color: number, collide = true): void {
  const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(...size), mat(color)));
  m.position.set(...c); m.rotation.y = rotY; scene.add(m);
  if (collide) colliders.push({ id, kind: 'box', centre: c, size, rotationY: rotY });
}
function cyl(id: string, c: [number, number, number], r: number, h: number, color: number): void {
  const m = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32), mat(color)));
  m.position.set(...c); scene.add(m);
  colliders.push({ id, kind: 'cylinder', centre: c, radius: r, height: h });
}

// Tower (anchors.towerBase / towerHeight) and the stack on the launch mount.
const tw = 12.5, th = ANCHORS.towerHeight;
box('tower', [ANCHORS.towerBase.x, th / 2, ANCHORS.towerBase.z], [tw, th, tw], 0, 0x8a4a44);
// Chopstick arms reaching toward the mount (z+), at 96 m: above head height, so they do not block a walker.
box('chopstick-l', [-9, 96, -12], [3, 5, 30], 0, 0x7a3f3a);
box('chopstick-r', [3, 96, -12], [3, 5, 30], 0, 0x7a3f3a);
// Launch mount: four legs + a table ring at 20 m with a central opening.
for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) cyl(`olm-leg-${sx}${sz}`, [sx * 15, 9, sz * 15], 2.6, 18, 0xa0a0a0);
for (const [id, c, s] of [
  ['olm-n', [0, 19, -12], [40, 2, 16]], ['olm-s', [0, 19, 12], [40, 2, 16]], ['olm-e', [14, 19, 0], [12, 2, 8]], ['olm-w', [-14, 19, 0], [12, 2, 8]],
] as Array<[string, [number, number, number], [number, number, number]]>) box(id, c, s, 0, 0xb0b0b0);
const stackMat = applyGlobals(new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.9, roughness: 0.3 }), g);
const stack = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 124, 32), stackMat));
stack.position.set(0, ANCHORS.vehicleBase.y + 62, 0); scene.add(stack);
cyl('olm-core', [0, 9, 0], 3, 18, 0x777777);   // a pillar under the stack, so the centre is not walkable

// Tank farm and props near the walk spawn (20, 1.7, 75) which looks at heading 345 deg (toward the pad).
cyl('tank-1', [45, 6, 40], 4, 12, 0xd0d0d0);
cyl('tank-2', [58, 6, 40], 4, 12, 0xd0d0d0);
box('container', [17, 1.3, 62], [12, 2.6, 2.4], 0.44, 0x3f6f9a);              // slide test: rotated box straight ahead of the spawn
box('thin-wall', [-25, 1.5, 40], [30, 3, 0.15], 0, 0xc06a2a);                  // tunnelling test at 40 m/s
box('kerb', [0, 0.15, 90], [30, 0.3, 4], 0, 0xdddddd);                        // 0.3 m: stepped onto
box('barrier', [0, 0.35, 96], [30, 0.7, 1], 0, 0xcc3333);                      // 0.7 m: blocks, but you can jump onto it
box('crate', [10, 0.5, 84], [1.6, 1.0, 1.6], 0.6, 0x9a7b4f);                   // jump-on crate

// ── Controller ──────────────────────────────────────────────────────────────────────────────────────────────────
const cc = new CameraController({ pointerLock: !params.has('nolock') });
cc.init(ctx);
sb.add(cc);
sb.start();

const hud = document.createElement('div');
hud.style.cssText = 'position:fixed;left:8px;bottom:8px;font:12px/1.35 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.45);padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre';
document.body.appendChild(hud);
let camMoved = 0, modeEvents: string[] = [];
ctx.events.on('camera-moved', () => camMoved++);
ctx.events.on('camera-mode', (e) => modeEvents.push(e.mode));
setInterval(() => {
  const p = cc.getPose();
  hud.textContent = `mode ${p.mode}   pos ${p.pos.map((v) => v.toFixed(1)).join(', ')}\nyaw ${p.yawDeg.toFixed(1)}  pitch ${p.pitchDeg.toFixed(1)}  fov ${p.fovDeg.toFixed(1)}  roll ${p.rollDeg.toFixed(1)}\nspeed ${p.speed.toFixed(1)} m/s${cc.hyper ? ' HYPER' : ''}${p.mode === 'fly' ? '  fly ' + cc.flySpeed.toFixed(0) : ''}   moved-events ${camMoved}`;
}, 200);

// Tilt-shift preview (the real effect belongs to the post module): a blurred overlay masked outside the sharp band.
const ts = document.createElement('div');
ts.style.cssText = 'position:fixed;inset:0;pointer-events:none;display:none';
document.body.appendChild(ts);
function renderTS(l: typeof cc.lens): void {
  const t = l.tiltShift;
  ts.style.display = t.enabled ? 'block' : 'none';
  const a = Math.max(0, t.focusY - t.band / 2) * 100, b = Math.min(1, t.focusY + t.band / 2) * 100;
  const f = 12;   // feather
  ts.style.backdropFilter = `blur(${(t.blur * 8).toFixed(1)}px)`;
  const mask = `linear-gradient(180deg, #000 0%, #000 ${Math.max(0, a - f)}%, transparent ${a}%, transparent ${b}%, #000 ${Math.min(100, b + f)}%, #000 100%)`;
  ts.style.maskImage = mask; (ts.style as any).webkitMaskImage = mask;
}
cc.onLensChange((l) => { renderTS(l); gui?.controllersRecursive().forEach((c) => c.updateDisplay()); });

// ── lil-gui ─────────────────────────────────────────────────────────────────────────────────────────────────────
let gui: GUI | undefined;
if (!params.has('nogui')) {
  gui = new GUI({ title: 'Camera controls' });
  const modes = { orbit: () => cc.setMode('orbit'), photo: () => cc.setMode('photo'), walk: () => cc.setMode('walk'), fly: () => cc.setMode('fly') };
  const fm = gui.addFolder('Mode (keys 1-4)');
  for (const k of Object.keys(modes) as Array<keyof typeof modes>) fm.add(modes, k);
  const fl = gui.addFolder('Lens');
  fl.add(cc.lens, 'fovDeg', 10, 110, 0.5).name('fov [ ]').onChange((v: number) => cc.setLens({ fovDeg: v })).listen();
  fl.add(cc.lens, 'dollyZoom').name('dolly zoom').onChange((v: boolean) => cc.setLens({ dollyZoom: v })).listen();
  fl.add(cc.lens, 'rollDeg', -45, 45, 0.5).name('roll , .').onChange((v: number) => cc.setLens({ rollDeg: v })).listen();
  fl.add({ reset: () => { if (cc.getMode() !== 'photo') cc.setMode('photo'); cc.resetLens(); } }, 'reset').name('reset (R)');
  const ft = gui.addFolder('Tilt-shift (preview)');
  ft.add(cc.lens.tiltShift, 'enabled').onChange(() => cc.setLens({ tiltShift: cc.lens.tiltShift })).listen();
  ft.add(cc.lens.tiltShift, 'focusY', 0, 1, 0.01).onChange(() => cc.setLens({ tiltShift: cc.lens.tiltShift })).listen();
  ft.add(cc.lens.tiltShift, 'band', 0.02, 0.6, 0.01).onChange(() => cc.setLens({ tiltShift: cc.lens.tiltShift })).listen();
  ft.add(cc.lens.tiltShift, 'blur', 0, 1.5, 0.01).onChange(() => cc.setLens({ tiltShift: cc.lens.tiltShift })).listen();
}

// ── QA helpers for scripted shots ───────────────────────────────────────────────────────────────────────────────
function inside(): string | null {
  const p = cc.getPose();
  for (const c of colliders) {
    if (!blocksBody(c, p.feet[1])) continue;
    if (circleVsCollider(p.feet[0], p.feet[2], BODY_RADIUS - 0.02, c)) return c.id;
  }
  return null;
}
(window as any).app.cc = cc;
(window as any).app.inside = inside;
(window as any).app.events = () => ({ camMoved, modeEvents });
(window as any).app.gui = gui;
/** Project a world point to canvas pixels (QA: measure subject size for the dolly-zoom pair). */
(window as any).app.proj = (x: number, y: number, z: number) => {
  ctx.camera.updateMatrixWorld();
  const v = new THREE.Vector3(x, y, z).project(ctx.camera);
  return [Math.round((v.x * 0.5 + 0.5) * innerWidth), Math.round((-v.y * 0.5 + 0.5) * innerHeight)];
};
(window as any).app.colliders = colliders;
if (params.has('tsband')) cc.setLens({ tiltShift: { enabled: true, focusY: 0.45, band: 0.2, blur: 0.8 } });
