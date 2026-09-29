// Small CPU-generated tileable noise textures used by the post effects (heat haze).
// OWNER: post-processing module. Generated once at start-up; nothing here runs per frame.
import * as THREE from 'three';

/** Deterministic integer hash -> [0,1). */
function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Periodic value noise on a cells x cells lattice (period = cells), quintic interpolation. */
function periodicValueNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells, y = v * cells;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const xa = ((x0 % cells) + cells) % cells, xb = (xa + 1) % cells;
  const ya = ((y0 % cells) + cells) % cells, yb = (ya + 1) % cells;
  const a = hash2(xa, ya, seed), b = hash2(xb, ya, seed), c = hash2(xa, yb, seed), d = hash2(xb, yb, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Tileable 2-channel fBm noise (RG8, 0..1, mean 0.5). The channels use different seeds so they
 * decorrelate and give a 2D displacement vector. 4 octaves at 4, 8, 16, 32 cells per tile.
 */
export function createTileableNoiseRG(size = 256, seed = 1): THREE.DataTexture {
  const data = new Uint8Array(size * size * 2);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size, v = j / size;
      for (let ch = 0; ch < 2; ch++) {
        let sum = 0, amp = 0.5, norm = 0;
        for (let o = 0; o < 4; o++) {
          sum += amp * periodicValueNoise(u, v, 4 << o, seed * 7 + ch * 131 + o * 17);
          norm += amp;
          amp *= 0.5;
        }
        // Stretch the (narrow) fBm histogram back toward 0..1 around 0.5.
        const n = (sum / norm - 0.5) * 1.9 + 0.5;
        data[(j * size + i) * 2 + ch] = Math.max(0, Math.min(255, Math.round(n * 255)));
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  tex.name = 'post.noiseRG';
  return tex;
}
