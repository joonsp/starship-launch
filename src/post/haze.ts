// Screen-space heat haze: a small mask pass plus a UV-refraction effect.
// OWNER: post-processing module.
//
// Physics in one paragraph: hot exhaust gas has a slightly lower refractive index than the cold
// air around it (n - 1 falls by roughly 1e-4). Rays crossing turbulent hot gas bend by a fraction
// of a milliradian, which a camera 700 m away sees as a small, spatially noisy shift of the
// background. The gas is hottest inside the plume, and buoyancy carries it UP: above the ground
// fire and around the column there is a rising sheath of shimmering air. We model that as
//   mask = (plume presence x heat) smeared upward with an exponential fall-off, widened
//          sideways, plus an analytic "rising hot air" lobe above the impingement point.
// The displacement is mask x noise x amplitude, with the amplitude in screen heights
// (0.002 = 2 px at 1080p). In frozen mode (uDrift = 0) the noise phase is constant, so the still
// is deterministic.
//
// Frame-graph placement: HazeMaskPass reads ctx.targets.plume EVERY frame (the pipeline refills
// it), renders a quarter-resolution mask, then EffectPass(HeatHazeEffect) refracts the HDR colour
// before bloom and tone mapping.
import * as THREE from 'three';
import { Effect, BlendFunction, Pass } from 'postprocessing';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Mask pass
// ─────────────────────────────────────────────────────────────────────────────────────────────

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** P1: plume target -> presence x heat (5-tap dilation so thin features survive the downsample). */
const MASK_FRAG = /* glsl */ `
uniform sampler2D tPlume;
uniform vec2 uTexel;       // one mask texel in uv
uniform float uHeatK;      // luminance -> heat: heat = 1 - exp(-L * uHeatK)
uniform float uBase;       // heat floor for any pixel that has plume alpha > 0
varying vec2 vUv;

float maskAt(vec2 p) {
  vec4 s = texture2D(tPlume, p);
  float present = smoothstep(0.0, 1.0, s.a);           // a = view distance in metres, 0 = no plume
  float L = dot(max(s.rgb, 0.0), vec3(0.2126, 0.7152, 0.0722));
  float heat = 1.0 - exp(-L * uHeatK);
  return present * (uBase + (1.0 - uBase) * heat);
}

void main() {
  float m = maskAt(vUv);
  vec2 o = uTexel * 1.5;
  m = max(m, maskAt(vUv + vec2( o.x, 0.0)) * 0.85);
  m = max(m, maskAt(vUv + vec2(-o.x, 0.0)) * 0.85);
  m = max(m, maskAt(vUv + vec2(0.0,  o.y)) * 0.85);
  m = max(m, maskAt(vUv + vec2(0.0, -o.y)) * 0.85);
  gl_FragColor = vec4(m, 0.0, 0.0, 1.0);
}
`;

/** P2: upward smear. Hot air rises, so a pixel receives the mask of the pixels BELOW it (smaller v). */
const RISE_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform float uStep;       // uv step per tap (vertical)
uniform float uLen;        // e-folding rise height in uv (screen heights)
varying vec2 vUv;
void main() {
  float best = texture2D(tSrc, vUv).r;
  for (int i = 1; i <= 24; i++) {
    float k = float(i);
    float w = exp(-k * uStep / uLen);
    best = max(best, texture2D(tSrc, vUv - vec2(0.0, k * uStep)).r * w);
  }
  gl_FragColor = vec4(best, 0.0, 0.0, 1.0);
}
`;

/** P3: wide horizontal Gaussian (the haze bell widens around the column) + analytic rising lobe at the fire base. */
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform float uSigma;      // horizontal sigma in uv.x
uniform float uAspect;
uniform vec3 uHot;         // xy = impingement point in uv, z = strength (0 when off-screen / disabled)
uniform float uAmount;     // global mask scale
varying vec2 vUv;
void main() {
  float sum = 0.0, wsum = 0.0;
  for (int i = -8; i <= 8; i++) {
    float x = float(i) / 8.0;                   // -1..1 covers +-2 sigma
    float w = exp(-2.0 * x * x);
    sum += texture2D(tSrc, vUv + vec2(x * 2.0 * uSigma, 0.0)).r * w;
    wsum += w;
  }
  float m = sum / wsum;

  vec2 d = vUv - uHot.xy;
  d.x *= uAspect;                                   // screen-height units
  float up = max(d.y, 0.0);
  float sx = 0.035 + up * 0.45;                     // the rising bell widens with height
  float rise = exp(-(d.x * d.x) / (sx * sx)) * exp(-up / 0.16) * smoothstep(-0.03, 0.02, d.y);
  float low = exp(-(d.x * d.x) / (0.22 * 0.22) - (d.y * d.y) / (0.035 * 0.035)) * 0.6;
  float hot = uHot.z * max(rise * 0.9, low);

  gl_FragColor = vec4(clamp(max(m, hot) * uAmount, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;

export interface HazeMaskParams {
  /** Mask resolution relative to the drawing buffer (0.25 = quarter resolution). */
  scale: number;
  /** Global mask scale (0 disables the haze entirely). */
  amount: number;
  /** Minimum heat for any pixel with plume alpha > 0. */
  base: number;
  /** Luminance-to-heat rate: heat = 1 - exp(-L * heatK). Plume core is 20-60, sheath 3-6. */
  heatK: number;
  /** Rise height (e-folding, screen heights). */
  riseLen: number;
  /** Horizontal sigma of the sideways spread (uv.x units, i.e. fraction of the screen width). */
  sigma: number;
}

export const DEFAULT_HAZE_MASK: HazeMaskParams = { scale: 0.25, amount: 1, base: 0.3, heatK: 0.06, riseLen: 0.11, sigma: 0.018 };

export class HazeMaskPass extends Pass {
  readonly params: HazeMaskParams = { ...DEFAULT_HAZE_MASK };
  /** Impingement point to raise the ground-level hot-air lobe from (world metres). */
  hotPoint = new THREE.Vector3();
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private matMask: THREE.ShaderMaterial;
  private matRise: THREE.ShaderMaterial;
  private matBlur: THREE.ShaderMaterial;
  private cleared = false;
  private tmp = new THREE.Vector3();

  constructor(
    private camera_: THREE.Camera,
    private getPlume: () => THREE.Texture | null,
    hotPoint?: THREE.Vector3,
  ) {
    super('HazeMaskPass');
    this.needsSwap = false;
    if (hotPoint) this.hotPoint.copy(hotPoint);
    const mk = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false,
      blending: THREE.NoBlending, toneMapped: false,
    });
    const rtOpts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    };
    this.rtA = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtB = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtA.texture.name = 'post.hazeMaskA';
    this.rtB.texture.name = 'post.hazeMask';
    this.matMask = mk(MASK_FRAG, {
      tPlume: { value: null }, uTexel: { value: new THREE.Vector2(1, 1) },
      uHeatK: { value: this.params.heatK }, uBase: { value: this.params.base },
    });
    this.matRise = mk(RISE_FRAG, { tSrc: { value: null }, uStep: { value: 0.01 }, uLen: { value: this.params.riseLen } });
    this.matBlur = mk(BLUR_FRAG, {
      tSrc: { value: null }, uSigma: { value: this.params.sigma }, uAspect: { value: 1 },
      uHot: { value: new THREE.Vector3(0.5, 0.3, 0) }, uAmount: { value: 1 },
    });
    this.fullscreenMaterial = this.matMask;
  }

  /** The final mask (R channel, 0..1). Stable object: safe to hand to an effect at construction time. */
  get texture(): THREE.Texture { return this.rtA.texture; }

  setSize(width: number, height: number): void {
    const w = Math.max(8, Math.round(width * this.params.scale));
    const h = Math.max(8, Math.round(height * this.params.scale));
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.matMask.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.matRise.uniforms.uStep.value = 1 / h * 2.0;      // 2 mask texels per tap
    this.matBlur.uniforms.uAspect.value = width / height;
    this.cleared = false;
  }

  /** Re-evaluate the size after `scale` changed (quality change). */
  rescale(width: number, height: number): void { this.setSize(width, height); }

  render(renderer: THREE.WebGLRenderer): void {
    const plume = this.getPlume();
    if (!plume || this.params.amount <= 0) {
      // No plume this frame: leave a cleared (zero) mask, once, so the effect samples nothing.
      if (!this.cleared) {
        const prev = renderer.getRenderTarget();
        const oldColor = renderer.getClearColor(new THREE.Color());
        const oldAlpha = renderer.getClearAlpha();
        renderer.setRenderTarget(this.rtA);
        renderer.setClearColor(0x000000, 1);
        renderer.clear(true, false, false);
        renderer.setClearColor(oldColor, oldAlpha);
        renderer.setRenderTarget(prev);
        this.cleared = true;
      }
      return;
    }
    this.cleared = false;

    // Project the impingement point for the analytic hot-air lobe.
    const cam = this.camera_;
    const p = this.tmp.copy(this.hotPoint).applyMatrix4(cam.matrixWorldInverse);
    let hotOn = 0;
    const hot = this.matBlur.uniforms.uHot.value as THREE.Vector3;
    if (p.z < -1) {
      p.applyMatrix4(cam.projectionMatrix);
      hot.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, 1);
      hotOn = 1;
    }
    if (!hotOn) hot.z = 0;

    const prev = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;

    this.matMask.uniforms.tPlume.value = plume;
    this.matMask.uniforms.uHeatK.value = this.params.heatK;
    this.matMask.uniforms.uBase.value = this.params.base;
    this.fullscreenMaterial = this.matMask;
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.scene, this.camera);

    this.matRise.uniforms.tSrc.value = this.rtA.texture;
    this.matRise.uniforms.uLen.value = this.params.riseLen;
    this.fullscreenMaterial = this.matRise;
    renderer.setRenderTarget(this.rtB);
    renderer.render(this.scene, this.camera);

    this.matBlur.uniforms.tSrc.value = this.rtB.texture;
    this.matBlur.uniforms.uSigma.value = this.params.sigma;
    this.matBlur.uniforms.uAmount.value = this.params.amount;
    this.fullscreenMaterial = this.matBlur;
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.scene, this.camera);

    renderer.autoClear = prevAuto;
    renderer.setRenderTarget(prev);
  }

  dispose(): void {
    this.rtA.dispose(); this.rtB.dispose();
    this.matMask.dispose(); this.matRise.dispose(); this.matBlur.dispose();
    super.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Refraction effect
// ─────────────────────────────────────────────────────────────────────────────────────────────

const HAZE_FRAG = /* glsl */ `
uniform sampler2D tMask;
uniform sampler2D tNoise;
uniform float uAmp;        // displacement in screen heights at mask = 1
uniform vec2 uScale;       // noise repeats per screen height (x is per aspect-corrected width)
uniform vec2 uPhase;       // frozen unless drift is on

void mainUv(inout vec2 uv) {
  float m = texture2D(tMask, uv).r;
  if (m < 0.003) return;
  vec2 p = vec2(uv.x * aspect, uv.y) * uScale + uPhase;
  vec2 n1 = texture2D(tNoise, p).rg * 2.0 - 1.0;
  vec2 n2 = texture2D(tNoise, p * 2.7 + vec2(0.37, 0.11)).rg * 2.0 - 1.0;
  vec2 n = n1 * 0.7 + n2 * 0.3;
  // Rising shimmer displaces mostly along the buoyancy direction and a little sideways.
  n = vec2(n.x * 0.65, n.y);
  uv += n * (m * uAmp) * vec2(1.0 / aspect, 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = inputColor;
}
`;

export class HeatHazeEffect extends Effect {
  constructor(mask: THREE.Texture, noise: THREE.Texture) {
    super('HeatHazeEffect', HAZE_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['tMask', new THREE.Uniform(mask)],
        ['tNoise', new THREE.Uniform(noise)],
        ['uAmp', new THREE.Uniform(0.002)],
        ['uScale', new THREE.Uniform(new THREE.Vector2(9, 16))],
        ['uPhase', new THREE.Uniform(new THREE.Vector2(0, 0))],
      ]),
    });
  }
  /** Displacement at mask = 1 in screen heights (0.002 = 2 px at 1080p). */
  get amplitude(): number { return this.uniforms.get('uAmp')!.value as number; }
  set amplitude(v: number) { this.uniforms.get('uAmp')!.value = v; }
  /** Noise phase; the chain passes (0, -uTime * uDrift * speed) so the shimmer rises only when drift is on. */
  setPhase(x: number, y: number): void { (this.uniforms.get('uPhase')!.value as THREE.Vector2).set(x, y); }
}
