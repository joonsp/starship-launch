// Last-stage "finish" effect: vignette, film grain / dithering, the thermal scale bar and the debug views.
// OWNER: post-processing module.
//
// Why custom instead of pmndrs NoiseEffect: NoiseEffect seeds from the pass clock (`time`), so it
// always animates. The freeze-frame must be deterministic, so the seed here only advances when
// globals.uDrift > 0. The grain is also luminance-weighted (strongest in mid-tones, like film) and
// its cell size follows the drawing-buffer height, so a 2x export has the same grain look as the
// screen. Its triangular-PDF component doubles as a dither that hides 8-bit banding in the smooth
// sky gradient.
//
// The thermal preset's scale bar (thermal.ts) is burned in here, after grain and vignette, at a size that
// follows the drawing-buffer height, so it is part of an exported still like a camera's overlay.
import * as THREE from 'three';
import { Effect, BlendFunction } from 'postprocessing';
import { createLegendTexture } from './thermal.ts';

const FINISH_FRAG = /* glsl */ `
uniform sampler2D tMask;
uniform float uVigOffset;   // radius (0 centre .. 1 corner) where the vignette starts
uniform float uVigDark;     // darkening at the corners (0..1)
uniform float uGrain;       // grain amplitude in display units (0.02 = 2 %)
uniform float uSeed;        // constant unless drift is on
uniform float uCell;        // grain cell size in pixels
uniform float uDebug;       // 0 off, 1 haze mask over the image, 2 haze mask only
uniform sampler2D tLegend;
uniform vec4 uLegend;       // legend rect in drawing-buffer pixels: x0, y0 (bottom left), w, h; w = 0 = off

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float triNoise(vec2 p, float s) { return hash12(p + s) + hash12(p * 1.37 + s + 17.0) - 1.0; }

vec3 heatRamp(float m) {
  // black -> indigo -> magenta -> orange -> yellow
  vec3 a = mix(vec3(0.0, 0.0, 0.05), vec3(0.35, 0.0, 0.6), smoothstep(0.0, 0.25, m));
  vec3 b = mix(a, vec3(0.95, 0.15, 0.4), smoothstep(0.2, 0.5, m));
  vec3 c = mix(b, vec3(1.0, 0.65, 0.05), smoothstep(0.45, 0.8, m));
  return mix(c, vec3(1.0, 1.0, 0.6), smoothstep(0.8, 1.0, m));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;   // display sRGB (inputColorSpace = sRGB)

  // Vignette: radial, aspect-corrected, 0 at the centre and 1 at the corners.
  vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(q) / (0.5 * length(vec2(aspect, 1.0)));
  float v = smoothstep(uVigOffset, 1.0, r);
  c *= 1.0 - uVigDark * v * v;

  // Grain (+ dither). Mid-tone weighted; slight chroma component.
  vec2 px = floor(gl_FragCoord.xy / max(uCell, 1.0));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float resp = 0.3 + 0.7 * clamp(4.0 * l * (1.0 - l), 0.0, 1.0);
  float n = triNoise(px, uSeed);
  vec3 n3 = vec3(n) + 0.3 * vec3(triNoise(px + 11.0, uSeed), triNoise(px + 23.0, uSeed), triNoise(px + 37.0, uSeed));
  c += n3 * (uGrain * resp);
  c += (hash12(gl_FragCoord.xy + 3.7) - 0.5) / 255.0;   // 1-LSB dither

  if (uLegend.z > 0.0) {
    vec2 lp = (gl_FragCoord.xy - uLegend.xy) / uLegend.zw;
    if (lp.x >= 0.0 && lp.y >= 0.0 && lp.x <= 1.0 && lp.y <= 1.0) {
      vec4 L = texture2D(tLegend, lp);
      c = mix(c, L.rgb, L.a);
    }
  }

  if (uDebug > 0.5) {
    float m = texture2D(tMask, uv).r;
    vec3 base = (uDebug > 1.5) ? vec3(0.0) : c * 0.35;
    c = mix(base, heatRamp(m), clamp(m * 3.0, 0.0, 1.0) * 0.95);
  }
  outputColor = vec4(c, inputColor.a);
}
`;

export class FinishEffect extends Effect {
  /** Called once per rendered frame (this effect's pass is always enabled, unlike the haze passes). */
  onFrame: (() => void) | null = null;
  constructor(mask: THREE.Texture) {
    super('FinishEffect', FINISH_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['tMask', new THREE.Uniform(mask)],
        ['uVigOffset', new THREE.Uniform(0.55)],
        ['uVigDark', new THREE.Uniform(0.22)],
        ['uGrain', new THREE.Uniform(0.02)],
        ['uSeed', new THREE.Uniform(0)],
        ['uCell', new THREE.Uniform(1)],
        ['uDebug', new THREE.Uniform(0)],
        ['tLegend', new THREE.Uniform(null)],
        ['uLegend', new THREE.Uniform(new THREE.Vector4(0, 0, 0, 0))],
      ]),
    });
    (this as any).inputColorSpace = THREE.SRGBColorSpace;
  }
  private legendTex: THREE.Texture | null = null;
  private legendOn = false;
  /** Legend size in legend units (see thermal.ts drawLegend) and its right margin. */
  private static readonly LEGEND = { w: 120, h: 360, margin: 22 };
  private u(name: string) { return this.uniforms.get(name)!; }
  setVignette(offset: number, darkness: number): void { this.u('uVigOffset').value = offset; this.u('uVigDark').value = darkness; }
  setGrain(amount: number): void { this.u('uGrain').value = amount; }
  setSeed(seed: number): void { this.u('uSeed').value = seed; }
  setDebug(mode: number): void { this.u('uDebug').value = mode; }
  /** Show the thermal scale bar (the texture is created on first use). */
  setLegend(on: boolean): void {
    this.legendOn = on;
    if (on && !this.legendTex) {
      this.legendTex = createLegendTexture();
      this.u('tLegend').value = this.legendTex;
    }
    if (!on) (this.u('uLegend').value as THREE.Vector4).set(0, 0, 0, 0);
  }
  /** Called each frame with the drawing-buffer height so the grain cell scales with export resolution. */
  update(_renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget): void {
    this.u('uCell').value = Math.max(1, Math.round(inputBuffer.height / 1000));
    if (this.legendOn && this.legendTex) {
      // right edge, vertically centred; 1 legend unit = 1 px at 1000 px height, narrower on portrait screens
      // (at most ~1/4 of the width), never below 0.62 px
      const k = Math.max(0.62, Math.min(inputBuffer.height / 1000, inputBuffer.width / 540)), L = FinishEffect.LEGEND;
      const w = L.w * k, h = L.h * k;
      (this.u('uLegend').value as THREE.Vector4).set(inputBuffer.width - w - L.margin * k, (inputBuffer.height - h) * 0.5, w, h);
    }
    this.onFrame?.();
  }
  dispose(): void {
    this.legendTex?.dispose();
    super.dispose();
  }
}
