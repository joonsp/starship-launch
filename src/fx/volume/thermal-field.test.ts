// The thermal view's temperature field (JS twin of the march shader's steamKelvin): physically sensible ranges.
import { describe, expect, it } from 'vitest';
import { steamKelvin } from './thermal-field.ts';
import { REFL_FRAMES } from './volume-pass.ts';

describe('launch-cloud temperature field (thermal view)', () => {
  it('is hot (600-1500 K) at the trench exits and at the plume foot', () => {
    for (const s of [-38, 38]) {
      const k = steamKelvin({ s, l: 0, h: 4 });
      expect(k).toBeGreaterThan(600);
      expect(k).toBeLessThan(1500);
    }
    const foot = steamKelvin({ s: 0, l: 0, h: 20 });
    expect(foot).toBeGreaterThan(600);
    expect(foot).toBeLessThan(1500);
  });

  it('cools with distance along the outflow and with height', () => {
    const along = [40, 80, 150, 250].map((x) => steamKelvin({ s: 38 + x, l: 0, h: 10 }));
    for (let i = 1; i < along.length; i++) expect(along[i]).toBeLessThan(along[i - 1]);
    const up = [10, 60, 150, 300].map((h) => steamKelvin({ s: 150, l: 10, h }));
    for (let i = 1; i < up.length; i++) expect(up[i]).toBeLessThan(up[i - 1]);
  });

  it('reaches ~310-330 K at the tops of the banks', () => {
    for (const [s, l] of [[-250, 20], [200, -40], [320, 60]]) {
      const k = steamKelvin({ s, l, h: 280 });
      expect(k).toBeGreaterThan(305);
      expect(k).toBeLessThan(330);
    }
  });

  it('varies with turbulent mixing, and thin air-mixed edges are cooler', () => {
    const q = { s: 120, l: 0, h: 20 };
    expect(steamKelvin({ ...q, mix: 0.9 })).toBeGreaterThan(steamKelvin({ ...q, mix: 0.1 }) + 60);
    expect(steamKelvin({ ...q, dens: 0.02 })).toBeLessThan(steamKelvin({ ...q, dens: 1 }));
  });

  it('keeps the flame itself (baked temperature channel) at 1500-2700 K', () => {
    const k = steamKelvin({ s: 8, l: 0, h: 26, tempG: 1 });
    expect(k).toBeGreaterThan(1500);
    expect(k).toBeLessThan(2700);
  });
});

describe('planar reflection refinement', () => {
  it('converges within the frames a still export draws (32)', () => {
    expect(REFL_FRAMES).toBeGreaterThan(8);
    expect(REFL_FRAMES).toBeLessThanOrEqual(30);
  });
});
