// Hand-designed coverage map for the background fair-weather cumulus.
// The clusters are authored in PHOTO space (pixel column, distance, altitude of the tops) and converted to world
// positions through the calibrated photo camera, so that from the photo view they sit where they do in the
// reference picture: upper-left, a big cluster behind and around the rocket, and the right-centre.
import * as THREE from 'three';
import { ANCHORS } from '../scene-config.ts';
import { rng } from './noise.ts';

/** Absolute altitude (m above the local ground) of the cumulus slab. */
export const CLOUD_BASE = 820;
export const CLOUD_TOP = 2900;
/** Half size of the coverage map in metres (the map spans +-EXTENT around the origin). */
export const COVER_EXTENT = 26000;

const PHOTO_F = 943 / 2 / Math.tan((45.2 / 2) * Math.PI / 180); // focal length in photo pixels (see scene.camera.vfov)
const PHOTO_CX = 838.5;

interface Blob {
  /** Photo pixel column of the blob centre (photo is 1677 px wide). */
  u: number;
  /** Photo pixel row of the cloud TOP (the row in the reference photo where this tower's silhouette peaks). */
  topRow: number;
  /** Distance from the photo camera along the ground, km. */
  range: number;
  /** Width across the line of sight, km. */
  width: number;
  /** Depth along the line of sight, km (default 0.8 * width). */
  depth?: number;
  /** Peak coverage (0..1). */
  cover?: number;
  /** 0 = flat stratocumulus, 1 = towering (drives erosion strength). */
  type?: number;
}

/** Cloud-top altitude (m above ground) implied by a photo row at a given range (km). */
function topFromRow(row: number, rangeKm: number): number {
  const pitch = Math.asin((ANCHORS.photoCamera.target.y - ANCHORS.photoCamera.pos.y) / 700); // photo camera looks 700 m ahead
  const elev = pitch + Math.atan((PHOTO_CY - row) / PHOTO_F);
  return ANCHORS.photoCamera.pos.y + rangeKm * 1000 * Math.tan(elev);
}
const PHOTO_CY = 471.5;
/** The noise-eroded silhouette sits below the blob envelope, and the photo's clouds are fat; compensate. */
const TOP_GAIN = 1.4;
const WIDTH_GAIN = 1.5;

// Authored against research/reference.jpeg. Bases in the photo sit at rows ~330 (left, ~4.3 km), ~405 (centre, ~6.8 km)
// and 425-470 (small far puffs, 10-14 km); the slab base is 820 m. Ranges follow from those rows.
export const CLOUD_BLOBS: Blob[] = [
  // A: far-left cluster (x 0..170, tops at rows 125-190)
  { u: 20, topRow: 190, range: 4.3, width: 0.75, type: 0.6 },
  { u: 105, topRow: 148, range: 4.3, width: 0.55, type: 0.7 },
  // B: left-centre diagonal mass rising to the right (peaks at rows 230 -> 110)
  { u: 262, topRow: 262, range: 4.4, width: 0.8, type: 0.6 },
  { u: 345, topRow: 200, range: 4.5, width: 0.62, type: 0.75 },
  { u: 432, topRow: 138, range: 4.6, width: 0.62, type: 0.95 },
  { u: 500, topRow: 190, range: 4.6, width: 0.5, type: 0.8 },
  // C: big central mass behind and around the rocket (x 520..1250, rows 85..400)
  { u: 610, topRow: 245, range: 6.4, width: 1.15, type: 0.6 },
  { u: 790, topRow: 92, range: 6.5, width: 1.0, type: 1.0 },
  { u: 925, topRow: 180, range: 6.7, width: 1.3, type: 0.85 },
  { u: 1075, topRow: 195, range: 7.0, width: 1.1, type: 0.7 },
  { u: 1170, topRow: 140, range: 7.3, width: 0.75, type: 0.9 },
  // small far puffs near the horizon (a broken line of humilis behind the rocket)
  { u: 600, topRow: 425, range: 11.0, width: 0.8, type: 0.4 },
  { u: 900, topRow: 425, range: 12.0, width: 0.6, type: 0.4 },
  { u: 1010, topRow: 450, range: 12.5, width: 0.9, type: 0.3 },
  { u: 700, topRow: 445, range: 13.0, width: 0.7, type: 0.3 },
  { u: 1130, topRow: 440, range: 12.0, width: 0.8, type: 0.3 },
  { u: 1330, topRow: 330, range: 9.0, width: 0.8, type: 0.5 },
  // long, low, hazy strips near the horizon (the photo has broken stratocumulus lines behind the steam banks)
  { u: 1190, topRow: 458, range: 15.0, width: 2.4, depth: 0.5, type: 0.2 },
  { u: 1310, topRow: 445, range: 14.0, width: 1.9, depth: 0.5, type: 0.25 },
  { u: 760, topRow: 465, range: 16.0, width: 2.6, depth: 0.5, type: 0.2 },
  { u: 420, topRow: 470, range: 18.0, width: 3.2, depth: 0.6, type: 0.2 },
  { u: 90, topRow: 470, range: 16.0, width: 2.4, depth: 0.5, type: 0.2 },
];

/** World-space blob centre for a photo blob. */
export function blobWorld(b: Blob): { x: number; z: number; az: number } {
  const p = ANCHORS.photoCamera;
  const heading = Math.atan2(p.target.x - p.pos.x, -(p.target.z - p.pos.z)); // radians clockwise from north
  const az = heading + Math.atan((b.u - PHOTO_CX) / PHOTO_F);
  return { az, x: p.pos.x + b.range * 1000 * Math.sin(az), z: p.pos.z - b.range * 1000 * Math.cos(az) };
}

/**
 * Rasterise the coverage map. R = coverage, G = top height as a fraction of the slab, B = type, A = 1.
 * A little value-noise warp makes the footprints irregular so no cluster looks like an ellipse.
 */
export function buildCoverTexture(n = 1024): THREE.DataTexture {
  const data = new Uint8Array(n * n * 4);
  const r = rng(77);
  // warp lattice
  const W = 64; const wl = new Float32Array(W * W * 2); for (let i = 0; i < wl.length; i++) wl[i] = r() * 2 - 1;
  const wsample = (x: number, y: number, ch: number) => {
    const fx = ((x % W) + W) % W, fy = ((y % W) + W) % W; const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy; const s = (t: number) => t * t * (3 - 2 * t);
    const g = (i: number, j: number) => wl[(((j % W) + W) % W * W + ((i % W) + W) % W) * 2 + ch];
    const a = g(ix, iy) * (1 - s(tx)) + g(ix + 1, iy) * s(tx), b = g(ix, iy + 1) * (1 - s(tx)) + g(ix + 1, iy + 1) * s(tx);
    return a * (1 - s(ty)) + b * s(ty);
  };
  const blobs = CLOUD_BLOBS.map((b) => {
    const w = blobWorld(b);
    return { ...w, hw: (b.width * WIDTH_GAIN * 1000) / 2, hd: ((b.depth ?? b.width * 0.8) * WIDTH_GAIN * 1000) / 2, top: Math.min(1, TOP_GAIN * (topFromRow(b.topRow, b.range) - CLOUD_BASE) / (CLOUD_TOP - CLOUD_BASE)), cover: b.cover ?? 1, type: b.type ?? 0.7 };
  });
  const px = (2 * COVER_EXTENT) / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const wx = -COVER_EXTENT + (i + 0.5) * px, wz = -COVER_EXTENT + (j + 0.5) * px;
    // domain warp (two scales)
    const qx = wx / 1800, qz = wz / 1800;
    const dx = 520 * wsample(qx, qz, 0) + 190 * wsample(qx * 3.1, qz * 3.1, 1);
    const dz = 520 * wsample(qx + 7.3, qz + 3.1, 1) + 190 * wsample(qx * 3.1 + 5.7, qz * 3.1 + 1.3, 0);
    const x = wx + dx, z = wz + dz;
    let cover = 0, top = 0, type = 0, wsum = 0;
    for (const b of blobs) {
      // ellipse aligned with the line of sight from the photo camera
      const ox = x - b.x, oz = z - b.z;
      const ca = Math.cos(b.az), sa = Math.sin(b.az); // line-of-sight axis = (sa, -ca)
      const par = ox * sa - oz * ca, perp = ox * ca + oz * sa;
      const q = (perp / b.hw) ** 2 + (par / b.hd) ** 2;
      if (q > 1.6) continue;
      const f = Math.pow(Math.max(0, 1 - q), 1.05) * b.cover;
      if (f > 0) { cover = Math.max(cover, f); const wgt = f * f; top += b.top * wgt; type += b.type * wgt; wsum += wgt; }
    }
    const o = (j * n + i) * 4;
    data[o] = Math.round(255 * Math.min(1, cover));
    data[o + 1] = wsum > 0 ? Math.round(255 * Math.min(1, top / wsum)) : 0;
    data[o + 2] = wsum > 0 ? Math.round(255 * Math.min(1, type / wsum)) : 0;
    data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false; tex.needsUpdate = true;
  return tex;
}
