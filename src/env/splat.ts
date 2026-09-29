// Rasterise the OSM features into splat/mask textures (Canvas2D, CPU, once per quality change).
//   inner (+-2560 m, up to 4096^2 = 1.25 m/px) and outer (+-16 km, 2048^2 = 15.6 m/px) rings, each with two RGBA8 maps:
//     A: R = tidal flat (wetland), G = scrub / salt-marsh grass, B = open water (OSM ponds, lagoons, streams)
//     B: R = sand / beach,          G = gravel / industrial / construction ground, B = damp ground (blurred water margin)
// Polygons use the even-odd rule with the holes appended to the same path (multipolygon inner rings).
import * as THREE from 'three';
import type { SiteData, SiteFeature } from './site-data.ts';

export const INNER_HALF = 2560;
export const OUTER_HALF = 16000;

export interface SplatSet {
  innerA: THREE.Texture; innerB: THREE.Texture;
  outerA: THREE.Texture; outerB: THREE.Texture;
}

interface Ring { pts: number[][] }

function drawFeature(ctx: CanvasRenderingContext2D, f: SiteFeature, tx: (x: number) => number, tz: (z: number) => number, color: string, lineWidthM: number, scalePx: number): void {
  ctx.fillStyle = color; ctx.strokeStyle = color;
  if (f.geom === 'polygon' && f.points.length > 2) {
    ctx.beginPath();
    const addRing = (r: number[][]) => {
      ctx.moveTo(tx(r[0][0]), tz(r[0][1]));
      for (let i = 1; i < r.length; i++) ctx.lineTo(tx(r[i][0]), tz(r[i][1]));
      ctx.closePath();
    };
    addRing(f.points);
    for (const h of f.holes ?? []) if (h.length > 2) addRing(h);
    ctx.fill('evenodd');
  } else if (f.geom === 'line' && f.points.length > 1 && lineWidthM > 0) {
    ctx.lineWidth = Math.max(1, lineWidthM * scalePx);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tx(f.points[0][0]), tz(f.points[0][1]));
    for (let i = 1; i < f.points.length; i++) ctx.lineTo(tx(f.points[i][0]), tz(f.points[i][1]));
    ctx.stroke();
  }
}

function makeCanvas(n: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas'); c.width = c.height = n;
  const ctx = c.getContext('2d', { alpha: false, willReadFrequently: false })!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, n, n);
  ctx.globalCompositeOperation = 'lighter';
  return { c, ctx };
}

function toTexture(c: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;                          // canvas row 0 = z = -half (north); v = (z + half) / (2 half)
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function rasterise(site: SiteData, half: number, nA: number, nB: number): { a: THREE.Texture; b: THREE.Texture } {
  const A = makeCanvas(nA), B = makeCanvas(nB);
  const build = (cv: { ctx: CanvasRenderingContext2D }, n: number) => {
    const s = n / (2 * half);
    return { tx: (x: number) => (x + half) * s, tz: (z: number) => (z + half) * s, s };
  };
  const a = build(A, nA), b = build(B, nB);
  const of = (kind: string) => site.features.filter((f) => f.kind === kind);

  // ---- map A: flat / scrub / water
  for (const f of of('wetland')) drawFeature(A.ctx, f, a.tx, a.tz, '#f00', 0, a.s);
  // the construction site around the pad is graded, compacted tidal-flat ground (no pools right at the apron)
  for (const f of of('other')) if (f.tags.landuse === 'construction') drawFeature(A.ctx, f, a.tx, a.tz, '#a00', 0, a.s);
  for (const f of of('scrub')) drawFeature(A.ctx, f, a.tx, a.tz, '#0f0', 0, a.s);
  for (const f of of('water')) {
    const w = f.tags.waterway === 'river' ? 18 : f.tags.waterway === 'stream' ? 6 : 4;
    drawFeature(A.ctx, f, a.tx, a.tz, '#00f', w, a.s);
  }

  // beyond the mapped area (north of the data, west of the Gulf) lie Laguna Madre and the Brazos Santiago pass: open shallow water
  if (half === OUTER_HALF) {
    A.ctx.fillStyle = '#00f';
    A.ctx.fillRect(a.tx(-OUTER_HALF), a.tz(-OUTER_HALF), (a.tx(600) - a.tx(-OUTER_HALF)), a.tz(-7500) - a.tz(-OUTER_HALF));
  }

  // ---- map B: sand / gravel / damp
  for (const f of [...of('beach'), ...of('sand')]) drawFeature(B.ctx, f, b.tx, b.tz, '#f00', 0, b.s);
  for (const f of of('other')) {
    if (f.tags.landuse === 'industrial' || f.tags.aeroway === 'apron') drawFeature(B.ctx, f, b.tx, b.tz, '#0f0', 0, b.s);
  }
  for (const f of of('building')) drawFeature(B.ctx, f, b.tx, b.tz, '#0f0', 0, b.s);
  // damp margin: blurred water (and its wide shores)
  const blurPx = Math.max(2, 26 * b.s);
  const prev = B.ctx.filter;
  B.ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
  for (const f of of('water')) {
    const w = f.tags.waterway === 'river' ? 40 : f.tags.waterway === 'stream' ? 14 : 12;
    drawFeature(B.ctx, f, b.tx, b.tz, '#00f', w, b.s);
  }
  B.ctx.filter = prev ?? 'none';
  return { a: toTexture(A.c), b: toTexture(B.c) };
}

export function buildSplats(site: SiteData, innerRes: number): SplatSet {
  const inner = rasterise(site, INNER_HALF, innerRes, Math.max(1024, innerRes / 2));
  const outer = rasterise(site, OUTER_HALF, 2048, 1024);
  return { innerA: inner.a, innerB: inner.b, outerA: outer.a, outerB: outer.b };
}

export function disposeSplats(s: SplatSet): void {
  s.innerA.dispose(); s.innerB.dispose(); s.outerA.dispose(); s.outerB.dispose();
}
export type { Ring };
