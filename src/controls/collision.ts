// Walk-mode collision: a vertical capsule (treated as a circle in XZ plus a vertical range) against the pad
// module's ctx.colliders (oriented boxes and vertical cylinders). DOM-free and three-free, so it is unit-tested.
// OWNER: src/controls.
//
// Response is "push out along the contact normal" applied after every small sub-step. Tangential motion is kept,
// so the player SLIDES along walls; moving in sub-steps shorter than the capsule radius makes tunnelling
// impossible even at 40 m/s (see moveHorizontal).
//
// Box yaw convention = three.js Object3D.rotation.y (counter-clockwise seen from above): a local point (lx, lz)
// maps to world (lx*cos + lz*sin, -lx*sin + lz*cos).
import type { Collider } from '../contracts.ts';

/** Player body. `feetY` is the y of the soles; the capsule spans feetY .. feetY + height. */
export const BODY_RADIUS = 0.35;
export const BODY_HEIGHT = 1.8;
/** Obstacles no taller than this above the soles are stepped onto instead of blocking (kerbs, the 0.12 m apron lip). */
export const STEP_HEIGHT = 0.35;

export interface Vec2 { x: number; z: number }
export interface PushOut { nx: number; nz: number; depth: number }

/** Vertical extent [bottom, top] of a collider (cylinders without a height are treated as infinite pillars). */
export function colliderRange(c: Collider): [number, number] {
  const h = c.kind === 'box' ? (c.size ? c.size[1] : 0) : (c.height ?? 1e9);
  return [c.centre[1] - h / 2, c.centre[1] + h / 2];
}

/**
 * Horizontal push-out of a circle (x, z, r) from one collider. Returns the unit normal pointing OUT of the collider
 * and the penetration depth (> 0), or null when the circle does not touch it. Vertical extent is NOT considered here.
 */
export function circleVsCollider(x: number, z: number, r: number, c: Collider): PushOut | null {
  if (c.kind === 'cylinder') {
    const rc = c.radius ?? 0;
    const dx = x - c.centre[0], dz = z - c.centre[2];
    const rr = rc + r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) return null;
    const d = Math.sqrt(d2);
    if (d < 1e-6) return { nx: 1, nz: 0, depth: rr };
    return { nx: dx / d, nz: dz / d, depth: rr - d };
  }
  if (!c.size) return null;
  const hx = c.size[0] / 2, hz = c.size[2] / 2;
  const rot = c.rotationY ?? 0;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const px = x - c.centre[0], pz = z - c.centre[2];
  // Broad phase: bounding circle of the box.
  const bound = Math.hypot(hx, hz) + r;
  if (px * px + pz * pz > bound * bound) return null;
  // World -> box local.
  const lx = px * cs - pz * sn;
  const lz = px * sn + pz * cs;
  const cx = lx < -hx ? -hx : lx > hx ? hx : lx;
  const cz = lz < -hz ? -hz : lz > hz ? hz : lz;
  const ddx = lx - cx, ddz = lz - cz;
  const d2 = ddx * ddx + ddz * ddz;
  let nlx: number, nlz: number, depth: number;
  if (d2 > 1e-12) {
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2);
    nlx = ddx / d; nlz = ddz / d; depth = r - d;
  } else {
    // Centre inside the box: leave through the nearest face.
    const penX = hx - Math.abs(lx), penZ = hz - Math.abs(lz);
    if (penX < penZ) { nlx = lx < 0 ? -1 : 1; nlz = 0; depth = penX + r; }
    else { nlx = 0; nlz = lz < 0 ? -1 : 1; depth = penZ + r; }
  }
  // Local normal -> world.
  return { nx: nlx * cs + nlz * sn, nz: -nlx * sn + nlz * cs, depth };
}

/** True when the collider blocks a body standing with its soles at feetY (kerbs below STEP_HEIGHT and things above the head do not). */
export function blocksBody(c: Collider, feetY: number, height = BODY_HEIGHT, step = STEP_HEIGHT): boolean {
  const [bottom, top] = colliderRange(c);
  return top > feetY + step && bottom < feetY + height;
}

/**
 * Highest walkable surface under the circle: `base` (terrain / apron) or the top of a collider that is low enough to
 * step onto from feetY (or that the body is already above).
 */
export function supportHeight(x: number, z: number, r: number, feetY: number, colliders: readonly Collider[], base: number, step = STEP_HEIGHT): number {
  let g = base;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const top = colliderRange(c)[1];
    if (top <= g || top > feetY + step + 1e-4) continue;
    if (circleVsCollider(x, z, r, c)) g = top;
  }
  return g;
}

/**
 * Resolve overlaps of the circle at `p` with every blocking collider (in place). Up to `iterations` passes so that
 * being pushed out of one collider into another (a corner) settles. Returns true if anything was hit.
 */
export function resolveXZ(p: Vec2, r: number, feetY: number, colliders: readonly Collider[], height = BODY_HEIGHT, step = STEP_HEIGHT, iterations = 4): boolean {
  let hit = false;
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (!blocksBody(c, feetY, height, step)) continue;
      const o = circleVsCollider(p.x, p.z, r, c);
      if (!o) continue;
      // A hair of extra clearance keeps the next sub-step from re-penetrating through float rounding.
      const d = o.depth + 1e-4;
      p.x += o.nx * d; p.z += o.nz * d;
      moved = hit = true;
    }
    if (!moved) break;
  }
  return hit;
}

export interface MoveOptions {
  radius?: number;
  height?: number;
  step?: number;
  /** Longest distance moved between collision resolutions. Must stay below the radius; default 0.2 m. */
  maxSubstep?: number;
  /** Half extent of the walkable square (world x/z), default 4000 m. */
  bounds?: number;
}

/**
 * Move `p` by (dx, dz) with collision, in sub-steps of at most `maxSubstep` metres (the tunnelling guard: at 40 m/s and
 * 60 fps a frame is 0.67 m, ~3.3 sub-steps). Returns true when a collider was hit (the motion slid along it).
 */
export function moveHorizontal(p: Vec2, dx: number, dz: number, feetY: number, colliders: readonly Collider[], o: MoveOptions = {}): boolean {
  const r = o.radius ?? BODY_RADIUS;
  const h = o.height ?? BODY_HEIGHT;
  const step = o.step ?? STEP_HEIGHT;
  const maxSub = Math.min(o.maxSubstep ?? 0.2, r * 0.75);
  const bounds = o.bounds ?? 4000;
  const dist = Math.hypot(dx, dz);
  const n = Math.min(400, Math.max(1, Math.ceil(dist / maxSub)));
  const sx = dx / n, sz = dz / n;
  let hit = false;
  for (let i = 0; i < n; i++) {
    p.x += sx; p.z += sz;
    if (resolveXZ(p, r, feetY, colliders, h, step)) hit = true;
  }
  p.x = p.x < -bounds ? -bounds : p.x > bounds ? bounds : p.x;
  p.z = p.z < -bounds ? -bounds : p.z > bounds ? bounds : p.z;
  return hit;
}
