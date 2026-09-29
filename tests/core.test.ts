// Integrator-owned unit tests for src/core: GPU classification and the auto-quality frame probe.
import { describe, expect, it } from 'vitest';
import { FrameProbe, PROBE_COUNT, PROBE_SKIP, WARM_FRAMES_MAX, classifyGpu, lowerQuality } from '../src/core/quality.ts';
import { DEFAULT_PARAMS } from '../src/fx/volume/params.ts';
import { probeStale, shouldDraw, type IdleFacts } from '../src/core/idle.ts';

describe('classifyGpu', () => {
  const cases: Array<[string, string]> = [
    ['ANGLE (AMD, AMD Radeon 8060S Graphics (radeonsi, gfx1151, LLVM 20.1.8, DRM 3.64, 6.17.1), OpenGL 4.6)', 'high'],
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'low'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 (0x00002704) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ultra'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'high'],
    ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'low'],
    ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'medium'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)', 'high'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'medium'],
    ['ANGLE (AMD, AMD Radeon 780M (radeonsi, gfx1103_r1, LLVM 18), OpenGL 4.6)', 'medium'],
    ['Mali-G78', 'low'],
    ['Adreno (TM) 740', 'low'],
    ['llvmpipe (LLVM 17.0.6, 256 bits)', 'low'],
    ['Some Future GPU', 'medium'],
  ];
  for (const [s, want] of cases) it(`${s.slice(0, 60)} -> ${want}`, () => expect(classifyGpu(s).id).toBe(want));
  it('treats small touch screens as mobile', () => expect(classifyGpu('Some Future GPU', true, true).id).toBe('low'));
});

describe('FrameProbe', () => {
  it('skips warm-up frames and reports ok at 60 fps', () => {
    const p = new FrameProbe(5, 20, 24);
    for (let i = 0; i < 5; i++) p.feed(0.5);       // compile hitches are ignored
    for (let i = 0; i < 20; i++) p.feed(1 / 60);
    expect(p.done).toBe(true);
    expect(p.verdict).toBe('ok');
    expect(p.medianMs).toBeCloseTo(16.7, 0);
  });
  it('steps down at 30 fps', () => {
    const p = new FrameProbe(0, 10, 24);
    for (let i = 0; i < 10; i++) p.feed(1 / 30);
    expect(p.verdict).toBe('down');
  });
  it('lowerQuality stops at low', () => {
    expect(lowerQuality('ultra')).toBe('high');
    expect(lowerQuality('low')).toBe('low');
  });
});

describe('idle gate', () => {
  const still: IdleFacts = {
    gate: true, ready: true, awakeFrames: 0, drifting: false, volumeConverged: true,
    pipelineBusy: false, skyJobRunning: false, overlayChanged: false, compiling: false,
  };
  it('skips the frame once everything has converged', () => expect(shouldDraw(still)).toBe(false));
  it('draws while the clouds accumulate, the shadows settle or the sky re-bakes', () => {
    expect(shouldDraw({ ...still, volumeConverged: false })).toBe(true);
    expect(shouldDraw({ ...still, pipelineBusy: true })).toBe(true);
    expect(shouldDraw({ ...still, skyJobRunning: true })).toBe(true);
  });
  it('draws after events, in slow drift and when the overlay changed', () => {
    expect(shouldDraw({ ...still, awakeFrames: 3 })).toBe(true);
    expect(shouldDraw({ ...still, drifting: true })).toBe(true);
    expect(shouldDraw({ ...still, overlayChanged: true })).toBe(true);
  });
  it('always draws before ready and with the gate off', () => {
    expect(shouldDraw({ ...still, ready: false })).toBe(true);
    expect(shouldDraw({ ...still, gate: false })).toBe(true);
  });
  it('holds the last frame while programs link', () => {
    expect(shouldDraw({ ...still, compiling: true, awakeFrames: 5, volumeConverged: false })).toBe(false);
  });
  it('re-arms the quality probe only for a much bigger canvas', () => {
    expect(probeStale(0, 1e7)).toBe(false);
    expect(probeStale(1e6, 1.2e6)).toBe(false);
    expect(probeStale(1e6, 2.1e6)).toBe(true);
  });
});

describe('auto-quality probe timing', () => {
  it('can finish while the clouds are still marching (warm-up + skip + samples fit in maxFrames)', () => {
    expect(WARM_FRAMES_MAX + 1 + PROBE_SKIP + PROBE_COUNT).toBeLessThan(DEFAULT_PARAMS.maxFrames);
  });
});
