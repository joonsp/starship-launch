// Automatic quality selection. OWNER: integrator (src/core).
//
//  1. guessQuality(renderer): a first guess from the unmasked GPU renderer string (WEBGL_debug_renderer_info),
//     before anything is loaded, so the bakes run at a sensible resolution.
//  2. FrameProbe: after load, a short frame-time probe (median rAF interval over ~60 frames while the clouds are
//     still marching, i.e. the expensive state) steps the level DOWN if the frame rate is clearly too low. It never
//     steps up: rAF is vsync-capped, so a fast GPU looks the same as a just-fast-enough one.
// The design target is 60 fps at 'high' on an AMD Radeon 8060S iGPU at 1080p.
import type * as THREE from 'three';
import type { QualityId } from '../contracts.ts';

export const QUALITY_LEVELS: QualityId[] = ['low', 'medium', 'high', 'ultra'];

export interface GpuGuess { id: QualityId; gpu: string; reason: string }

/** The unmasked renderer string, e.g. "ANGLE (AMD, AMD Radeon 8060S Graphics (radeonsi, gfx1151 ...), OpenGL 4.6)". */
export function gpuRendererString(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return String(s ?? '');
}

/** First quality guess from the GPU string and the device class. */
export function guessQuality(renderer: THREE.WebGLRenderer): GpuGuess {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const small = typeof screen !== 'undefined' && Math.max(screen.width, screen.height) < 1100;
  return classifyGpu(gpuRendererString(renderer), coarse, small);
}

/** Pure classification of an unmasked renderer string (unit-tested in tests/core.test.ts). */
export function classifyGpu(gpu: string, coarse = false, small = false): GpuGuess {
  const g = gpu.toLowerCase();
  const pick = (id: QualityId, reason: string): GpuGuess => ({ id, gpu, reason });

  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) return pick('low', 'software rasteriser');
  if (/mali|adreno|powervr|apple gpu|videocore|tegra/.test(g) || (coarse && small)) return pick('low', 'mobile GPU');
  // discrete desktop GPUs
  if (/rtx\s*(30[6-9]0|40[6-9]0|50[6-9]0)|rx\s*(6[7-9]\d\d|7[7-9]\d\d|9[07]\d\d)|radeon pro w7/.test(g)) return pick('ultra', 'fast discrete GPU');
  if (/rtx|rx\s*\d{4}|arc\s*a7|arc\s*b5/.test(g)) return pick('high', 'discrete GPU');
  if (/gtx|rx\s*\d{3}\b|arc/.test(g)) return pick('medium', 'older / entry discrete GPU');
  // Apple silicon (ANGLE Metal reports "Apple M2 Pro")
  if (/apple m\d+\s*(pro|max|ultra)/.test(g)) return pick('high', 'Apple silicon Pro/Max');
  if (/apple m\d+/.test(g)) return pick('medium', 'Apple silicon');
  // AMD APUs: RDNA 3.5 Strix Halo (8060S / 8050S) is the design target for 'high'
  if (/8060s|8050s|8040s/.test(g)) return pick('high', 'Strix Halo iGPU (design target)');
  if (/890m|880m|780m|760m/.test(g)) return pick('medium', 'RDNA 3 iGPU');
  if (/radeon|vega/.test(g)) return pick('low', 'older AMD iGPU');
  // Intel integrated
  if (/intel/.test(g)) return pick(/iris|xe|arc/.test(g) ? 'medium' : 'low', 'Intel integrated GPU');
  return pick('medium', 'unknown GPU');
}

/**
 * Median rAF-interval probe. feed(dtSeconds) every frame after load; `done` flips once a verdict exists.
 * verdict: 'ok' or 'down' (step one quality level down and probe again).
 */
export class FrameProbe {
  private samples: number[] = [];
  private skipped = 0;
  done = false;
  verdict: 'ok' | 'down' = 'ok';
  medianMs = 0;

  constructor(private readonly skip = 20, private readonly count = 60, private readonly downAboveMs = 24) {}

  feed(dt: number): void {
    if (this.done) return;
    if (this.skipped < this.skip) { this.skipped++; return; }   // shader warm-up, first bakes, texture uploads
    this.samples.push(dt * 1000);
    if (this.samples.length < this.count) return;
    const s = [...this.samples].sort((a, b) => a - b);
    this.medianMs = s[Math.floor(s.length / 2)];
    this.verdict = this.medianMs > this.downAboveMs ? 'down' : 'ok';
    this.done = true;
  }
}

/** One level down (or the same if already at the bottom). */
export function lowerQuality(id: QualityId): QualityId {
  const i = QUALITY_LEVELS.indexOf(id);
  return QUALITY_LEVELS[Math.max(0, i - 1)];
}
