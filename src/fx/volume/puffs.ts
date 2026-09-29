// Launch-cloud density authoring: hierarchical "puff" spheres (cauliflower billows).
// OWNER: volume module. Pure math (no three.js import) so Node tooling can run it directly
// (out/volume/tools/fit.mjs projects the puffs onto the reference photo for silhouette fitting).
//
// ── Model ────────────────────────────────────────────────────────────────────
//  Level 0 (L0): hand-placed masses (radius 25-80 m) matched to the reference photo from the
//     calibrated photo camera. They are authored in PHOTO space, (u px, depth m, height m, r m),
//     because that is how they were fitted; buildPuffs() converts them to world metres with the
//     photo camera frame. Physically they form the two wall-jet banks leaving the east-west
//     trench (west = left mass, east = right mass, which spreads SE toward the camera), plus a
//     low ground roll all around the mount and the hot fireball at the deflector.
//  Level 1: 7-14 children on each L0's outward/upper shell, r = 0.28-0.45 * parent.
//  Level 2: 5-8 children on each L1's outward shell, r = 0.30-0.45 * parent.
//  Each puff's radius is warped per direction by fBm on the GPU (see shaders/splat.frag.glsl),
//  and the union is probabilistic, D = 1 - prod(1 - d_i), which gives creased cauliflower joins.
//
// Units: metres; world frame of src/contracts.ts (x east, y up, z south).

export type Vec3 = [number, number, number];

export interface Puff {
  c: Vec3;            // centre (world m)
  r: number;          // radius (m)
  temp: number;       // 0..1 normalised temperature (emission channel), see TEMP_* in the shaders
  dens: number;       // peak density multiplier (0..1.2)
  warp: number;       // fBm radius warp amplitude (fraction of r)
  level: number;      // 0, 1, 2
  seed: number;       // 0..1, per-puff noise offset
}

/** Pinhole camera frame in world space (built from the calibrated photo camera). */
export interface PhotoFrame {
  pos: Vec3; fwd: Vec3; right: Vec3; up: Vec3;
  f: number;          // focal length in photo pixels
  cx: number; cy: number;
  width: number; height: number;
}

// ── small vector helpers ─────────────────────────────────────────────────────
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * Camera frame equivalent to scene-config applyPhotoCamera(): lookAt(target) with world up,
 * then roll by -rollDeg about the view axis. vfovDeg is the vertical FOV of a width x height photo.
 */
export function photoFrameFrom(pos: Vec3, target: Vec3, vfovDeg: number, rollDeg: number, width = 1677, height = 943): PhotoFrame {
  const fwd = norm(sub(target, pos));
  let right = norm(cross(fwd, [0, 1, 0]));
  let up = cross(right, fwd);
  // three's rotateZ(-roll) on the camera: positive roll turns the image clockwise (right side down).
  const a = (-rollDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const r2: Vec3 = add(mul(right, ca), mul(up, sa));
  const u2: Vec3 = add(mul(up, ca), mul(right, -sa));
  right = r2; up = u2;
  const f = height / 2 / Math.tan(((vfovDeg / 2) * Math.PI) / 180);
  return { pos, fwd, right, up, f, cx: width / 2, cy: height / 2, width, height };
}

/** Project a world point into photo pixels. Returns [u, v, depth] (depth along fwd, m). */
export function projectPhoto(fr: PhotoFrame, p: Vec3): Vec3 {
  const d = sub(p, fr.pos);
  const z = dot(d, fr.fwd);
  return [fr.cx + (fr.f * dot(d, fr.right)) / z, fr.cy - (fr.f * dot(d, fr.up)) / z, z];
}

/** World point for photo column u at camera depth d (m) and world height h (m). */
export function worldFromPhoto(fr: PhotoFrame, u: number, d: number, h: number): Vec3 {
  const lat = ((u - fr.cx) * d) / fr.f;
  const base = add(add(fr.pos, mul(fr.fwd, d)), mul(fr.right, lat));
  const k = (h - base[1]) / fr.up[1];
  return add(base, mul(fr.up, k));
}

// ── deterministic PRNG (mulberry32) ──────────────────────────────────────────
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── L0 masses, fitted to research/reference.jpeg (1677 x 943) ────────────────
// Columns: u (photo px), d (depth along the photo camera axis, m), h (world centre height, m),
//          r (m), g (group: W west/left bank, E east/right bank, G ground roll, F fireball),
//          t (temperature 0..1), k (density multiplier; < 1 = thinner, translucent haze).
export interface L0Spec { u: number; d: number; h: number; r: number; g: 'W' | 'E' | 'G' | 'F'; t?: number; k?: number; n?: number }

export const L0_SPECS: L0Spec[] = [
  // ---- WEST (left) bank: x 65..630 px, tops y 310..330, bottom on the ground at y ~700
  { u: 165, d: 640, h: 158, r: 36, g: 'W' },            // far-left white billow, upper (overhangs; ground visible below)
  { u: 135, d: 640, h: 100, r: 38, g: 'W' },            //   lower-left bulge (x 65 at y 500-560)
  { u: 205, d: 650, h: 88, r: 30, g: 'W' },             //   lower-right, joins the bank
  { u: 150, d: 780, h: 178, r: 44, g: 'W', k: 0.85 },   // peach lobe behind the billow
  { u: 225, d: 760, h: 192, r: 47, g: 'W', k: 0.9 },
  { u: 262, d: 720, h: 120, r: 46, g: 'W' },
  { u: 335, d: 730, h: 186, r: 57, g: 'W' },            // cream lobe (top ~y 310)
  { u: 395, d: 720, h: 140, r: 50, g: 'W' },
  { u: 305, d: 690, h: 38, r: 44, g: 'W' },             // white billows on the ground
  { u: 360, d: 680, h: 72, r: 50, g: 'W' },
  { u: 425, d: 700, h: 45, r: 52, g: 'W' },
  { u: 452, d: 720, h: 110, r: 48, g: 'W' },
  { u: 530, d: 700, h: 190, r: 44, g: 'W' },            // tall white billow (top ~y 310)
  { u: 525, d: 690, h: 125, r: 48, g: 'W' },
  { u: 572, d: 680, h: 86, r: 48, g: 'W' },
  { u: 612, d: 690, h: 60, r: 34, g: 'W' },
  { u: 598, d: 700, h: 128, r: 32, g: 'W' },
  { u: 612, d: 690, h: 108, r: 30, g: 'W' },
  { u: 500, d: 660, h: 40, r: 48, g: 'W' },
  { u: 590, d: 650, h: 36, r: 40, g: 'W' },
  // ---- GROUND ROLL in front of / around the mount (y 600..740), low and wide
  { u: 640, d: 640, h: 16, r: 34, g: 'G' },
  { u: 700, d: 620, h: 12, r: 32, g: 'G' },
  { u: 760, d: 610, h: 10, r: 30, g: 'G' },
  { u: 820, d: 600, h: -4, r: 22, g: 'G', k: 0.35 },
  { u: 880, d: 610, h: -4, r: 24, g: 'G', k: 0.35 },
  { u: 945, d: 600, h: -2, r: 26, g: 'G', k: 0.5 },
  { u: 760, d: 700, h: 10, r: 30, g: 'G', k: 0.5 },
  { u: 790, d: 560, h: -4, r: 24, g: 'G', k: 0.5 },
  { u: 860, d: 565, h: -6, r: 24, g: 'G', k: 0.45 },
  { u: 1030, d: 560, h: 2, r: 26, g: 'G', k: 0.6 },
  { u: 900, d: 700, h: 10, r: 30, g: 'G', k: 0.5 },
  // ---- EAST (right) bank: x 1000..1677 px; spreads south-east toward the camera
  { u: 1005, d: 640, h: 45, r: 44, g: 'E', t: 0.25 },    // near-pad roll, orange
  { u: 1065, d: 610, h: 62, r: 46, g: 'E', t: 0.15 },
  { u: 1115, d: 650, h: 72, r: 45, g: 'E', k: 0.5 },     // translucent peach haze
  { u: 1200, d: 640, h: 112, r: 45, g: 'E' },            // blue-grey lobe (top ~y 395)
  { u: 1235, d: 660, h: 168, r: 40, g: 'E' },
  { u: 1195, d: 600, h: 55, r: 36, g: 'E' },
  { u: 1150, d: 560, h: 30, r: 45, g: 'E' },             // ground front of the bank (bottom y ~745-770)
  { u: 1280, d: 525, h: 26, r: 42, g: 'E' },
  { u: 1420, d: 515, h: 26, r: 36, g: 'E' },
  { u: 1545, d: 525, h: 24, r: 36, g: 'E' },
  { u: 1350, d: 600, h: 72, r: 58, g: 'E' },
  { u: 1515, d: 615, h: 78, r: 56, g: 'E' },
  { u: 1290, d: 650, h: 130, r: 55, g: 'E' },
  { u: 1325, d: 700, h: 235, r: 52, g: 'E' },
  { u: 1432, d: 690, h: 232, r: 46, g: 'E' },            // tall lobe (top ~y 245)
  { u: 1390, d: 650, h: 188, r: 58, g: 'E' },
  { u: 1465, d: 640, h: 125, r: 60, g: 'E' },
  { u: 1575, d: 640, h: 128, r: 55, g: 'E' },
  { u: 1522, d: 700, h: 312, r: 58, g: 'E' },            // orange sunlit top (y ~90-150)
  { u: 1600, d: 700, h: 306, r: 64, g: 'E' },
  { u: 1665, d: 690, h: 212, r: 50, g: 'E' },
  { u: 1560, d: 680, h: 225, r: 62, g: 'E' },
  { u: 1655, d: 660, h: 205, r: 58, g: 'E' },
  { u: 1640, d: 640, h: 120, r: 50, g: 'E' },
];

// ── Fireball and trench outflow, authored in PAD-LOCAL metres along the flame trench ─────────
// The trench axis is pad-local +x (bearing 123 deg, ESE-WNW; scene-config PAD_YAW / TRENCH_CUTOUT,
// ends at about +-35 m). The plume impinges on the deflector under the mount; the hot exhaust leaves
// BOTH trench ends and runs out along the axis over the ground. From the photo camera (which looks
// almost perpendicular to the axis) the ESE end projects to u ~ 880 px and the WNW end to u ~ 765 px,
// so the visible yellow-white core (u 830-870, v 640-670) is the deflector fireball plus the ESE exit.
// Columns: lx (m along the axis, + = ESE), lz (m across, + = SSW), h (centre height m), r (m),
//          t (temperature 0..1), k (density; hot exhaust is glowing gas, not opaque steam).
export interface FireSpec { lx: number; lz: number; h: number; r: number; t: number; k: number }

export const FIRE_SPECS: FireSpec[] = [
  { lx: 8, lz: 0, h: 26, r: 20, t: 1.0, k: 0.4 },      // deflector fireball round the plume foot
  { lx: 26, lz: 2, h: 20, r: 22, t: 0.95, k: 0.4 },    // spilling toward the ESE trench exit
  { lx: 42, lz: 0, h: 14, r: 20, t: 0.85, k: 0.45 },   // ESE exit (the photo's bright core, right of the column)
  { lx: -10, lz: 0, h: 18, r: 18, t: 0.8, k: 0.45 },   // behind the tower base
  { lx: -38, lz: 0, h: 12, r: 18, t: 0.7, k: 0.5 },    // WNW exit (hidden by the ground roll from the photo camera)
  { lx: 64, lz: 2, h: 12, r: 20, t: 0.6, k: 0.55 },    // ESE outflow over the apron
  { lx: 92, lz: 6, h: 10, r: 18, t: 0.4, k: 0.65 },
  { lx: -64, lz: -2, h: 10, r: 18, t: 0.45, k: 0.6 },  // WNW outflow
];

/**
 * Rising, fire-lit steam round the plume foot (behind the tower, photo u ~800 v ~600): orange glow,
 * not flame. Normal L0 masses with a warm (sub-emissive) temperature, in pad-local metres.
 */
export const FOOT_SPECS: FireSpec[] = [
  { lx: -12, lz: -6, h: 48, r: 18, t: 0.12, k: 0.35 },
  { lx: 20, lz: -8, h: 44, r: 18, t: 0.12, k: 0.3 },
];

/**
 * Ground jets: the deluge steam and exhaust that leave both trench ends as low, dense wall jets along
 * the trench axis and feed the two banks. From the photo camera they sit behind the fitted front
 * masses of the banks (so the silhouettes do not change); from above and from the side they show the
 * exhaust running out along the trench, and they shade the pad from the low sun and carry the fire
 * glow along the ground into the base of each bank. Pad-local metres; t = warm near the trench.
 */
export const JET_SPECS: FireSpec[] = [
  { lx: 58, lz: 4, h: 18, r: 24, t: 0.18, k: 0.8 },
  { lx: 96, lz: -8, h: 22, r: 30, t: 0.1, k: 0.9 },
  { lx: 145, lz: 14, h: 26, r: 34, t: 0.04, k: 1 },
  { lx: 205, lz: 22, h: 28, r: 36, t: 0, k: 1 },
  { lx: 270, lz: 30, h: 30, r: 36, t: 0, k: 1 },
  { lx: -58, lz: 2, h: 18, r: 24, t: 0.18, k: 0.8 },
  { lx: -98, lz: 6, h: 22, r: 30, t: 0.1, k: 0.9 },
  { lx: -150, lz: 12, h: 26, r: 34, t: 0.04, k: 1 },
  { lx: -212, lz: 18, h: 28, r: 36, t: 0, k: 1 },
  { lx: -280, lz: 24, h: 30, r: 36, t: 0, k: 1 },
];

/**
 * Glowing outflow: the afterburning exhaust leaves both trench ends and runs along the ground under
 * the steam banks, lighting their bases orange from below (the photo's orange lower halves).
 * Light sources only (no density), pad-local metres along the trench axis, plus a relative power w.
 */
export const GLOW_SPECS: { lx: number; lz: number; h: number; r: number; w: number }[] = [
  { lx: -70, lz: 0, h: 6, r: 22, w: 0.45 },    // WNW outflow
  { lx: -125, lz: -4, h: 8, r: 26, w: 0.3 },
  { lx: -190, lz: -8, h: 8, r: 28, w: 0.12 },
  { lx: 72, lz: -6, h: 6, r: 22, w: 0.2 },     // ESE outflow (the near part is mostly seen through the fireball)
  { lx: 128, lz: 4, h: 8, r: 26, w: 0.42 },
  { lx: 195, lz: 12, h: 8, r: 28, w: 0.28 },
];

/** Default pad yaw (three.js rotation.y, rad) = scene-config PAD_YAW (spec scene.trench_yaw, -33.1 deg). */
export const DEFAULT_PAD_YAW = (-33.1 * Math.PI) / 180;

/** Pad-local (lx along the trench, lz across) -> world, i.e. rotation.y(yaw) applied to (lx, h, lz). */
export function padToWorld(lx: number, lz: number, h: number, yaw = DEFAULT_PAD_YAW): Vec3 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [c * lx + s * lz, h, -s * lx + c * lz];
}

/** Group centroids (world xz) used as "outward" references for child billows. */
const GROUP_ORIGIN: Record<string, Vec3> = {
  W: [-60, 0, 0],     // west trench exit side
  E: [60, 0, 60],     // east trench exit, bank spreads SE
  G: [0, 0, 0],
  F: [0, 0, 0],
};

export interface BuildOptions {
  seed?: number;
  /** Children per level multiplier (1 = default detail). */
  detail?: number;
  /** Only return levels <= maxLevel. */
  maxLevel?: number;
  /** Pad yaw (three.js rotation.y, rad) for the pad-local fire / outflow specs (scene-config PAD_YAW). */
  padYaw?: number;
}

/** One level-0 mass in world space (from a photo-space L0Spec or a pad-local FireSpec). */
interface Mass { c: Vec3; r: number; g: L0Spec['g']; t: number; k: number }

/**
 * Build the full puff list in world space. Deterministic for a given seed.
 * Typical count: ~50 L0, ~500 L1, ~3000 L2.
 * Order: the photo-fitted banks and ground roll (L0_SPECS), then the fireball (FIRE_SPECS), the
 * fire-lit steam round the plume foot (FOOT_SPECS) and the ground jets along the trench (JET_SPECS). The fire masses use their own random stream, so
 * editing them never reshuffles the billows of the photo-fitted banks.
 */
export function buildPuffs(fr: PhotoFrame, opts: BuildOptions = {}): Puff[] {
  const seed = opts.seed ?? 1337;
  const detail = opts.detail ?? 1;
  const maxLevel = opts.maxLevel ?? 2;
  const yaw = opts.padYaw ?? DEFAULT_PAD_YAW;
  const out: Puff[] = [];

  const banks: Mass[] = L0_SPECS.map((s) => ({ c: worldFromPhoto(fr, s.u, s.d, s.h), r: s.r, g: s.g, t: s.t ?? 0, k: s.k ?? 1 }));
  const fire: Mass[] = [
    ...FIRE_SPECS.map((s) => ({ c: padToWorld(s.lx, s.lz, s.h, yaw), r: s.r, g: 'F' as const, t: s.t, k: s.k })),
    ...FOOT_SPECS.map((s) => ({ c: padToWorld(s.lx, s.lz, s.h, yaw), r: s.r, g: 'G' as const, t: s.t, k: s.k })),
    ...JET_SPECS.map((s) => ({ c: padToWorld(s.lx, s.lz, s.h, yaw), r: s.r, g: 'G' as const, t: s.t, k: s.k })),
  ];
  addMasses(out, banks, rng(seed), detail, maxLevel);
  addMasses(out, fire, rng(seed + 7919), detail, maxLevel);
  return out;
}

function addMasses(out: Puff[], masses: Mass[], rand: () => number, detail: number, maxLevel: number): void {
  const R = (a: number, b: number) => a + (b - a) * rand();
  const randDir = (): Vec3 => {
    const z = R(-1, 1), a = R(0, Math.PI * 2), s = Math.sqrt(1 - z * z);
    return [s * Math.cos(a), z, s * Math.sin(a)];
  };

  for (const s of masses) {
    const c = s.c;
    const t0 = s.t;
    const k0 = s.k;
    const fire = s.g === 'F';
    out.push({ c, r: s.r, temp: t0, dens: k0, warp: fire ? 0.35 : 0.22, level: 0, seed: rand() });
    if (maxLevel < 1) continue;

    // Outward direction for this mass: away from the group origin, tilted up (billows rise).
    const o = GROUP_ORIGIN[s.g];
    const outH = norm([c[0] - o[0], 0, c[2] - o[2]]);
    const upBias = s.g === 'G' ? 0.25 : 0.7;
    const n1 = Math.round(Math.min(14, Math.max(7, 5 + s.r / 9)) * detail);
    for (let i = 0; i < n1; i++) {
      let n = randDir();
      if (n[1] < -0.35) n[1] = -n[1] * 0.5;                          // keep children on the upper/side shell
      n = norm(add(n, add(mul(outH, 0.45), [0, upBias * 0.5, 0])));
      const r1 = s.r * R(0.28, 0.45);
      const c1 = add(c, mul(n, s.r * R(0.62, 0.9)));
      if (c1[1] + r1 * 0.6 < 0) continue;
      const t1 = t0 * R(0.55, 0.9);
      out.push({ c: c1, r: r1, temp: t1, dens: k0, warp: 0.26, level: 1, seed: rand() });
      if (maxLevel < 2) continue;

      const n2 = Math.round(R(5, 8) * detail);
      for (let j = 0; j < n2; j++) {
        let m = randDir();
        // outward relative to the L0 centre, so the small bumps sit on the visible surface
        const away = norm(sub(c1, c));
        m = norm(add(m, mul(away, 0.9)));
        if (m[1] < -0.5) m[1] = -m[1] * 0.4;
        const r2 = r1 * R(0.3, 0.45);
        const c2 = add(c1, mul(m, r1 * R(0.72, 0.95)));
        if (c2[1] + r2 * 0.5 < 0) continue;
        out.push({ c: c2, r: r2, temp: t1 * R(0.5, 0.85), dens: k0, warp: 0.3, level: 2, seed: rand() });
      }
    }
  }
}

export interface FireSource { c: Vec3; r: number; w: number }

/**
 * Fire-light emitters (world metres) for the light bake: the hot FIRE_SPECS masses (weights sum to 1)
 * followed by the glowing outflow along the trench axis (weights relative to the fireball total).
 * The photo frame is unused now (everything is pad-local) but kept for API stability.
 */
export function fireSources(_fr: PhotoFrame, padYaw = DEFAULT_PAD_YAW): FireSource[] {
  const tot = FIRE_SPECS.reduce((a, s) => a + s.t * s.r * s.r, 0) || 1;
  const out: FireSource[] = FIRE_SPECS.map((s) => ({ c: padToWorld(s.lx, s.lz, s.h, padYaw), r: s.r, w: (s.t * s.r * s.r) / tot }));
  for (const g of GLOW_SPECS) out.push({ c: padToWorld(g.lx, g.lz, g.h, padYaw), r: g.r, w: g.w });
  return out;
}

/**
 * Pack puffs for instanced splatting: two vec4 per puff.
 *   a: (cx, cy, cz, r)            b: (temp, dens, warp, seed)
 */
export function packPuffs(puffs: Puff[]): { a: Float32Array; b: Float32Array } {
  const a = new Float32Array(puffs.length * 4), b = new Float32Array(puffs.length * 4);
  puffs.forEach((p, i) => {
    a.set([p.c[0], p.c[1], p.c[2], p.r], i * 4);
    b.set([p.temp, p.dens, p.warp, p.seed], i * 4);
  });
  return { a, b };
}

/** World-space AABB of all puffs (including the max radius warp). */
export function puffBounds(puffs: Puff[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of puffs) {
    const r = p.r * (1 + p.warp);
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.c[k] - r); max[k] = Math.max(max[k], p.c[k] + r); }
  }
  return { min, max };
}
