// CPU-generated tileable noise textures used by the environment shaders.
// Everything here runs once at init; the results are sampled with REPEAT wrapping.
import * as THREE from 'three';

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ihash3(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Tileable 3D Worley (F1) noise: `cells` cells per unit tile; returns distance normalised to ~0..1. */
function worley3(u: number, v: number, w: number, cells: number, seed: number): number {
  const x = u * cells, y = v * cells, z = w * cells;
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let best = 1e9;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx, cy = iy + dy, cz = iz + dz;
    const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells, wz = ((cz % cells) + cells) % cells;
    const px = cx + ihash3(wx, wy, wz, seed), py = cy + ihash3(wx, wy, wz, seed + 17), pz = cz + ihash3(wx, wy, wz, seed + 31);
    const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
    if (d < best) best = d;
  }
  return Math.min(Math.sqrt(best), 1);
}

/** Tileable 3D gradient (Perlin) noise in -1..1, `cells` lattice cells per tile. */
function perlin3(u: number, v: number, w: number, cells: number, seed: number): number {
  const x = u * cells, y = v * cells, z = w * cells;
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const s = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const sx = s(fx), sy = s(fy), sz = s(fz);
  const g = (cx: number, cy: number, cz: number, dx: number, dy: number, dz: number) => {
    const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells, wz = ((cz % cells) + cells) % cells;
    const a = ihash3(wx, wy, wz, seed) * 6.2831853, b = ihash3(wx, wy, wz, seed + 5) * 2 - 1;
    const r = Math.sqrt(1 - b * b);
    return Math.cos(a) * r * dx + Math.sin(a) * r * dy + b * dz;
  };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(
    lerp(lerp(g(ix, iy, iz, fx, fy, fz), g(ix + 1, iy, iz, fx - 1, fy, fz), sx), lerp(g(ix, iy + 1, iz, fx, fy - 1, fz), g(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz), sx), sy),
    lerp(lerp(g(ix, iy, iz + 1, fx, fy, fz - 1), g(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1), sx), lerp(g(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1), g(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1), sx), sy),
    sz);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const remap = (x: number, a: number, b: number, c: number, d: number) => c + ((x - a) / (b - a)) * (d - c);

/**
 * Cloud shape noise. R = Perlin-Worley (billowy base), G/B/A = inverted Worley at 2/4/8 cells (higher = denser core).
 * Sized `n`^3 (64 by default: one tile spans ~2.5 km of cloud so repetition is hidden by the coverage map).
 */
export function makeCloudShapeNoise(n = 64): THREE.Data3DTexture {
  const data = new Uint8Array(n * n * n * 4);
  let i = 0;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n, v = (y + 0.5) / n, w = (z + 0.5) / n;
    const pf = 0.5 + 0.5 * (0.6 * perlin3(u, v, w, 4, 3) + 0.3 * perlin3(u, v, w, 8, 4) + 0.1 * perlin3(u, v, w, 16, 5));
    const w0 = 1 - worley3(u, v, w, 4, 11);
    const w1 = 1 - worley3(u, v, w, 8, 12);
    const w2 = 1 - worley3(u, v, w, 16, 13);
    const wf = w0 * 0.625 + w1 * 0.25 + w2 * 0.125;
    data[i++] = Math.round(255 * clamp01(remap(pf, wf - 1, 1, 0, 1)));
    data[i++] = Math.round(255 * clamp01(w0));
    data[i++] = Math.round(255 * clamp01(w1));
    data[i++] = Math.round(255 * clamp01(w2));
  }
  const tex = new THREE.Data3DTexture(data, n, n, n);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1; tex.needsUpdate = true;
  return tex;
}

/** Cloud erosion noise: inverted Worley at 3/6/12 cells in R/G/B (32^3). */
export function makeCloudDetailNoise(n = 32): THREE.Data3DTexture {
  const data = new Uint8Array(n * n * n * 4);
  let i = 0;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n, v = (y + 0.5) / n, w = (z + 0.5) / n;
    data[i++] = Math.round(255 * clamp01(1 - worley3(u, v, w, 3, 21)));
    data[i++] = Math.round(255 * clamp01(1 - worley3(u, v, w, 6, 22)));
    data[i++] = Math.round(255 * clamp01(1 - worley3(u, v, w, 12, 23)));
    data[i++] = 255;
  }
  const tex = new THREE.Data3DTexture(data, n, n, n);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1; tex.needsUpdate = true;
  return tex;
}

/**
 * Tileable 2D gradient-noise fbm textures: 4 independent channels (different seeds / base frequencies).
 * Gradient (Perlin) noise instead of value noise: no visible lattice alignment in the octaves. Each octave is rotated
 * by a fixed integer-safe angle via a per-octave gradient-table twist, so octaves do not share axes.
 */
export function makeNoise2D(n = 512): THREE.DataTexture {
  const data = new Uint8Array(n * n * 4);
  const chans = [
    { base: 8, oct: 6, seed: 101 }, { base: 6, oct: 6, seed: 202 }, { base: 16, oct: 5, seed: 303 }, { base: 4, oct: 7, seed: 404 },
  ];
  const quint = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  // gradient lattices: one unit vector per lattice point, with an octave-dependent twist so grids do not align
  const lattices = chans.map((c) => Array.from({ length: c.oct }, (_, o) => {
    const cells = c.base << o;
    const r = rng(c.seed + o * 7);
    const g = new Float32Array(cells * cells * 2);
    for (let i = 0; i < cells * cells; i++) { const a = r() * 6.2831853 + o * 0.9; g[i * 2] = Math.cos(a); g[i * 2 + 1] = Math.sin(a); }
    return { cells, g };
  }));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n, v = (y + 0.5) / n;
    for (let c = 0; c < 4; c++) {
      let amp = 0.5, sum = 0, norm = 0;
      for (const o of lattices[c]) {
        if (o.cells > n / 2) break;
        const px = u * o.cells, py = v * o.cells;
        const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
        const gd = (i: number, j: number, dx: number, dy: number) => {
          const wi = ((i % o.cells) + o.cells) % o.cells, wj = ((j % o.cells) + o.cells) % o.cells;
          const k = (wj * o.cells + wi) * 2;
          return o.g[k] * dx + o.g[k + 1] * dy;
        };
        const sx = quint(fx), sy = quint(fy);
        const a = gd(ix, iy, fx, fy) * (1 - sx) + gd(ix + 1, iy, fx - 1, fy) * sx;
        const b = gd(ix, iy + 1, fx, fy - 1) * (1 - sx) + gd(ix + 1, iy + 1, fx - 1, fy - 1) * sx;
        const val = 0.5 + 0.9 * (a * (1 - sy) + b * sy);       // gradient noise spans about +-0.7: remap to ~0..1
        sum += amp * val; norm += amp; amp *= 0.5;
      }
      data[(y * n + x) * 4 + c] = Math.round(255 * clamp01(sum / norm));
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 8; tex.needsUpdate = true;
  return tex;
}

/**
 * Tileable 2D cellular (Worley) noise for near-field ground detail: R = F1 (cell "domes", pebbles), G = F2 - F1
 * (cell edges: mud cracks), B = per-cell random value (plate-to-plate variation), A = F1 of a finer lattice.
 */
export function makeCellNoise(n = 256): THREE.DataTexture {
  const data = new Uint8Array(n * n * 4);
  const cellsA = 10, cellsB = 23;
  const pt = (cx: number, cy: number, cells: number, seed: number): [number, number, number] => {
    const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells;
    return [ihash3(wx, wy, 0, seed), ihash3(wx, wy, 1, seed + 13), ihash3(wx, wy, 2, seed + 29)];
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n, v = (y + 0.5) / n;
    // lattice A: F1, F2, id
    let f1 = 9, f2 = 9, id = 0;
    const ax = u * cellsA, ay = v * cellsA, ix = Math.floor(ax), iy = Math.floor(ay);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const p = pt(ix + dx, iy + dy, cellsA, 41);
      const d = Math.hypot(ix + dx + p[0] - ax, iy + dy + p[1] - ay);
      if (d < f1) { f2 = f1; f1 = d; id = p[2]; } else if (d < f2) f2 = d;
    }
    // lattice B: F1 only
    let g1 = 9;
    const bx = u * cellsB, by = v * cellsB, jx = Math.floor(bx), jy = Math.floor(by);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const p = pt(jx + dx, jy + dy, cellsB, 77);
      const d = Math.hypot(jx + dx + p[0] - bx, jy + dy + p[1] - by);
      if (d < g1) g1 = d;
    }
    const o = (y * n + x) * 4;
    data[o] = Math.round(255 * clamp01(f1 / 0.9));
    data[o + 1] = Math.round(255 * clamp01((f2 - f1) / 0.6));
    data[o + 2] = Math.round(255 * id);
    data[o + 3] = Math.round(255 * clamp01(g1 / 0.9));
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 8; tex.needsUpdate = true;
  return tex;
}

/**
 * Tileable wave slope map: RG = surface slope (dh/dx, dh/dy) of a smooth (quintic) value-noise fbm, encoded as
 * 0.5 + slope * SLOPE_ENC; BA = the same field one octave up. Slopes interpolate linearly, so the ocean normals stay
 * smooth (no faceting) and average out gracefully through the mip chain at distance.
 */
export const WAVE_SLOPE_ENC = 1.6;
export function makeWaveSlopes(n = 512): THREE.DataTexture {
  const heights = (base: number, oct: number, seed: number): Float32Array => {
    const h = new Float32Array(n * n);
    let amp = 1, tot = 0;
    for (let o = 0; o < oct; o++) {
      const cells = base << o;
      const r = rng(seed + o * 131);
      const lat = new Float32Array(cells * cells); for (let i = 0; i < lat.length; i++) lat[i] = r();
      const q = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const u = (x / n) * cells, v = (y / n) * cells;
        const ix = Math.floor(u), iy = Math.floor(v), fx = q(u - ix), fy = q(v - iy);
        const g = (i: number, j: number) => lat[((j % cells) * cells) + (i % cells)];
        const a = g(ix, iy) * (1 - fx) + g(ix + 1, iy) * fx, b = g(ix, iy + 1) * (1 - fx) + g(ix + 1, iy + 1) * fx;
        h[y * n + x] += amp * (a * (1 - fy) + b * fy);
      }
      tot += amp; amp *= 0.55;
    }
    for (let i = 0; i < h.length; i++) h[i] /= tot;
    return h;
  };
  const hA = heights(4, 6, 900), hB = heights(8, 5, 1700);
  const data = new Uint8Array(n * n * 4);
  const w = (i: number) => ((i % n) + n) % n;
  const enc = (v: number) => Math.round(255 * clamp01(0.5 + v * WAVE_SLOPE_ENC * 0.5));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const o = (y * n + x) * 4;
    // slope in units of (height per tile width) * (1/tile) -> scaled so a full-range fbm has slopes of order 1
    const sx = (hA[y * n + w(x + 1)] - hA[y * n + w(x - 1)]) * 0.5 * n / 24;
    const sy = (hA[w(y + 1) * n + x] - hA[w(y - 1) * n + x]) * 0.5 * n / 24;
    const tx = (hB[y * n + w(x + 1)] - hB[y * n + w(x - 1)]) * 0.5 * n / 24;
    const ty = (hB[w(y + 1) * n + x] - hB[w(y - 1) * n + x]) * 0.5 * n / 24;
    data[o] = enc(sx); data[o + 1] = enc(sy); data[o + 2] = enc(tx); data[o + 3] = enc(ty);
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 8; tex.needsUpdate = true;
  return tex;
}
