// Integrator-owned unit tests for src/core: GPU classification and the auto-quality frame probe.
import { describe, expect, it } from 'vitest';
import { FrameProbe, classifyGpu, lowerQuality } from '../src/core/quality.ts';

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
