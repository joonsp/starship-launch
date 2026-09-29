// Layout of the background fair-weather cumulus, and the two textures the sky bake marches.
//
// Every cloud is a CELL: an ellipsoid whose widest section sits a little above the common, flat condensation level
// (CLOUD_BASE), which cuts it: flat bases, bulging flanks and a rounded crown. A cumulus cluster is a broad body plus
// turrets (smaller, taller ellipsoids centred on the body's top). The cells are turned into
//  - a 3D signed-distance volume of their smooth union (buildEnvelopeVolume), which the bake displaces with 3D billow
//    noise (see glsl/sky_bake.frag.glsl), so the clouds are round in every direction, and
//  - a 2D coverage map (buildCoverTexture) with exact distance fields of the footprints, so the bake can skip the
//    empty sky between cells in a few big steps.
//
// Two sources of cells:
//  - PHOTO_CELLS, authored in photo space (pixel column, row of the tower top, range) and placed through the calibrated
//    photo camera, so the photo view shows the clusters of research/reference.jpeg: a big cluster behind the rocket,
//    a ridge rising to the upper left of centre, a separate cluster at the far left and small cells along the horizon;
//  - a seeded procedural field of scattered fair-weather cumulus everywhere else, kept out of the photo's view wedge,
//    so orbit, walk and fly views see a plausible sky in every direction.
import * as THREE from 'three';
import { ANCHORS, applyPhotoCamera } from '../scene-config.ts';
import { rng } from './noise.ts';

/** Absolute altitude (m above the local ground) of the cumulus slab: common flat base and the highest possible top. */
export const CLOUD_BASE = 820;
export const CLOUD_TOP = 2900;
/** Half size of the coverage map in metres (the map spans +-EXTENT around the origin). */
export const COVER_EXTENT = 32000;
/** Coverage map resolution (texels per side): 62 m per texel (it only drives empty-space skipping). */
export const COVER_RES = 1024;
/** Range (m) of the inside distance (G channel) and of the outside distance (A channel). */
export const COVER_DIN = 1200;
export const COVER_DOUT = 6000;
/** Envelope volume: +-VOL_EXTENT horizontally at VOL_RES^2 texels, VOL_LAYERS layers of VOL_DY from VOL_Y0 up. */
export const VOL_EXTENT = 24000;
export const VOL_RES = 512;
export const VOL_LAYERS = 26;
export const VOL_Y0 = CLOUD_BASE - 120;
export const VOL_DY = 90;
/** Signed distances are stored in +-VOL_RANGE metres (8 bits). */
export const VOL_RANGE = 360;
/** Smooth-union radius (m): bodies and turrets merge without creases. */
const SMOOTH_K = 90;

const DEPTH = CLOUD_TOP - CLOUD_BASE;
const DEG = Math.PI / 180;
const PHOTO_W = 1677, PHOTO_H = 943;

/** A dome-topped cumulus tower in world space. */
export interface CloudCell {
  x: number; z: number;
  /** Footprint radius (m) across `axis`, and along it (elongated cells). */
  r: number; rAlong: number;
  /** Heading (radians clockwise from north) of the long axis. */
  axis: number;
  /** Top of the cell above the base (m). */
  h: number;
  /** Height above the base (m) of the ellipsoid centre, its widest section. The vertical semi-axis is h - yc. */
  yc: number;
  /** Lower vertical semi-axis as a fraction of the upper one: turrets sit ON their body (< 1), bodies are symmetric. */
  lo?: number;
}

/** A cell authored in photo space. */
interface PhotoCell {
  /** Photo pixel column (1677 px wide) of the tower centre. */
  u: number;
  /** Photo pixel row of the tower's TOP silhouette. */
  top: number;
  /** Horizontal range from the photo camera (km). */
  range: number;
  /** Footprint radius across the line of sight (km). */
  r: number;
  /** Depth / width ratio along the line of sight (default 1). */
  e?: number;
  /** Photo row of the widest section (the ellipsoid centre); default 12 % of the height (broad flat base). Turrets use their body top. */
  sh?: number;
  /** Lower semi-axis factor (default 0.45 with `sh`, i.e. a turret sitting on its body; 1 for a detached fragment). */
  lo?: number;
}

const cam = ANCHORS.photoCamera;
const PHOTO_HEADING = Math.atan2(cam.target.x - cam.pos.x, -(cam.target.z - cam.pos.z));
// the calibrated photo camera, for exact pixel -> world ray conversion (rows off the centre column have other elevations)
const photoCam = new THREE.PerspectiveCamera(cam.fovDeg, PHOTO_W / PHOTO_H, 0.5, 60000);
applyPhotoCamera(photoCam);
photoCam.updateMatrixWorld();

/** World direction of a photo pixel. */
function photoRay(u: number, row: number): THREE.Vector3 {
  return new THREE.Vector3((u / PHOTO_W) * 2 - 1, 1 - (row / PHOTO_H) * 2, 0.5).unproject(photoCam).sub(photoCam.position).normalize();
}

/** Altitude (m) at which the ray through photo pixel (u, row) reaches horizontal range `rangeM`. */
function altAt(u: number, row: number, rangeM: number): number {
  const d = photoRay(u, row);
  return cam.pos.y + rangeM * d.y / Math.hypot(d.x, d.z);
}

/** Photo-space cell -> world cell. The billows rise above the envelope by up to ~100 m on big towers (proportionally less
 * on small cells, whose billows are smaller); `topBias` removes that. */
function fromPhoto(c: PhotoCell, topBias = 100): CloudCell {
  const d = photoRay(c.u, c.top);
  const az = Math.atan2(d.x, -d.z);
  const R = c.range * 1000;
  const raw = altAt(c.u, c.top, R) - CLOUD_BASE;
  const h = Math.max(60, Math.min(DEPTH, raw - topBias * Math.min(1, raw / 700)));
  const yc = c.sh !== undefined ? Math.max(0, Math.min(h * 0.92, altAt(c.u, c.sh, R) - CLOUD_BASE)) : 0.12 * h;
  return {
    x: cam.pos.x + R * Math.sin(az), z: cam.pos.z - R * Math.cos(az),
    r: c.r * 1000, rAlong: c.r * 1000 * (c.e ?? 1), axis: az, h, yc, lo: c.lo ?? (c.sh !== undefined ? 0.45 : 1),
  };
}

// Authored against research/reference.jpeg (1677x943). The lowest visible row of a cloud is the FAR edge of its flat
// base (the underside is seen from below), so centres sit a little nearer than the base rows alone would suggest:
// the far-left cluster ends at row ~336 (far edge ~4.3 km), the band rising to the left of centre at ~355 (~4.7 km),
// the big cluster behind the rocket at ~400 (~6.7 km), the horizon cells at 430-490 (10-25 km).
// A cluster is a broad body plus turrets whose domes start at the body top (`sh`).
export const PHOTO_CELLS: PhotoCell[] = [
  // A: far-left cluster (x 0..170, two crowns at rows ~126 and ~142, dark base at ~330), extends out of the frame
  { u: -110, top: 160, range: 4.0, r: 0.45 },
  { u: 55, top: 165, range: 3.95, r: 0.42 },
  { u: 12, top: 110, range: 3.9, r: 0.24, sh: 175 },
  { u: 122, top: 126, range: 3.95, r: 0.22, sh: 180 },
  // B: a ridge rising to the right (x 170..510, tops from row ~285 to ~120)
  { u: 330, top: 245, range: 4.45, r: 0.42, e: 0.8 },
  { u: 205, top: 272, range: 4.3, r: 0.18, sh: 300 },
  { u: 285, top: 212, range: 4.35, r: 0.2, sh: 262 },
  { u: 352, top: 168, range: 4.4, r: 0.2, sh: 232 },
  { u: 410, top: 128, range: 4.4, r: 0.21, sh: 205 },
  { u: 468, top: 106, range: 4.45, r: 0.22, sh: 180 },
  { u: 505, top: 145, range: 4.5, r: 0.14, sh: 200 },
  // a small detached fragment high in the frame (top centre, x 380..470, rows 15..77)
  { u: 428, top: 10, range: 3.4, r: 0.14, sh: 42, lo: 1 },
  // C: the big cluster behind the rocket (x 500..1240, crowns at rows 80..200, flat dark base at ~400): three broad
  // bodies, a far body, the central tower with its shoulder, and lumps along the top
  { u: 640, top: 215, range: 6.1, r: 0.55, e: 1.2 },
  { u: 760, top: 212, range: 6.2, r: 0.45 },
  { u: 900, top: 165, range: 6.3, r: 0.62, e: 1.1 },
  { u: 1085, top: 188, range: 6.4, r: 0.5 },
  { u: 880, top: 205, range: 6.9, r: 0.6 },
  { u: 540, top: 228, range: 6.0, r: 0.26, sh: 250 },
  { u: 668, top: 192, range: 6.0, r: 0.28, sh: 238 },
  { u: 835, top: 80, range: 6.0, r: 0.42, sh: 200 },
  { u: 950, top: 100, range: 6.1, r: 0.22, sh: 165 },
  { u: 1005, top: 135, range: 6.2, r: 0.26, sh: 190 },
  { u: 1068, top: 162, range: 6.2, r: 0.27, sh: 220 },
  { u: 1185, top: 122, range: 6.3, r: 0.32, sh: 205 },
  // flat fragments under and beyond the central cluster (rows 410..470)
  { u: 625, top: 425, range: 10.0, r: 0.3, e: 0.6 },
  { u: 960, top: 418, range: 10.5, r: 0.45, e: 0.6 },
  { u: 1075, top: 432, range: 12.0, r: 0.4, e: 0.6 },
  // far horizon: a broken bank of flat humilis (rows 440..495)
  { u: 740, top: 458, range: 16.0, r: 0.9, e: 0.5 },
  { u: 1180, top: 452, range: 15.0, r: 0.7, e: 0.5 },
  { u: 1400, top: 450, range: 15.0, r: 0.8, e: 0.5 },
  { u: 470, top: 468, range: 19.0, r: 1.0, e: 0.5 },
  { u: 150, top: 460, range: 16.0, r: 0.8, e: 0.5 },
  // right third (mostly behind the launch steam in the photo; seen from other views)
  { u: 1330, top: 260, range: 8.0, r: 0.45 },
  { u: 1500, top: 300, range: 7.5, r: 0.45 },
  { u: 1640, top: 240, range: 8.5, r: 0.5 },
];

// ── cirrus ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Cirrus deck altitude (m) the patches are authored for (SKY_LOOK.cirrusAlt). */
const CIRRUS_ALT = 9200;

/** Point (km) on the cirrus deck seen through photo pixel (u, row). */
function deckPoint(u: number, row: number): [number, number] {
  const d = photoRay(u, row);
  const t = (CIRRUS_ALT - cam.pos.y) / Math.max(d.y, 0.02);
  return [(cam.pos.x + d.x * t) / 1000, (cam.pos.z + d.z * t) / 1000];
}

/**
 * Authored cirrus patches (x km, z km, radius km, strength): in the photo the mares' tails are densest at the upper
 * right and fibrous veils cross the top centre and the upper left. Elsewhere the bake adds broad random patches.
 */
export const CIRRUS_PATCHES: Array<[number, number, number, number]> = [
  [...deckPoint(1350, 110), 16, 1.0],
  [...deckPoint(1620, 40), 11, 1.0],
  [...deckPoint(1200, 70), 7, 0.6],
  [...deckPoint(620, 115), 6, 0.7],
  [...deckPoint(280, 185), 9, 0.55],
];

/** The straight contrail at the top centre of the photo (x km, z km, heading rad, half length km). */
export const CONTRAIL: [number, number, number, number] = [...deckPoint(705, 45), 49.5 * DEG, 11];

/** Azimuth (radians clockwise from north) of a world point seen from the photo camera, relative to the view axis. */
function photoRelAz(x: number, z: number): number {
  const az = Math.atan2(x - cam.pos.x, -(z - cam.pos.z));
  let d = az - PHOTO_HEADING;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Seeded procedural field of scattered fair-weather cumulus outside the photo's view wedge. */
function proceduralCells(seed = 1403): CloudCell[] {
  const r = rng(seed);
  const cells: CloudCell[] = [];
  const S = 2300;                            // jittered grid spacing (m)
  const E = VOL_EXTENT - 1200;
  const halfFov = 36.5 * DEG, margin = 9 * DEG;
  for (let gz = -E; gz <= E; gz += S) for (let gx = -E; gx <= E; gx += S) {
    const x = gx + (r() - 0.5) * S * 0.9, z = gz + (r() - 0.5) * S * 0.9;
    const u = r();                           // draw every number even when the cell is skipped (stable layout)
    const rMain = 260 + 520 * Math.pow(r(), 1.6);
    const tall = r(), nTur = Math.floor(r() * 4.2), sa = r() * 6.283;
    r();
    const jit = [r(), r(), r(), r(), r(), r(), r(), r(), r(), r(), r(), r()];
    if (u > 0.5) continue;                   // about half of the grid points carry a cluster
    const dist = Math.hypot(x - cam.pos.x, z - cam.pos.z);
    if (Math.abs(photoRelAz(x, z)) < halfFov + margin && dist > 800) continue;   // the photo wedge is authored
    if (Math.hypot(x, z) < 1800) continue;  // keep the sky right above the pad clear
    const h = Math.min(DEPTH * 0.8, rMain * (0.6 + 1.5 * tall * tall) + 80);
    cells.push({ x, z, r: rMain, rAlong: rMain * (0.9 + 0.3 * jit[0]), axis: sa, h, yc: h * (0.05 + 0.15 * jit[4]) });
    for (let k = 0; k < nTur; k++) {
      // turrets stay inside the body footprint and sit on it (short lower half), so nothing overhangs like a mushroom
      const rt = rMain * (0.35 + 0.25 * jit[9 + (k % 3)]);
      const a = sa + k * 2.1 + jit[1 + k] * 1.2, d = (rMain - rt) * (0.2 + 0.7 * jit[5 + k]);
      const ht = Math.min(DEPTH * 0.85, h * (0.7 + 0.55 * jit[1 + ((k + 2) % 4)]));
      const fall = Math.sqrt(Math.max(0, 1 - (d / rMain) ** 2));        // body height fraction above the turret centre
      cells.push({ x: x + d * Math.sin(a), z: z - d * Math.cos(a), r: rt, rAlong: rt, axis: 0, h: ht, yc: Math.min(ht * 0.7, h * 0.55 * fall), lo: 0.45 });
    }
  }
  return cells;
}

let cellCache: CloudCell[] | null = null;
/** All cells (memoised: the coverage map and the envelope volume share them). */
export function allCells(): CloudCell[] {
  cellCache ??= [...PHOTO_CELLS.map((c) => fromPhoto(c)), ...proceduralCells()];
  return cellCache;
}

/** Horizontal radius factor of a cell's footprint at the base (the base plane may cut below its widest section). */
function footprintScale(c: CloudCell): number {
  const ry = Math.max(c.h - c.yc, 1);
  return c.yc >= 0 ? 1 : Math.sqrt(Math.max(0, 1 - (c.yc / ry) ** 2));
}

/** Felzenszwalb-Huttenlocher squared Euclidean distance transform, in place over rows then columns (texel units). */
function edt(f: Float32Array, n: number): void {
  const d = new Float32Array(n), v = new Int32Array(n), zz = new Float32Array(n + 1), g = new Float32Array(n);
  const pass = (get: (i: number) => number, set: (i: number, x: number) => void) => {
    for (let i = 0; i < n; i++) g[i] = get(i);
    let k = 0; v[0] = 0; zz[0] = -Infinity; zz[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = ((g[q] + q * q) - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= zz[k]) { k--; s = ((g[q] + q * q) - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; zz[k] = s; zz[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (zz[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + g[v[k]]; }
    for (let i = 0; i < n; i++) set(i, d[i]);
  };
  for (let y = 0; y < n; y++) pass((i) => f[y * n + i], (i, x) => { f[y * n + i] = x; });
  for (let x = 0; x < n; x++) pass((i) => f[i * n + x], (i, val) => { f[i * n + x] = val; });
}

/**
 * Coverage map for empty-space skipping. R = union of the cell tops / slab depth (debug view), G = 2D distance inside
 * the footprint union / COVER_DIN, B = 0, A = 2D distance outside the footprints / COVER_DOUT.
 * `minRes` is a lower bound on the resolution (the map never goes below COVER_RES).
 */
export function buildCoverTexture(minRes = COVER_RES, cells: CloudCell[] = allCells()): THREE.DataTexture {
  const n = Math.max(minRes, COVER_RES);
  const px = (2 * COVER_EXTENT) / n;
  const top = new Float32Array(n * n);
  for (const c of cells) {
    const f = footprintScale(c);
    const ra = c.rAlong * f, rc = c.r * f, R = Math.max(ra, rc);
    const i0 = Math.max(0, Math.floor((c.x - R + COVER_EXTENT) / px)), i1 = Math.min(n - 1, Math.ceil((c.x + R + COVER_EXTENT) / px));
    const j0 = Math.max(0, Math.floor((c.z - R + COVER_EXTENT) / px)), j1 = Math.min(n - 1, Math.ceil((c.z + R + COVER_EXTENT) / px));
    const sa = Math.sin(c.axis), ca = Math.cos(c.axis);      // long axis = (sin, -cos) in (x, z)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const ox = -COVER_EXTENT + (i + 0.5) * px - c.x, oz = -COVER_EXTENT + (j + 0.5) * px - c.z;
      const along = ox * sa - oz * ca, across = ox * ca + oz * sa;
      const q2 = (along / ra) ** 2 + (across / rc) ** 2;
      if (q2 >= 1) continue;
      const t = c.h * Math.sqrt(1 - q2);
      const o = j * n + i;
      if (t > top[o]) top[o] = t;
    }
  }
  // distance fields of the footprint union (texel units, squared)
  const fin = new Float32Array(n * n), fout = new Float32Array(n * n);
  const INF = 1e20;
  for (let o = 0; o < n * n; o++) { const inside = top[o] > 0; fout[o] = inside ? 0 : INF; fin[o] = inside ? INF : 0; }
  edt(fout, n); edt(fin, n);
  const data = new Uint8Array(n * n * 4);
  for (let o = 0; o < n * n; o++) {
    const din = top[o] > 0 ? Math.sqrt(fin[o]) * px - 0.5 * px : 0;
    const dout = top[o] > 0 ? 0 : Math.sqrt(fout[o]) * px - 0.5 * px;
    data[o * 4] = Math.round(255 * Math.min(1, top[o] / DEPTH));
    data[o * 4 + 1] = Math.round(255 * Math.min(1, Math.max(0, din) / COVER_DIN));
    data[o * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, dout) / COVER_DOUT));
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false; tex.needsUpdate = true;
  tex.name = 'env.cloudCover';
  return tex;
}

/**
 * Signed distance (m, positive INSIDE) of the smooth union of the cells, cut by the base plane, sampled on a
 * VOL_RES x VOL_RES x VOL_LAYERS grid and stored as 0.5 + d / (2 VOL_RANGE) in an R8 3D texture (x -> u, z -> v,
 * altitude -> w). Cells are binned on a coarse grid, so each voxel column only visits the cells that can reach it.
 */
export function buildEnvelopeVolume(cells: CloudCell[] = allCells()): THREE.Data3DTexture {
  const n = VOL_RES, L = VOL_LAYERS;
  const px = (2 * VOL_EXTENT) / n;
  const reach = VOL_RANGE + SMOOTH_K;
  // bins of 8x8 columns
  const B = 8, nb = Math.ceil(n / B);
  const bins: number[][] = Array.from({ length: nb * nb }, () => []);
  cells.forEach((c, idx) => {
    const R = Math.max(c.r, c.rAlong) + reach;
    const i0 = Math.max(0, Math.floor((c.x - R + VOL_EXTENT) / px / B)), i1 = Math.min(nb - 1, Math.floor((c.x + R + VOL_EXTENT) / px / B));
    const j0 = Math.max(0, Math.floor((c.z - R + VOL_EXTENT) / px / B)), j1 = Math.min(nb - 1, Math.floor((c.z + R + VOL_EXTENT) / px / B));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) bins[j * nb + i].push(idx);
  });
  const P = cells.map((c) => ({
    x: c.x, z: c.z, sa: Math.sin(c.axis), ca: Math.cos(c.axis),
    ra: c.rAlong, rc: c.r, ry: Math.max(c.h - c.yc, 20), ryLo: Math.max(c.h - c.yc, 20) * (c.lo ?? 1), yc: CLOUD_BASE + c.yc,
    rmax: Math.max(c.r, c.rAlong),
  }));
  const data = new Uint8Array(n * n * L);        // 0 encodes d = -VOL_RANGE (far outside)
  const col = new Float32Array(L);
  const near: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const wx = -VOL_EXTENT + (i + 0.5) * px, wz = -VOL_EXTENT + (j + 0.5) * px;
    const bin = bins[(j >> 3) * nb + (i >> 3)];
    near.length = 0;
    for (const idx of bin) { const c = P[idx]; if (Math.hypot(wx - c.x, wz - c.z) < c.rmax + reach) near.push(idx); }
    if (near.length === 0) continue;
    col.fill(1e9);
    for (const idx of near) {
      const c = P[idx];
      const ox = wx - c.x, oz = wz - c.z;
      const pa = ox * c.sa - oz * c.ca, pc = ox * c.ca + oz * c.sa;
      for (let k = 0; k < L; k++) {
        const py = VOL_Y0 + (k + 0.5) * VOL_DY - c.yc;
        const ry = py > 0 ? c.ry : c.ryLo;            // turrets have a short lower half: they sit on their body
        // ellipsoid distance bound (Quilez): k0 (k0 - 1) / k1
        const a = pa / c.ra, b = py / ry, d = pc / c.rc;
        const k0 = Math.sqrt(a * a + b * b + d * d);
        const a2 = pa / (c.ra * c.ra), b2 = py / (ry * ry), d2 = pc / (c.rc * c.rc);
        const k1 = Math.sqrt(a2 * a2 + b2 * b2 + d2 * d2);
        const sd = k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(c.ra, ry, c.rc);
        // polynomial smooth minimum
        const m = col[k];
        const hh = Math.max(SMOOTH_K - Math.abs(m - sd), 0) / SMOOTH_K;
        col[k] = Math.min(m, sd) - hh * hh * SMOOTH_K * 0.25;
      }
    }
    for (let k = 0; k < L; k++) {
      const y = VOL_Y0 + (k + 0.5) * VOL_DY;
      const sd = Math.max(col[k], CLOUD_BASE - y);   // flat base: intersect with the half-space above the base
      data[(k * n + j) * n + i] = Math.round(255 * Math.min(1, Math.max(0, 0.5 - sd / (2 * VOL_RANGE))));
    }
  }
  const tex = new THREE.Data3DTexture(data, n, n, L);
  tex.format = THREE.RedFormat; tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1; tex.needsUpdate = true;
  tex.name = 'env.cloudEnvelope';
  return tex;
}
