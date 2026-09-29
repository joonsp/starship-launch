// Simple extruded OSM buildings (walls + flat/lightly-pitched roofs) with a handful of materials.
// Skipped on purpose: kind "structure" (tanks, gantries, pipelines: the pad module owns those), anything inside the
// pad zone, Pad 1's "Flame Trench" building (its height tag 146 is wrong), and holes (courtyards).
import * as THREE from 'three';
import type { Globals } from '../contracts.ts';
import { applyGlobals } from '../core/material-hooks.ts';
import { inPadZone } from './roads.ts';
import type { SiteData, SiteFeature } from './site-data.ts';
import { rng } from './noise.ts';

const WALL_TINTS = [0xd9d6cf, 0xc9c6bd, 0xe4e1d8, 0xb9b6ad, 0xd1cbbd, 0xa9aaa6];
const ROOF_TINTS = [0x8d8b86, 0x9a978f, 0x777572, 0xa7a49c];

/** Corrugated-metal / panel texture: vertical ribs, horizontal seams and a window/louvre band. Tiles in metres. */
function makePanelTexture(): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, n, n);
  // ribs every 16 px (0.5 m at 8 px/0.25 m ...), light/dark alternate
  for (let x = 0; x < n; x += 16) {
    g.fillStyle = 'rgba(0,0,0,0.13)'; g.fillRect(x, 0, 3, n);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 3, 0, 2, n);
  }
  // horizontal panel seams
  g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, 0, n, 2); g.fillRect(0, n / 2, n, 2);
  // subtle streaks
  const r = rng(5);
  for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(0,0,0,${0.02 + r() * 0.05})`; g.fillRect(r() * n, r() * n * 0.4, 1 + r() * 3, 20 + r() * 120); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function centroid(p: number[][]): [number, number] {
  let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length];
}

function heightOf(f: SiteFeature, r: () => number): number {
  const h = parseFloat(f.tags.height ?? '');
  if (Number.isFinite(h) && h > 0 && h < 60) return h;
  switch (f.tags.building) {
    case 'container': return 2.6;
    case 'industrial': return 5.5 + r() * 3;
    case 'construction': return 6 + r() * 4;
    default: return 3.6 + r() * 1.2;
  }
}

export class Buildings {
  readonly group = new THREE.Group();
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];

  constructor(globals: Globals, site: SiteData) {
    this.group.name = 'env.buildings';
    const tex = makePanelTexture();
    const wallMat = applyGlobals(new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.68, metalness: 0.25 }), globals, { kelvin: 292, cacheKey: 'env-bld-wall' });
    const roofMat = applyGlobals(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.15 }), globals, { kelvin: 296, cacheKey: 'env-bld-roof' });
    const steelMat = applyGlobals(new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.35, metalness: 0.9 }), globals, { kelvin: 288, cacheKey: 'env-bld-steel' });
    this.mats.push(wallMat, roofMat, steelMat, tex as unknown as THREE.Material);

    const r = rng(1234);
    const wpos: number[] = [], wnor: number[] = [], wuv: number[] = [], wcol: number[] = [], widx: number[] = [];
    const rpos: number[] = [], rnor: number[] = [], rcol: number[] = [], ridx: number[] = [];
    const col = new THREE.Color();

    for (const f of site.features) {
      if (f.kind !== 'building' || f.geom !== 'polygon' || f.points.length < 3) continue;
      if (f.tags['construction:aeroway']) continue;             // flame-trench "buildings" (Pad 1 tag height is wrong)
      const [cx, cz] = centroid(f.points);
      if (inPadZone(cx, cz)) continue;
      if (f.tags.building === 'rocket') { this.addStarhopper(f, steelMat); continue; }
      let ring = f.points.map((p) => [p[0], p[1]]);
      // drop the duplicated closing vertex
      if (ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
      if (ring.length < 3) continue;
      const h = heightOf(f, r);
      // orientation: signed area in the (x,z) plane
      let area = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; area += p[0] * q[1] - q[0] * p[1]; }
      if (area < 0) ring = ring.reverse();                      // now counter-clockwise in (x,z) as x->z (viewed from -y)
      col.setHex(WALL_TINTS[Math.floor(r() * WALL_TINTS.length)]);
      const roofCol = new THREE.Color(ROOF_TINTS[Math.floor(r() * ROOF_TINTS.length)]);

      // walls
      let along = 0;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        const dx = q[0] - p[0], dz = q[1] - p[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        // (x,z) CCW when seen from below in a z-down frame => outward normal is (dz, -dx)/len
        const nx = dz / len, nz = -dx / len;
        const b = wpos.length / 3;
        wpos.push(p[0], 0, p[1], q[0], 0, q[1], q[0], h, q[1], p[0], h, p[1]);
        for (let k = 0; k < 4; k++) wnor.push(nx, 0, nz);
        wuv.push(along / 8, 0, (along + len) / 8, 0, (along + len) / 8, h / 8, along / 8, h / 8);
        // ground-contact darkening: the bottom two vertices are 0.72x, which reads as soft ambient occlusion at the base
        wcol.push(col.r * 0.72, col.g * 0.72, col.b * 0.72, col.r * 0.72, col.g * 0.72, col.b * 0.72, col.r, col.g, col.b, col.r, col.g, col.b);
        widx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        along += len;
      }
      // roof (earcut through ShapeUtils); slight pitch is skipped: flat roofs read fine at these distances
      const contour = ring.map((p) => new THREE.Vector2(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const rb = rpos.length / 3;
      for (const p of ring) { rpos.push(p[0], h, p[1]); rnor.push(0, 1, 0); rcol.push(roofCol.r, roofCol.g, roofCol.b); }
      for (const t of tris) {
        // make sure the triangle faces up
        const a = ring[t[0]], b2 = ring[t[1]], c = ring[t[2]];
        const cross = (b2[0] - a[0]) * (c[1] - a[1]) - (b2[1] - a[1]) * (c[0] - a[0]);
        if (cross > 0) ridx.push(rb + t[0], rb + t[2], rb + t[1]); else ridx.push(rb + t[0], rb + t[1], rb + t[2]);
      }
    }

    const mk = (pos: number[], nor: number[], colr: number[], idx: number[], uv: number[] | null, mat: THREE.Material, name: string) => {
      if (!idx.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
      if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, mat);
      m.name = name; m.castShadow = true; m.receiveShadow = true;
      this.group.add(m); this.geos.push(g);
    };
    mk(wpos, wnor, wcol, widx, wuv, wallMat, 'env.buildings.walls');
    mk(rpos, rnor, rcol, ridx, null, roofMat, 'env.buildings.roofs');
  }

  /** The Starhopper test article displayed at (69, -192): a stainless cylinder with a domed top. */
  private addStarhopper(f: SiteFeature, mat: THREE.Material): void {
    const xs = f.points.map((p) => p[0]), zs = f.points.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const rad = Math.max(2.5, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2);
    const h = parseFloat(f.tags.height ?? '17.9') || 17.9;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.98, rad, h - rad, 28, 1), mat);
    body.position.set(cx, (h - rad) / 2 + 1.0, cz);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(rad * 0.98, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.position.set(cx, h - rad + 1.0, cz);
    for (const m of [body, dome]) { m.castShadow = true; m.receiveShadow = true; this.group.add(m); this.geos.push(m.geometry); }
  }

  dispose(): void { for (const g of this.geos) g.dispose(); for (const m of this.mats) m.dispose(); }
}
