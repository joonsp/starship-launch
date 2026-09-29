// Near-ground salt-marsh grass: instanced crossed-quad tufts scattered over the OSM scrub polygons around the camera.
// Only built when the camera is close to the ground (walk / low fly), rebuilt when it moves; a frozen still has
// nothing to sway (uDrift = 0), in slow-drift mode the tips move a little through the shared globals.
import * as THREE from 'three';
import type { Globals } from '../contracts.ts';
import { applyGlobals } from '../core/material-hooks.ts';
import { INNER_HALF } from './splat.ts';
import { rng } from './noise.ts';
import { authoredPoolSdf, roadCorridorAcross } from './terrain.ts';

const MAX_TUFTS = 60000;
const RADIUS = 70;          // tufts are laid within this distance of the camera (m)
const ACTIVE_HEIGHT = 45;   // camera height below which tufts exist (m)

function makeBladeTexture(): THREE.CanvasTexture {
  const w = 128, h = 128;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  const r = rng(9);
  // a fan of blades: darker at the root, lighter and yellower at the tips
  for (let i = 0; i < 22; i++) {
    const x0 = w * (0.18 + 0.64 * r());
    const lean = (r() - 0.5) * 0.5;
    const top = h * (0.05 + 0.5 * r());
    const wd = 2 + r() * 3.2;
    const grad = g.createLinearGradient(0, h, 0, top);
    grad.addColorStop(0, '#2b2b16'); grad.addColorStop(0.5, '#4f5028'); grad.addColorStop(1, '#8a8748');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x0 - wd, h);
    g.quadraticCurveTo(x0 - wd * 0.4 + lean * h * 0.3, h * 0.55, x0 + lean * h * 0.9, top);
    g.quadraticCurveTo(x0 + wd * 0.4 + lean * h * 0.3, h * 0.55, x0 + wd, h);
    g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class Vegetation {
  readonly mesh: THREE.InstancedMesh;
  private lastCentre = new THREE.Vector2(1e9, 1e9);
  private scrubImg?: { data: Uint8ClampedArray; flat: Uint8ClampedArray; n: number };
  private tex: THREE.CanvasTexture;
  private material: THREE.MeshStandardMaterial;

  constructor(globals: Globals) {
    this.tex = makeBladeTexture();
    // two crossed vertical quads with the root at y = 0
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    const q2 = quad.clone().rotateY(Math.PI / 2);
    const geo = mergeTwo(quad, q2);
    const mat = new THREE.MeshStandardMaterial({ map: this.tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uSlTime;\nuniform float uSlDrift;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  {
    // sway grows with height; instanceMatrix translation decorrelates the phase between tufts
    float ph = uSlTime * 1.7 + instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.27;
    transformed.x += sin(ph) * 0.06 * position.y * uSlDrift;
    transformed.z += cos(ph * 1.3) * 0.04 * position.y * uSlDrift;
  }`);
    };
    mat.customProgramCacheKey = () => 'env-grass-v1';
    this.material = applyGlobals(mat, globals, { kelvin: 294, cacheKey: 'env-grass' });
    this.mesh = new THREE.InstancedMesh(geo, this.material, MAX_TUFTS);
    this.mesh.name = 'env.vegetation';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.receiveShadow = true;
  }

  /** Give the vegetation the inner splat canvases so it can read where the scrub / flats are. */
  setSplatCanvas(a: HTMLCanvasElement): void {
    const n = a.width;
    const img = a.getContext('2d')!.getImageData(0, 0, n, n).data;
    // keep only the two channels we need (R flat, G scrub) to limit memory: 2 x n^2 bytes
    const scrub = new Uint8ClampedArray(n * n), flat = new Uint8ClampedArray(n * n);
    for (let i = 0; i < n * n; i++) { flat[i] = img[i * 4]; scrub[i] = img[i * 4 + 1]; }
    this.scrubImg = { data: scrub, flat, n };
    this.lastCentre.set(1e9, 1e9);
  }

  update(cam: THREE.Vector3): void {
    if (!this.scrubImg) return;
    if (cam.y > ACTIVE_HEIGHT) { this.mesh.count = 0; this.lastCentre.set(1e9, 1e9); return; }
    if (this.lastCentre.distanceTo(new THREE.Vector2(cam.x, cam.z)) < RADIUS * 0.35) return;
    this.lastCentre.set(cam.x, cam.z);
    const { data, flat, n } = this.scrubImg;
    const s = n / (2 * INNER_HALF);
    const r = rng(Math.floor(cam.x / 20) * 7919 + Math.floor(cam.z / 20) * 104729);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let count = 0;
    // stratified jitter over the disc so density is uniform and the layout is stable while the camera walks
    const cell = 1.05;
    const x0 = Math.floor((cam.x - RADIUS) / cell), x1 = Math.floor((cam.x + RADIUS) / cell);
    const z0 = Math.floor((cam.z - RADIUS) / cell), z1 = Math.floor((cam.z + RADIUS) / cell);
    for (let cz = z0; cz <= z1 && count < MAX_TUFTS; cz++) for (let cx = x0; cx <= x1 && count < MAX_TUFTS; cx++) {
      const h = hash2(cx, cz);
      const x = (cx + hash2(cx + 17, cz)) * cell, z = (cz + hash2(cx, cz + 31)) * cell;
      const d = Math.hypot(x - cam.x, z - cam.z);
      if (d > RADIUS) continue;
      // density falls with distance so far tufts do not cost anything
      if (h > 0.75 * Math.pow(1 - d / RADIUS, 1.3)) continue;
      const px = Math.floor((x + INNER_HALF) * s), pz = Math.floor((z + INNER_HALF) * s);
      if (px < 0 || pz < 0 || px >= n || pz >= n) continue;
      const i = pz * n + px;
      const veg = data[i] / 255;
      if (veg < 0.5 || flat[i] > 200 && veg < 0.8) continue;
      // no grass in the authored pools (and their damp shore band) or in the dark wet road corridor
      if (authoredPoolSdf(x, z) < 22) continue;
      if (x < -170 && h > 0.12) { const a = roadCorridorAcross(x, z); if (a < 90 && a > -230) continue; }
      const sz = 0.22 + 0.34 * r() * r() + 0.14 * r();
      pos.set(x, 0, z);
      q.setFromAxisAngle(up, r() * Math.PI);
      sc.set(sz * (0.8 + 0.6 * r()), sz, sz * (0.8 + 0.6 * r()));
      m.compose(pos, q, sc);
      this.mesh.setMatrixAt(count++, m);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void { this.mesh.geometry.dispose(); this.material.dispose(); this.tex.dispose(); this.mesh.dispose(); }
}

function hash2(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const attrs = ['position', 'normal', 'uv'] as const;
  for (const k of attrs) {
    const A = a.getAttribute(k) as THREE.BufferAttribute, B = b.getAttribute(k) as THREE.BufferAttribute;
    const arr = new Float32Array(A.array.length + B.array.length);
    arr.set(A.array as Float32Array, 0); arr.set(B.array as Float32Array, A.array.length);
    g.setAttribute(k, new THREE.BufferAttribute(arr, A.itemSize));
  }
  const ia = a.getIndex()!.array, ib = b.getIndex()!.array;
  const off = (a.getAttribute('position') as THREE.BufferAttribute).count;
  const idx = new Uint16Array(ia.length + ib.length);
  idx.set(ia as Uint16Array, 0);
  for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + off;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
