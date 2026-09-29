// Unit tests of the DOM-free parts of src/controls: dolly-zoom maths, collision resolution and roll application.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Collider } from '../src/contracts.ts';
import { apparentSize, applyRoll, clampFov, dollyDistance, forwardFromYawPitch, DEG } from '../src/controls/math.ts';
import { BODY_RADIUS, circleVsCollider, moveHorizontal, resolveXZ, supportHeight } from '../src/controls/collision.ts';

describe('dolly zoom', () => {
  it('follows d\' = d * tan(f0/2) / tan(f1/2)', () => {
    const d = dollyDistance(700, 45, 90);
    expect(d).toBeCloseTo(700 * Math.tan(22.5 * DEG) / Math.tan(45 * DEG), 9);
    expect(dollyDistance(100, 60, 60)).toBeCloseTo(100, 9);
  });
  it('keeps the subject the same size from FOV 20 to FOV 90', () => {
    const h = 124, d0 = 705, f0 = 45.2;
    const s0 = apparentSize(h, d0, f0);
    const d20 = dollyDistance(d0, f0, 20), d90 = dollyDistance(d0, f0, 90);
    expect(apparentSize(h, d20, 20)).toBeCloseTo(s0, 9);
    expect(apparentSize(h, d90, 90)).toBeCloseTo(s0, 9);
    expect(d20).toBeGreaterThan(d0);   // narrow FOV: back away
    expect(d90).toBeLessThan(d0);      // wide FOV: move in
  });
  it('is path independent and invertible', () => {
    let d = 500, f = 40;
    for (const f2 of [15, 80, 33, 110, 40]) { d = dollyDistance(d, f, f2); f = f2; }
    expect(d).toBeCloseTo(500, 6);
  });
  it('clamps the FOV to 10..110', () => {
    expect(clampFov(5)).toBe(10);
    expect(clampFov(200)).toBe(110);
    expect(clampFov(45)).toBe(45);
  });
});

describe('roll', () => {
  it('rolls the camera about its view axis, positive = clockwise (right side down)', () => {
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(-308, 105, 634);
    cam.lookAt(0, 138, 0);
    const fwd0 = cam.getWorldDirection(new THREE.Vector3());
    const right0 = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    expect(Math.abs(right0.y)).toBeLessThan(1e-9);           // level before the roll
    applyRoll(cam, 20);
    const fwd1 = cam.getWorldDirection(new THREE.Vector3());
    const right1 = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    expect(fwd1.distanceTo(fwd0)).toBeLessThan(1e-9);        // the view axis does not move
    expect(right1.y).toBeLessThan(0);                        // right side down
    expect(Math.asin(-right1.y / Math.cos(0))).toBeCloseTo(20 * DEG, 1);
  });
  it('does not accumulate when re-applied after a fresh lookAt (the per-frame contract)', () => {
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(50, 20, 80);
    const q: THREE.Quaternion[] = [];
    for (let i = 0; i < 3; i++) { cam.lookAt(0, 30, 0); applyRoll(cam, -15); q.push(cam.quaternion.clone()); }
    expect(q[1].angleTo(q[0])).toBeLessThan(1e-6);
    expect(q[2].angleTo(q[0])).toBeLessThan(1e-6);
  });
  it('roll 0 is a no-op', () => {
    const cam = new THREE.PerspectiveCamera();
    const q = cam.quaternion.clone();
    applyRoll(cam, 0);
    expect(cam.quaternion.equals(q)).toBe(true);
  });
  it('forwardFromYawPitch matches the compass convention (0 = north = -z, 90 = east = +x)', () => {
    const o = { x: 0, y: 0, z: 0 };
    forwardFromYawPitch(0, 0, o); expect(o.z).toBeCloseTo(-1, 9);
    forwardFromYawPitch(Math.PI / 2, 0, o); expect(o.x).toBeCloseTo(1, 9);
  });
});

const wallBox: Collider = { id: 'wall', kind: 'box', centre: [0, 1.5, 0], size: [20, 3, 1] };      // spans x -10..10, z -0.5..0.5
const rotBox: Collider = { id: 'rot', kind: 'box', centre: [5, 1.5, 5], size: [10, 3, 2], rotationY: Math.PI / 4 };
const tank: Collider = { id: 'tank', kind: 'cylinder', centre: [0, 5, 0], radius: 4, height: 10 };

describe('collision push-out', () => {
  it('cylinder: pushes the circle to radius + body radius along the contact normal', () => {
    const o = circleVsCollider(4.2, 0, BODY_RADIUS, tank)!;
    expect(o).not.toBeNull();
    expect(o.nx).toBeCloseTo(1, 9);
    expect(o.depth).toBeCloseTo(4 + BODY_RADIUS - 4.2, 9);
    expect(circleVsCollider(5, 0, BODY_RADIUS, tank)).toBeNull();
  });
  it('axis-aligned box: face and corner contacts', () => {
    const face = circleVsCollider(0, 0.7, BODY_RADIUS, wallBox)!;
    expect(face.nz).toBeCloseTo(1, 9);
    expect(face.depth).toBeCloseTo(0.5 + BODY_RADIUS - 0.7, 9);
    const corner = circleVsCollider(10.2, 0.6, BODY_RADIUS, wallBox)!;
    expect(Math.hypot(corner.nx, corner.nz)).toBeCloseTo(1, 9);
    expect(corner.nx).toBeGreaterThan(0);
    expect(circleVsCollider(10.4, 0.9, BODY_RADIUS, wallBox)).toBeNull();
  });
  it('rotated box (rotationY = 45 deg, three.js convention)', () => {
    // Local +x axis of the box points to world (cos, -sin) = (0.707, -0.707). Its half extents are 5 (local x) and 1 (local z).
    // A point on the local +x axis, 5.1 m from the centre, is 0.1 m from the end face.
    const c = Math.SQRT1_2;
    const p = { x: 5 + 5.1 * c, z: 5 - 5.1 * c };
    const o = circleVsCollider(p.x, p.z, BODY_RADIUS, rotBox)!;
    expect(o).not.toBeNull();
    expect(o.nx).toBeCloseTo(c, 6);
    expect(o.nz).toBeCloseTo(-c, 6);
    expect(o.depth).toBeCloseTo(BODY_RADIUS - 0.1, 6);
    // The same distance along the local z axis is far outside (half extent 1).
    expect(circleVsCollider(5 + 3 * c, 5 + 3 * c, BODY_RADIUS, rotBox)).toBeNull();       // local z = +3 -> 2 m from the side face
    expect(circleVsCollider(5 + 1.2 * c, 5 + 1.2 * c, BODY_RADIUS, rotBox)).not.toBeNull(); // local z = +1.2 -> 0.2 m from it
  });
  it('a centre inside a box leaves through the nearest face', () => {
    const o = circleVsCollider(0, 0.3, BODY_RADIUS, wallBox)!;
    expect(o.nz).toBeCloseTo(1, 9);
    expect(o.depth).toBeCloseTo(0.2 + BODY_RADIUS, 9);
  });
  it('ignores kerbs below the step height and things above the head', () => {
    const kerb: Collider = { id: 'kerb', kind: 'box', centre: [0, 0.15, 0], size: [10, 0.3, 10] };
    const canopy: Collider = { id: 'canopy', kind: 'box', centre: [0, 19, 0], size: [40, 2, 40] };
    const p = { x: 0, z: 0 };
    expect(resolveXZ(p, BODY_RADIUS, 0, [kerb, canopy])).toBe(false);
    expect(p).toEqual({ x: 0, z: 0 });
    expect(supportHeight(0, 0, BODY_RADIUS, 0, [kerb, canopy], 0)).toBeCloseTo(0.3, 9);
    expect(supportHeight(0, 0, BODY_RADIUS, 0, [canopy], 0.12)).toBeCloseTo(0.12, 9);
  });
});

describe('moveHorizontal (slide, no tunnelling)', () => {
  it('slides along a wall: the tangential motion survives, the normal component is removed', () => {
    const p = { x: -3, z: -3 };
    // Walk diagonally (+x, +z) into the wall's south... the wall spans z -0.5..0.5, we come from z = -3 going +z.
    for (let i = 0; i < 120; i++) moveHorizontal(p, 0.02, 0.02, 0, [wallBox]);
    expect(p.x).toBeCloseTo(-3 + 120 * 0.02, 3);                       // full tangential progress
    expect(p.z).toBeLessThanOrEqual(-0.5 - BODY_RADIUS + 1e-6);        // stopped at the wall face
    expect(p.z).toBeGreaterThan(-0.5 - BODY_RADIUS - 0.01);
  });
  it('a cylinder deflects the path around it instead of stopping it', () => {
    const p = { x: -10, z: 3 };
    for (let i = 0; i < 400; i++) moveHorizontal(p, 0.05, 0, 0, [tank]);
    expect(p.x).toBeGreaterThan(6);                                     // made it past the tank
    // never ended up inside
    expect(Math.hypot(p.x, p.z)).toBeGreaterThan(4 + BODY_RADIUS - 1e-3);
  });
  it('does not tunnel at 40 m/s through a thin wall, at 60 fps or with a 0.1 s frame spike', () => {
    const thin: Collider = { id: 'thin', kind: 'box', centre: [0, 1, 0], size: [30, 2, 0.1] };
    for (const dt of [1 / 60, 1 / 30, 0.1]) {
      const p = { x: 3, z: -20 };
      for (let i = 0; i < Math.ceil(1.5 / dt); i++) moveHorizontal(p, 0, 40 * dt, 0, [thin]);
      expect(p.z).toBeLessThan(0);
      expect(p.z).toBeCloseTo(-0.05 - BODY_RADIUS, 2);
    }
  });
  it('does not tunnel through a rotated box at hyper speed, from any approach angle', () => {
    for (let a = 0; a < 360; a += 15) {
      const ang = a * DEG;
      const p = { x: 5 + Math.cos(ang) * 30, z: 5 + Math.sin(ang) * 30 };
      const dirx = -Math.cos(ang), dirz = -Math.sin(ang);
      for (let i = 0; i < 60; i++) moveHorizontal(p, dirx * 40 / 60, dirz * 40 / 60, 0, [rotBox]);
      // The centre of the box stays unreachable: the body may slide around but never ends inside the box footprint.
      expect(circleVsCollider(p.x, p.z, BODY_RADIUS - 0.01, rotBox)).toBeNull();
    }
  });
  it('stays inside the +-4 km bounds', () => {
    const p = { x: 3990, z: 0 };
    moveHorizontal(p, 100, -5000, 0, []);
    expect(p.x).toBe(4000);
    expect(p.z).toBe(-4000);
  });
});
