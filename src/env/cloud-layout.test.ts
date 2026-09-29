// Env-owned tests for the background cumulus layout (cloud-layout.ts) and the sky re-bake policy (sky.ts).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CLOUD_ABOVE, CLOUD_BASE, CLOUD_TOP, COVER_EXTENT, DEFAULT_RAG, HORIZON_FRAGS, PHOTO_CELLS, VOL_DY, VOL_EXTENT, VOL_LAYERS, VOL_Y0,
  allCells, buildCoverTexture, cumulusCells,
} from './cloud-layout.ts';
import { CLOUD_SLAB, SkyRebakePolicy } from './sky.ts';
import { ANCHORS, applyPhotoCamera } from '../scene-config.ts';

const W = 1677, H = 943;
const photoCam = new THREE.PerspectiveCamera(ANCHORS.photoCamera.fovDeg, W / H, 0.5, 60000);
applyPhotoCamera(photoCam);
photoCam.updateMatrixWorld();
/** Photo pixel of a world point (x, y from the top left) and whether it is in front of the camera. */
function toPhoto(x: number, y: number, z: number): [number, number, boolean] {
  const v = new THREE.Vector3(x, y, z).project(photoCam);
  return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H, v.z < 1];
}

describe('cumulus layout', () => {
  const cells = allCells();

  it('keeps every cell inside the slab and the envelope volume', () => {
    for (const c of cells) {
      expect(c.h).toBeGreaterThan(0);
      expect(CLOUD_BASE + c.h).toBeLessThanOrEqual(CLOUD_TOP + 1e-6);
      expect(c.rag ?? DEFAULT_RAG).toBeGreaterThanOrEqual(0);
      expect(c.rag ?? DEFAULT_RAG).toBeLessThanOrEqual(1);
    }
    // the envelope reaches above the tallest billows, so nothing is cut off flat at the top
    expect(VOL_Y0 + VOL_LAYERS * VOL_DY).toBeGreaterThanOrEqual(CLOUD_TOP + CLOUD_ABOVE);
    // the photo-authored cells (the clusters and the horizon band) lie inside the volume
    for (const c of cells.slice(0, PHOTO_CELLS.length + HORIZON_FRAGS.length)) {
      expect(Math.max(Math.abs(c.x), Math.abs(c.z))).toBeLessThan(VOL_EXTENT);
    }
  });

  it('leaves the sky above the ridge clear (no stray puff at the top left of the photo)', () => {
    for (const c of cells) {
      const [u, row, front] = toPhoto(c.x, CLOUD_BASE + c.h, c.z);
      if (!front) continue;
      const inPatch = u > 300 && u < 560 && row < 90;
      expect(inPatch, `cell at (${c.x.toFixed(0)}, ${c.z.toFixed(0)}) tops out at photo (${u.toFixed(0)}, ${row.toFixed(0)})`).toBe(false);
    }
  });

  it('puts the horizon band under the big cluster, low in the frame', () => {
    for (const c of cells.slice(PHOTO_CELLS.length, PHOTO_CELLS.length + HORIZON_FRAGS.length)) {
      const [, rowTop] = toPhoto(c.x, CLOUD_BASE + c.h, c.z);
      expect(rowTop).toBeGreaterThan(380);
      expect(rowTop).toBeLessThan(520);
      expect(c.rag ?? 0).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('builds towers that taper upward from a body standing on the base', () => {
    const jit = Array.from({ length: 16 }, (_, i) => ((i * 0.618) % 1));
    const tall = cumulusCells(0, 0, 700, 1, 0.1, 0, jit);
    const low = cumulusCells(0, 0, 300, 0, 0.6, 0, jit);
    const top = (cs: typeof tall) => Math.max(...cs.map((c) => c.h));
    expect(top(tall)).toBeGreaterThan(2 * 700);        // a congestus rises well above its footprint radius
    expect(top(low)).toBeLessThan(1.5 * 300);          // a humilis stays a low dome
    // the stacked lobes get narrower toward the crown
    const lobes = tall.filter((c) => c.axis !== 0 && c !== tall[0] && c !== tall[1]).sort((a, b) => a.h - b.h);
    for (let i = 1; i < lobes.length; i++) expect(lobes[i].r).toBeLessThanOrEqual(lobes[i - 1].r + 1e-6);
    // nothing floats: every cell reaches down to the base or into a cell below it
    for (const c of tall) expect(c.yc - (c.h - c.yc) * (c.lo ?? 1)).toBeLessThan(c.h * 0.8);
  });

  it('stores raggedness in the coverage map, carried a little outside the footprints', () => {
    const rag = { x: 0, z: 0, r: 600, rAlong: 600, axis: 0, h: 500, yc: 0, rag: 0.9 };
    const tex = buildCoverTexture(1024, [rag]);
    const n = tex.image.width, data = tex.image.data as Uint8Array;
    const at = (x: number, z: number) => {
      const i = Math.floor(((x + COVER_EXTENT) / (2 * COVER_EXTENT)) * n), j = Math.floor(((z + COVER_EXTENT) / (2 * COVER_EXTENT)) * n);
      return data[(j * n + i) * 4 + 2] / 255;
    };
    expect(at(0, 0)).toBeCloseTo(0.9, 1);
    expect(at(800, 0)).toBeCloseTo(0.9, 1);          // the fringe ring
    expect(at(5000, 0)).toBeCloseTo(DEFAULT_RAG, 1);  // far away: the default
  });
});

describe('SkyRebakePolicy', () => {
  it('measures the clearance to the cumulus slab', () => {
    expect(SkyRebakePolicy.clearance(new THREE.Vector3(0, 100, 0))).toBeCloseTo(CLOUD_SLAB[0] - 100);
    expect(SkyRebakePolicy.clearance(new THREE.Vector3(0, 1500, 0))).toBe(250);   // inside the slab: the floor
    expect(SkyRebakePolicy.clearance(new THREE.Vector3(0, CLOUD_SLAB[1] + 900, 0))).toBeCloseTo(900);
  });

  it('re-bakes a long move while moving, and a short one once the camera rests', () => {
    const p = new SkyRebakePolicy();
    const bake = new THREE.Vector3(0, 100, 0);
    const c = SkyRebakePolicy.clearance(bake);
    // moving a little: not yet
    expect(p.due(new THREE.Vector3(0.2 * c, 100, 0), bake, 1 / 60)).toBe(false);
    expect(p.due(new THREE.Vector3(0.25 * c, 100, 0), bake, 1 / 60)).toBe(false);
    // resting there for a moment: yes
    let due = false;
    for (let i = 0; i < 30 && !due; i++) due = p.due(new THREE.Vector3(0.25 * c, 100, 0), bake, 1 / 60);
    expect(due).toBe(true);
    // a long move re-bakes at once
    expect(new SkyRebakePolicy().due(new THREE.Vector3(0.6 * c, 100, 0), bake, 1 / 60)).toBe(true);
    // a tiny drift never re-bakes
    const q = new SkyRebakePolicy();
    for (let i = 0; i < 60; i++) expect(q.due(new THREE.Vector3(1, 100, 0), bake, 1 / 60)).toBe(false);
  });
});
