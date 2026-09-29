// Colour grading effects and the procedural "photo look" LUT. OWNER: post-processing module.
//
// The grade is split around the tone mapper, because AgX clamps to 0..1:
//   ExposureWBEffect  (linear HDR, BEFORE AgX):   exposure x white-balance gains.
//   ToneMappingEffect (AgX)                       maps HDR to display-linear.
//   GradeEffect       (display sRGB, AFTER AgX):  lift/gain, contrast, saturation.
//   LUT3DEffect       (display sRGB -> sRGB):     the procedural photo look below.
//
// The LUT is a fixed, parametric function of display colour built from the reference-photo
// analysis in research/palette.json (grading_target): lifted blacks (~#12100f), teal/blue split
// tone in the shadows, warm cream highlights (R-B about 35-45 in the 8-bit photo), +8-12 %
// saturation with the cerulean sky and the orange steam boosted a bit more (the sky is one of
// the most saturated regions of the photo, so it must never be desaturated), and a mild S-curve.
import * as THREE from 'three';
import { Effect, BlendFunction, LookupTexture } from 'postprocessing';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Pre-tone-map: exposure and white balance (linear HDR)
// ─────────────────────────────────────────────────────────────────────────────────────────────

const PRE_FRAG = /* glsl */ `
uniform float uExposure;
uniform vec3 uGain;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(max(inputColor.rgb, 0.0) * (uExposure * uGain), inputColor.a);
}
`;

/**
 * White-balance gains for a temperature/tint pair (both about -1..1).
 * temperature > 0 is WARMER (adds red, removes blue), tint > 0 is towards MAGENTA (removes green).
 * The gains are normalised so the luminance gain is 1: a WB change never changes exposure.
 */
export function whiteBalanceGains(temperature: number, tint: number, out = new THREE.Vector3()): THREE.Vector3 {
  const k = 0.42;
  const r = Math.exp(k * (temperature + 0.5 * tint));
  const g = Math.exp(k * (-tint));
  const b = Math.exp(k * (-temperature + 0.5 * tint));
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return out.set(r / l, g / l, b / l);
}

export class ExposureWBEffect extends Effect {
  constructor() {
    super('ExposureWBEffect', PRE_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uExposure', new THREE.Uniform(1)],
        ['uGain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ]),
    });
  }
  set(exposure: number, temperature: number, tint: number): void {
    this.uniforms.get('uExposure')!.value = exposure;
    whiteBalanceGains(temperature, tint, this.uniforms.get('uGain')!.value as THREE.Vector3);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Post-tone-map: lift / gain / contrast / saturation (display sRGB)
// ─────────────────────────────────────────────────────────────────────────────────────────────

const POST_FRAG = /* glsl */ `
uniform float uContrast;
uniform float uSat;
uniform float uLift;
uniform float uGain;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = clamp(inputColor.rgb, 0.0, 1.0);
  c = c * uGain + uLift * (1.0 - c);
  // Smooth S-curve contrast: blends towards smoothstep (contrast > 1) or away from it (< 1).
  vec3 s = c * c * (3.0 - 2.0 * c);
  c = clamp(mix(c, s, (uContrast - 1.0) * 2.5), 0.0, 1.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = clamp(mix(vec3(l), c, uSat), 0.0, 1.0);
  outputColor = vec4(c, inputColor.a);
}
`;

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', POST_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uContrast', new THREE.Uniform(1)],
        ['uSat', new THREE.Uniform(1)],
        ['uLift', new THREE.Uniform(0)],
        ['uGain', new THREE.Uniform(1)],
      ]),
    });
    // Operate on gamma-encoded values: contrast and lift/gain are perceptually meaningful there.
    (this as any).inputColorSpace = THREE.SRGBColorSpace;
  }
  set(g: { contrast: number; saturation: number; lift: number; gain: number }): void {
    this.uniforms.get('uContrast')!.value = g.contrast;
    this.uniforms.get('uSat')!.value = g.saturation;
    this.uniforms.get('uLift')!.value = g.lift;
    this.uniforms.get('uGain')!.value = g.gain;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Procedural photo-look LUT
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface PhotoLook {
  /** Black lift (display units): pure black becomes about this value. 0.035 gives #12100f-ish shadows. */
  blackLift: number;
  /** Tint added at zero luminance (fades out by mid-grey), display units. Teal/blue. */
  shadowTint: [number, number, number];
  /** Tint added in the highlights (fades in above about 55 % luma). Warm cream. */
  highlightTint: [number, number, number];
  /** Extra saturation gain (1 + x) at the sky-blue hue window (centre 205 deg, half-width 40 deg). */
  blueSat: number;
  /** Extra saturation gain at the orange hue window (centre 30 deg, half-width 30 deg). */
  orangeSat: number;
  /** Global saturation gain (1 + x). */
  globalSat: number;
  /**
   * Extra chroma gain (1 + x) for colours that are already saturated AND bright (fire, sun-lit
   * orange steam). AgX desaturates bright colours; this puts the punch of the reference photo
   * back (its fire edge is #f5960e) without touching neutral cream or the sky.
   */
  richness: number;
  /** Extra chroma gain (1 + x) for near-clipped yellow-white (the fireball core, #fbf7a3 in the photo). Only acts above about 90 % luma, so cream cloud highlights are unaffected. */
  flame: number;
  /** Blend towards smoothstep for the mild S-curve (0..1). */
  curve: number;
}

export const DEFAULT_PHOTO_LOOK: PhotoLook = {
  blackLift: 0.05,
  shadowTint: [-0.004, 0.002, 0.012],
  highlightTint: [0.014, 0.005, -0.02],
  blueSat: 0.18,
  orangeSat: 0.1,
  globalSat: 0.05,
  richness: 0.4,
  flame: 0.7,
  curve: 0.2,
};

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Raised-cosine window on a circular hue axis (degrees). */
function hueWindow(h: number, centre: number, halfWidth: number): number {
  let d = Math.abs(h - centre) % 360;
  if (d > 180) d = 360 - d;
  return d >= halfWidth ? 0 : 0.5 * (1 + Math.cos((Math.PI * d) / halfWidth));
}

/** The look as a pure function of a display-sRGB colour (0..1) -> display-sRGB colour (0..1). */
export function applyPhotoLook(rgb: readonly [number, number, number], p: PhotoLook = DEFAULT_PHOTO_LOOK, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  let [r, g, b] = rgb;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  // 1. S-curve per channel (keeps ends fixed, adds mid-tone punch).
  const sc = (x: number) => x + (x * x * (3 - 2 * x) - x) * p.curve;
  r = sc(r); g = sc(g); b = sc(b);

  // 2. Saturation, hue-selective, luminance preserving. Chroma-weighted so greys are untouched.
  let l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const chroma = mx - mn;
  let hue = 0;
  if (chroma > 1e-5) {
    if (mx === r) hue = 60 * (((g - b) / chroma) % 6);
    else if (mx === g) hue = 60 * ((b - r) / chroma + 2);
    else hue = 60 * ((r - g) / chroma + 4);
    if (hue < 0) hue += 360;
  }
  // Fade the selective boosts at the extremes so blacks and clipped highlights stay clean.
  const mid = smoothstep(0.02, 0.18, l) * (1 - smoothstep(0.85, 1.0, l));
  const sat = mx > 1e-5 ? chroma / mx : 0;
  const rich = p.richness * smoothstep(0.45, 0.8, sat) * smoothstep(0.35, 0.6, l) * (1 - smoothstep(0.9, 1.0, l));
  const flame = p.flame * hueWindow(hue, 55, 30) * smoothstep(0.9, 0.96, l) * (1 - smoothstep(0.985, 1.0, l));
  const k = 1 + p.globalSat + rich + flame + mid * (p.blueSat * hueWindow(hue, 205, 40) + p.orangeSat * hueWindow(hue, 30, 30));
  r = l + (r - l) * k; g = l + (g - l) * k; b = l + (b - l) * k;

  // 3. Split toning: teal shadows, warm highlights.
  const sw = 1 - smoothstep(0.0, 0.45, luma);
  const hw = smoothstep(0.55, 0.95, luma);
  r += sw * p.shadowTint[0] + hw * p.highlightTint[0];
  g += sw * p.shadowTint[1] + hw * p.highlightTint[1];
  b += sw * p.shadowTint[2] + hw * p.highlightTint[2];

  // 4. Lifted blacks (soft): blacks come up to blackLift, whites unchanged.
  const lift = p.blackLift;
  r = lift + r * (1 - lift); g = lift * 0.95 + g * (1 - lift * 0.95); b = lift * 0.92 + b * (1 - lift * 0.92);

  out[0] = Math.min(1, Math.max(0, r));
  out[1] = Math.min(1, Math.max(0, g));
  out[2] = Math.min(1, Math.max(0, b));
  return out;
}

/**
 * Build the LUT (size^3, RGBA half float so hardware trilinear filtering is always available and
 * banding-free). Input and output are display sRGB, which is what LUT3DEffect's default
 * inputColorSpace (sRGB) feeds it. Cost: 33^3 = 36k evaluations, about 5 ms, once.
 */
export function createPhotoLookLUT(size = 33, look: PhotoLook = DEFAULT_PHOTO_LOOK): LookupTexture {
  const data = new Uint16Array(size * size * size * 4);
  const s = 1 / (size - 1);
  const tmp: [number, number, number] = [0, 0, 0];
  const H = THREE.DataUtils.toHalfFloat;
  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        const i4 = (ri + gi * size + bi * size * size) * 4;
        applyPhotoLook([ri * s, gi * s, bi * s], look, tmp);
        data[i4] = H(tmp[0]); data[i4 + 1] = H(tmp[1]); data[i4 + 2] = H(tmp[2]); data[i4 + 3] = H(1);
      }
    }
  }
  const lut = new LookupTexture(data as unknown as ArrayBufferView, size);
  lut.type = THREE.HalfFloatType;
  lut.name = 'post.photoLook';
  return lut;
}
