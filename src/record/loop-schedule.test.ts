import { describe, expect, it } from 'vitest';
import {
  aspectLabel, blendWeight, codecOrder, estimateBytes, evenDims, frameAction, framingCrop, loopBitrate, loopPlan, loopStem,
  outputMixture, recordFovDeg, screenDims, type FrameAction,
} from './loop-schedule.ts';

const CASES: Array<[number, number]> = [[180, 30], [180, 60], [450, 60], [900, 120], [10, 1], [10, 5], [7, 3]];

/** Run the schedule like the recorder does and return the outputs as mixtures of rendered frames, by output index. */
function simulate(n: number, c: number): { outs: Array<Array<[number, number]> | undefined>; order: number[]; actions: FrameAction[] } {
  const outs: Array<Array<[number, number]> | undefined> = new Array(n);
  const order: number[] = [];
  const actions: FrameAction[] = [];
  const stored = new Set<number>();
  for (let i = 0; i < n + c; i++) {
    const a = frameAction(i, n, c);
    actions.push(a);
    if (a.kind === 'store') { stored.add(a.lead); continue; }
    expect(outs[a.out], `output ${a.out} written twice`).toBeUndefined();
    order.push(a.out);
    if (a.kind === 'output') outs[a.out] = [[i, 1]];
    else {
      expect(stored.has(a.lead), `lead ${a.lead} used before it was rendered`).toBe(true);
      stored.delete(a.lead);   // each lead frame is used once and can be freed
      outs[a.out] = [[i, 1 - a.w], [a.lead, a.w]];
    }
  }
  expect(stored.size).toBe(0);
  return { outs, order, actions };
}

describe('loop schedule', () => {
  it('covers every output index exactly once, in increasing order', () => {
    for (const [n, c] of CASES) {
      const { outs, order } = simulate(n, c);
      expect(order).toEqual(Array.from({ length: n }, (_, j) => j));
      expect(outs.every((o) => o !== undefined)).toBe(true);
    }
  });

  it('uses every rendered frame exactly once: leads only as blend partners, the rest only as bases', () => {
    for (const [n, c] of CASES) {
      const { outs } = simulate(n, c);
      const uses = new Map<number, number>();
      for (const o of outs) for (const [f] of o!) uses.set(f, (uses.get(f) ?? 0) + 1);
      for (let f = 0; f < n + c; f++) expect(uses.get(f), `rendered frame ${f}`).toBe(1);
    }
  });

  it('matches the documented mixture and weights sum to one', () => {
    for (const [n, c] of CASES) {
      const { outs } = simulate(n, c);
      for (let j = 0; j < n; j++) {
        expect(outs[j]).toEqual(outputMixture(j, n, c));
        expect(outs[j]!.reduce((s, [, w]) => s + w, 0)).toBeCloseTo(1, 12);
      }
    }
  });

  it('the poster frame o(0) is the pure rendered frame f(C)', () => {
    for (const [n, c] of CASES) expect(outputMixture(0, n, c)).toEqual([[c, 1]]);
  });

  it('is continuous across the seam: the lead track advances by one frame and its weight steps by 1/(C+1)', () => {
    for (const [n, c] of CASES) {
      const last = outputMixture(n - 1, n, c);
      const first = outputMixture(0, n, c);
      // o(N-1) = (1 - C/(C+1)) f(N+C-1) + C/(C+1) f(C-1);  o(0) = f(C)
      expect(last).toEqual([[n + c - 1, 1 - c / (c + 1)], [c - 1, c / (c + 1)]]);
      expect(first[0][0] - last[1][0]).toBe(1);                   // f(C-1) -> f(C): the next rendered frame
      expect(first[0][1] - last[1][1]).toBeCloseTo(1 / (c + 1), 12);
      // the same step as every frame of the dissolve, including its start (pure f(N-1) -> first blend)
      for (let j = n - c - 1; j < n - 1; j++) {
        const a = outputMixture(j, n, c), b = outputMixture(j + 1, n, c);
        expect(b[0][0] - a[0][0]).toBe(1);                         // the base track advances by one frame
        const wa = a[1]?.[1] ?? 0, wb = b[1]?.[1] ?? 0;
        expect(wb - wa).toBeCloseTo(1 / (c + 1), 12);
        if (a[1]) expect(b[1]![0] - a[1][0]).toBe(1);              // so does the lead track
      }
    }
  });

  it('a non-periodic signal loops with a seam no bigger than a dissolve step', () => {
    // f = a slow drift that never repeats (growth + advection) with some wobble, like the steam
    const f = (i: number) => 0.02 * i + 0.3 * Math.sin(i * 0.071) + 0.1 * Math.sin(i * 0.23 + 1);
    for (const [n, c] of CASES) {
      const o = Array.from({ length: n }, (_, j) => outputMixture(j, n, c).reduce((s, [i, w]) => s + w * f(i), 0));
      const step = (j: number) => Math.abs(o[(j + 1) % n] - o[j]);
      const seam = step(n - 1);
      let maxDissolve = 0;
      for (let j = n - c - 1; j < n - 1; j++) maxDissolve = Math.max(maxDissolve, step(j));
      let maxPlain = 0;
      for (let j = 0; j < n - c - 1; j++) maxPlain = Math.max(maxPlain, step(j));
      expect(seam).toBeLessThanOrEqual(maxDissolve + 1e-9);
      // without the crossfade the jump would be |f(N+C-1) - f(C-1)|, a whole loop of drift
      if (c > 1) expect(seam).toBeLessThan(Math.abs(f(n + c - 1) - f(c - 1)) / 2);
      expect(maxPlain).toBeLessThan(0.1);
    }
  });

  it('rejects impossible plans and clamps the crossfade', () => {
    expect(() => frameAction(0, 10, 10)).toThrow();
    expect(() => frameAction(0, 10, 0)).toThrow();
    expect(() => frameAction(20, 10, 5)).toThrow();
    expect(loopPlan(15, 30, 2)).toEqual({ n: 450, c: 60, total: 510 });
    expect(loopPlan(6, 30, 1)).toEqual({ n: 180, c: 30, total: 210 });
    expect(loopPlan(4, 30, 4).c).toBe(60);             // clamped to half the loop
    expect(blendWeight(0, 3)).toBeCloseTo(0.25);
    expect(blendWeight(2, 3)).toBeCloseTo(0.75);
  });
});

describe('framing', () => {
  it('pillarboxes a narrower target and keeps the fov', () => {
    const c = framingCrop(16 / 9, 4 / 3);
    expect(c.h).toBe(1);
    expect(c.w).toBeCloseTo((4 / 3) / (16 / 9));
    expect(c.x).toBeCloseTo((1 - c.w) / 2);
    expect(c.tanScale).toBe(1);
    expect(recordFovDeg(30, c)).toBeCloseTo(30);
  });

  it('letterboxes a wider target and narrows the vertical fov to the crop', () => {
    const c = framingCrop(3 / 2, 16 / 9);
    expect(c.w).toBe(1);
    expect(c.h).toBeCloseTo(1.5 / (16 / 9));
    expect(c.y).toBeCloseTo((1 - c.h) / 2);
    const fov = recordFovDeg(40, c);
    expect(Math.tan((fov * Math.PI) / 360)).toBeCloseTo(Math.tan((40 * Math.PI) / 360) * c.h, 12);
    // horizontal fov is preserved: aspect x tan(vfov/2) is the same for the view and the recording
    expect((16 / 9) * Math.tan((fov * Math.PI) / 360)).toBeCloseTo(1.5 * Math.tan((40 * Math.PI) / 360), 12);
  });

  it('is the identity for the same aspect', () => {
    expect(framingCrop(1.5, 1.5)).toEqual({ x: 0, y: 0, w: 1, h: 1, tanScale: 1 });
  });
});

describe('sizes and names', () => {
  it('rounds to even dimensions', () => {
    expect(evenDims(2879.6, 1919.2)).toEqual({ width: 2880, height: 1920 });
    expect(evenDims(1365, 767)).toEqual({ width: 1366, height: 768 });
  });
  it('measures this screen in device pixels', () => {
    expect(screenDims(1800, 1200, 1.6)).toEqual({ width: 2880, height: 1920 });
    expect(screenDims(1366, 768, 1)).toEqual({ width: 1366, height: 768 });
    expect(screenDims(1280, 853, 1.5)).toEqual({ width: 1920, height: 1280 });
  });
  it('labels aspects', () => {
    expect(aspectLabel(2880, 1920)).toBe('3:2');
    expect(aspectLabel(3840, 2160)).toBe('16:9');
    expect(aspectLabel(2560, 1600)).toBe('16:10');
    expect(aspectLabel(1366, 768)).toBe('16:9');
  });
  it('picks a sane bitrate and size', () => {
    expect(loopBitrate(2560, 1440, 30)).toBeCloseTo(2560 * 1440 * 30 * 0.12, -3);
    expect(loopBitrate(640, 360, 24)).toBe(6e6);
    expect(loopBitrate(7680, 4320, 60)).toBe(60e6);
    expect(estimateBytes(2560, 1440, 30, 15)).toBeCloseTo(loopBitrate(2560, 1440, 30) * 15 / 8);
  });
  it('shares one stem between video and poster', () => {
    expect(loopStem(2880, 1920, new Date(2026, 8, 29, 22, 51, 7))).toBe('starship-loop-2880x1920-20260929-2251');
    expect(loopStem(1920, 1080, new Date(2027, 0, 3, 4, 5))).toBe('starship-loop-1920x1080-20270103-0405');
    expect(loopStem(2560, 1440)).toMatch(/^starship-loop-2560x1440-\d{8}-\d{4}$/);
  });
  it('puts H.264 first only with a hardware encoder', () => {
    expect(codecOrder(true)).toEqual(['avc', 'vp9', 'av1']);
    expect(codecOrder(false)).toEqual(['vp9', 'avc', 'av1']);
  });
});
