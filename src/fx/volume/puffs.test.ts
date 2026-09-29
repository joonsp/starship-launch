// Tests for the launch-cloud puff layout (pure math, no WebGL).
import { describe, expect, it } from 'vitest';
import { ANCHORS } from '../../scene-config.ts';
import { PAD_YAW } from '../../scene-config.ts';
import { FIRE_SPECS, FOOT_SPECS, JET_SPECS, L0_SPECS, buildPuffs, fireSources, photoFrameFrom, projectPhoto, type Vec3 } from './puffs.ts';

const pc = ANCHORS.photoCamera;
const frame = photoFrameFrom(pc.pos.toArray() as Vec3, pc.target.toArray() as Vec3, pc.fovDeg, pc.rollDeg);

describe('photo frame', () => {
  it('projects the booster engine plane onto its measured photo pixel (818, 441)', () => {
    const [u, v] = projectPhoto(frame, ANCHORS.vehicleBase.toArray() as Vec3);
    expect(Math.abs(u - 818)).toBeLessThan(6);
    expect(Math.abs(v - 441)).toBeLessThan(6);
  });
  it('projects the tower top near its measured pixel (798, 467)', () => {
    const [u, v] = projectPhoto(frame, [ANCHORS.towerBase.x, ANCHORS.towerHeight, ANCHORS.towerBase.z]);
    expect(Math.abs(u - 798)).toBeLessThan(8);
    expect(Math.abs(v - 467)).toBeLessThan(8);
  });
});

describe('puff layout', () => {
  const puffs = buildPuffs(frame, { padYaw: PAD_YAW });

  it('is deterministic for a given seed', () => {
    const again = buildPuffs(frame, { padYaw: PAD_YAW });
    expect(again.length).toBe(puffs.length);
    expect(again[123]).toEqual(puffs[123]);
  });

  it('has the three hierarchy levels with a sensible count', () => {
    const n = [0, 1, 2].map((l) => puffs.filter((p) => p.level === l).length);
    expect(n[0]).toBe(L0_SPECS.length + FIRE_SPECS.length + FOOT_SPECS.length + JET_SPECS.length);
    expect(n[1]).toBeGreaterThan(n[0] * 5);
    expect(n[2]).toBeGreaterThan(n[1] * 3);
    expect(puffs.length).toBeLessThan(8000); // the splat bake draws every puff once per layer
  });

  it('keeps every puff centre inside the volume bounds (x, z) and above ground', () => {
    const b = ANCHORS.volumeBounds;
    for (const p of puffs) {
      expect(p.c[0]).toBeGreaterThan(b.min.x);
      expect(p.c[0]).toBeLessThan(b.max.x);
      expect(p.c[2]).toBeGreaterThan(b.min.z);
      expect(p.c[2]).toBeLessThan(b.max.z);
      expect(p.c[1] + p.r).toBeGreaterThan(0);
      expect(p.c[1]).toBeLessThan(b.max.y);
    }
  });

  it('leaves the photo gap clear: no bank billow projects over the upper tower / plume', () => {
    // gap region in the photo: x 690..960 px, above y 560 px (tower, vehicle and sea visible)
    for (const s of L0_SPECS.filter((q) => q.g === 'W' || q.g === 'E')) {
      const c = puffs.find((p) => p.level === 0 && Math.abs(projectPhoto(frame, p.c)[0] - s.u) < 0.5);
      if (!c) continue;
      const [u, v, d] = projectPhoto(frame, c.c);
      const rp = (frame.f * c.r) / d;
      const inGap = u + rp > 690 && u - rp < 960 && v - rp < 560;
      expect(inGap && v + rp < 560).toBe(false);
    }
  });

  it('puts the fireball at the deflector, east of the plume axis', () => {
    const f = fireSources(frame, PAD_YAW).slice(0, FIRE_SPECS.length);
    const w = f.reduce((a, s) => a + s.w, 0);
    expect(w).toBeCloseTo(1, 5);
    const cx = f.reduce((a, s) => a + s.c[0] * s.w, 0);
    const cy = f.reduce((a, s) => a + s.c[1] * s.w, 0);
    expect(cx).toBeGreaterThan(0);
    expect(cx).toBeLessThan(60);
    expect(cy).toBeGreaterThan(5);
    expect(cy).toBeLessThan(40);
  });
});
