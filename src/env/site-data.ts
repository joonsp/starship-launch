// Loader and helpers for public/data/site.json (OSM extract around Starbase, local frame: x east, z south, metres).
// Schema notes (see research/pad.md section 3): polygons may carry "holes" (multipolygon inner rings),
// "point" geoms exist for a few nodes, and there is NO sea polygon: the sea is everything east of the coastline.
export interface SiteFeature {
  kind: 'water' | 'wetland' | 'scrub' | 'sand' | 'beach' | 'coast' | 'road' | 'building' | 'structure' | 'other' | string;
  geom: 'polygon' | 'line' | 'point';
  points: number[][];           // [x, z] pairs
  holes?: number[][][];         // inner rings (polygons only)
  name?: string;
  tags: Record<string, string>;
}

export interface SiteData { features: SiteFeature[] }

/** Half extent (m) of the region the environment renders around the origin. */
export const SITE_RANGE = 16000;

export async function loadSite(): Promise<SiteData> {
  const url = import.meta.env.BASE_URL + 'data/site.json';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    const json = await res.json();
    return { features: json.features as SiteFeature[] };
  } catch (e) {
    console.warn('[env] site.json unavailable, using an empty site:', e);
    return { features: [] };
  }
}

/**
 * The coastline as x(z): the Gulf lies at x > coastX(z). Resampled to `n` samples over z in [-range, range]
 * (linear extrapolation beyond the mapped part, clamped to a sane slope). There are 3 coast ways in the data.
 */
export function coastProfile(site: SiteData, n: number, range: number): Float32Array {
  // gather all coast polylines into one list of (z, x) points sorted by z
  const pts: Array<[number, number]> = [];
  for (const f of site.features) {
    if (f.kind !== 'coast') continue;
    for (const p of f.points) pts.push([p[1], p[0]]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  const out = new Float32Array(n);
  if (pts.length < 2) { out.fill(700); return out; }
  // dedupe identical z
  const zs: number[] = [], xs: number[] = [];
  for (const [z, x] of pts) { if (zs.length && Math.abs(z - zs[zs.length - 1]) < 1e-3) continue; zs.push(z); xs.push(x); }
  const slopeLo = (xs[1] - xs[0]) / (zs[1] - zs[0]);
  const m = zs.length;
  const slopeHi = (xs[m - 1] - xs[m - 2]) / (zs[m - 1] - zs[m - 2]);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const z = -range + (i / (n - 1)) * 2 * range;
    if (z <= zs[0]) { out[i] = xs[0] + Math.max(-0.2, Math.min(0.2, slopeLo)) * (z - zs[0]); continue; }
    if (z >= zs[m - 1]) { out[i] = xs[m - 1] + Math.max(-0.2, Math.min(0.2, slopeHi)) * (z - zs[m - 1]); continue; }
    while (j < m - 2 && zs[j + 1] < z) j++;
    const t = (z - zs[j]) / (zs[j + 1] - zs[j]);
    out[i] = xs[j] + (xs[m - 1 < j + 1 ? j : j + 1] - xs[j]) * t;
  }
  return out;
}

/** Ring signed area (z-up handedness irrelevant here; only used for sanity). */
export function ringArea(r: number[][]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
