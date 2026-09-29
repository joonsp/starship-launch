// The post-processing chain: everything AFTER the volume pass (frame-graph step 4).
// OWNER: post-processing module.
//
// Pass layout (all pmndrs `Pass` objects, returned in order in `PostChain.passes`):
//   1. HazeMaskPass          plume target -> quarter-res heat mask (custom Pass, no swap)
//   2. EffectPass(haze)      HeatHazeEffect: UV refraction of the HDR image (mainUv effects cannot
//                            share a pass with convolution effects, so it lives alone)
//   3. EffectPass(bloom, ExposureWB, AgX, Grade, LUT)   all in linear HDR -> display
//        BloomEffect (mipmapBlur, ADD blend) -> exposure x white balance -> AgX -> lift/gain/
//        contrast/saturation (sRGB) -> photo-look LUT (strength per preset)
//   4. EffectPass(tiltShift) TiltShiftEffect on display-linear colour; skipped when disabled
//   5. EffectPass(SMAA)      after tone mapping (needs LDR); preset follows the quality level
//   6. EffectPass(CA, finish) chromatic aberration (edges only), vignette, frozen grain, dither
//
// Colour spaces: buffers between passes are linear HalfFloat. Inside pass 3 the LUT and the grade
// operate on sRGB-encoded values; the pmndrs EffectPass inserts the conversions automatically.
// The last pass encodes to the canvas (sRGB output) because the composer marks it renderToScreen.
import * as THREE from 'three';
import {
  BlendFunction, BloomEffect, ChromaticAberrationEffect, EffectPass, KernelSize, LUT3DEffect,
  SMAAEffect, SMAAPreset, TiltShiftEffect, ToneMappingEffect, ToneMappingMode,
} from 'postprocessing';
import type { Pass } from 'postprocessing';
import type { AppContext, LensState, LightingPreset, QualityId, QualitySettings } from '../contracts.ts';
import { createTileableNoiseRG } from './noise.ts';
import { HazeMaskPass, HeatHazeEffect } from './haze.ts';
import { ExposureWBEffect, GradeEffect, createPhotoLookLUT } from './grade.ts';
import { FinishEffect } from './finish.ts';
import { POST_TUNING, type PostTuning } from './presets.ts';

const DEG = Math.PI / 180;

/** Bloom that can be switched off without paying for its blur pyramid (pmndrs runs update() every frame). */
class SwitchableBloomEffect extends BloomEffect {
  active = true;
  update(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, deltaTime: number): void {
    if (this.active) super.update(renderer, inputBuffer, deltaTime);
  }
}

export type PostDebugView = 'off' | 'haze-mask' | 'haze-mask-only';

export interface PostChainOptions {
  /** Camera handed to the EffectPasses (near/far only). Default: ctx.camera. */
  camera?: THREE.Camera;
  /** Where to read the plume target from each frame. Default: () => ctx.targets.plume. */
  getPlume?: () => THREE.Texture | null;
  /**
   * Subscribe to ctx.events 'preset' and 'quality' so the chain follows automatically (default true).
   * setPreset / setQuality are idempotent, so also calling them from the integrator is harmless.
   */
  autoWire?: boolean;
  /** Build the photo-look LUT (default true). false = grade only. */
  lut?: boolean;
}

export interface PostChain {
  /** Add these to the EffectComposer, in order, right after the volume pass. */
  passes: Pass[];
  setPreset(p: LightingPreset): void;
  /** Tilt-shift (from LensState.tiltShift) and the roll of its focus band (LensState.rollDeg). */
  setLens(l: LensState): void;
  setQuality(q: QualitySettings): void;
  /** Debug views: the haze mask overlaid on the image, or alone. */
  setDebug(mode: PostDebugView): void;
  /** Live tuning values of the current preset. Edit, then call applyTuning(). */
  readonly tuning: PostTuning;
  applyTuning(): void;
  /** The individual effects, for GUIs and tests. */
  readonly effects: {
    haze: HeatHazeEffect; bloom: BloomEffect; exposureWB: ExposureWBEffect; tone: ToneMappingEffect;
    grade: GradeEffect; lut: LUT3DEffect | null; tiltShift: TiltShiftEffect; smaa: SMAAEffect;
    chromatic: ChromaticAberrationEffect; finish: FinishEffect;
  };
  readonly hazeMaskPass: HazeMaskPass;
  dispose(): void;
}

interface QualityPost { bloomLevels: number; smaa: SMAAPreset; chromatic: boolean; tiltRes: number; hazeScale: number; tiltKernel: KernelSize }
const QUALITY_POST: Record<QualityId, QualityPost> = {
  low:    { bloomLevels: 5, smaa: SMAAPreset.LOW,    chromatic: false, tiltRes: 0.35, hazeScale: 0.2,  tiltKernel: KernelSize.SMALL },
  medium: { bloomLevels: 6, smaa: SMAAPreset.MEDIUM, chromatic: true,  tiltRes: 0.5,  hazeScale: 0.25, tiltKernel: KernelSize.MEDIUM },
  high:   { bloomLevels: 8, smaa: SMAAPreset.HIGH,   chromatic: true,  tiltRes: 0.5,  hazeScale: 0.25, tiltKernel: KernelSize.MEDIUM },
  ultra:  { bloomLevels: 8, smaa: SMAAPreset.ULTRA,  chromatic: true,  tiltRes: 0.75, hazeScale: 0.33, tiltKernel: KernelSize.LARGE },
};

export function createPostChain(ctx: AppContext, opts: PostChainOptions = {}): PostChain {
  const camera = opts.camera ?? ctx.camera;
  const getPlume = opts.getPlume ?? (() => ctx.targets.plume);
  const g = ctx.globals;

  // ── 1-2. Heat haze ────────────────────────────────────────────────────────────────────────
  const noise = createTileableNoiseRG(256, 3);
  const hazeMask = new HazeMaskPass(camera, getPlume, ctx.anchors.plumeImpact);
  const haze = new HeatHazeEffect(hazeMask.texture, noise);
  const hazePass = new EffectPass(camera, haze);

  // ── 3. Bloom, exposure/WB, AgX, grade, LUT ────────────────────────────────────────────────
  const bloom = new SwitchableBloomEffect({
    blendFunction: BlendFunction.ADD,   // HDR: SCREEN clamps at 1 and would kill highlights before tone mapping
    mipmapBlur: true, intensity: 0.55, radius: 0.8, levels: 8,
    luminanceThreshold: 2.4, luminanceSmoothing: 1.6,
  });
  const exposureWB = new ExposureWBEffect();
  // NORMAL blend so opacity can bypass AgX (the thermal false-colour ramp must not be desaturated).
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX, blendFunction: BlendFunction.NORMAL });
  const grade = new GradeEffect();
  const lutTex = opts.lut === false ? null : createPhotoLookLUT(33);
  const lut = lutTex ? new LUT3DEffect(lutTex, { blendFunction: BlendFunction.NORMAL }) : null;
  const mainPass = new EffectPass(camera, bloom, exposureWB, tone, grade, ...(lut ? [lut] : []));

  // ── 4. Tilt-shift ─────────────────────────────────────────────────────────────────────────
  const tiltShift = new TiltShiftEffect({ offset: 0, rotation: 0, focusArea: 0.4, feather: 0.3, kernelSize: KernelSize.MEDIUM, resolutionScale: 0.5 });
  const tiltPass = new EffectPass(camera, tiltShift);
  tiltPass.enabled = false;

  // ── 5. SMAA ───────────────────────────────────────────────────────────────────────────────
  const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
  const smaaPass = new EffectPass(camera, smaa);

  // ── 6. Chromatic aberration, vignette, grain ──────────────────────────────────────────────
  const chromatic = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0006, 0.0006), radialModulation: true, modulationOffset: 0.35 });
  const finish = new FinishEffect(hazeMask.texture);
  const finishPass = new EffectPass(camera, chromatic, finish);

  const passes: Pass[] = [hazeMask, hazePass, mainPass, tiltPass, smaaPass, finishPass];

  // ── state ─────────────────────────────────────────────────────────────────────────────────
  let preset: LightingPreset = ctx.preset;
  let quality: QualitySettings = ctx.quality;
  let debug: PostDebugView = 'off';
  let lens: LensState | null = null;
  const tuning: PostTuning = { ...POST_TUNING[preset.id] };

  // Frozen by default: the noise phase and the grain seed only advance while globals.uDrift > 0.
  finish.onFrame = () => {
    const drift = g.uDrift.value, t = g.uTime.value;
    haze.setPhase(0, -t * drift * 0.06);
    finish.setSeed(drift > 0 ? Math.floor(t * 24) * 1.6180339 : 0);
  };

  function applyTuning(): void {
    const exposure = Math.max(preset.exposure * tuning.exposureBias, 1e-3);
    // Bloom sees the pre-exposure signal, so the threshold is expressed relative to the display.
    bloom.intensity = tuning.bloomIntensity;
    bloom.luminanceMaterial.threshold = tuning.bloomThreshold / exposure;
    bloom.luminanceMaterial.smoothing = tuning.bloomSmoothing / exposure;
    bloom.mipmapBlurPass.radius = tuning.bloomRadius;
    bloom.active = quality.bloom && tuning.bloomIntensity > 0;
    bloom.blendMode.opacity.value = bloom.active ? 1 : 0;

    exposureWB.set(exposure, preset.grade.temperature, preset.grade.tint);
    tone.blendMode.opacity.value = tuning.toneMap ? 1 : 0;
    grade.set(preset.grade);
    if (lut) lut.blendMode.opacity.value = tuning.lut;

    const hazeOn = tuning.hazeAmp > 0;
    haze.amplitude = tuning.hazeAmp;
    hazeMask.params.amount = hazeOn || debug !== 'off' ? 1 : 0;
    hazePass.enabled = hazeOn;
    hazeMask.enabled = hazeOn || debug !== 'off';

    finish.setVignette(tuning.vignetteOffset, tuning.vignette);
    finish.setGrain(tuning.grain);
    const ca = QUALITY_POST[quality.id].chromatic ? tuning.chromatic : 0;
    chromatic.offset.set(ca, ca);
  }

  function setPreset(p: LightingPreset): void {
    preset = p;
    Object.assign(tuning, POST_TUNING[p.id]);
    applyTuning();
  }

  function setQuality(q: QualitySettings): void {
    quality = q;
    const qp = QUALITY_POST[q.id];
    bloom.mipmapBlurPass.levels = qp.bloomLevels;
    smaa.applyPreset(qp.smaa);
    // The scene is linear at this point and SMAA's edge detector expects gamma-ish contrast: be a bit more sensitive.
    smaa.edgeDetectionMaterial.edgeDetectionThreshold = 0.06;
    tiltShift.resolution.scale = qp.tiltRes;
    tiltShift.blurPass.kernelSize = qp.tiltKernel;
    hazeMask.params.scale = qp.hazeScale;
    const size = g.uResolution.value;
    if (size.x > 1) hazeMask.rescale(size.x, size.y);
    applyTuning();
  }

  /**
   * LensState.tiltShift: focusY and band are in 0..1 screen units. focusY is measured from the TOP
   * of the screen (0 = top edge, 1 = bottom edge); band is the full height of the sharp band;
   * blur (0..1, may exceed 1) is the strength outside the band. The band rotates with rollDeg so it
   * stays parallel to the horizon on a Dutch-angle camera.
   */
  function setLens(l: LensState): void {
    lens = l;
    const ts = l.tiltShift;
    tiltPass.enabled = ts.enabled && ts.blur > 0;
    if (!ts.enabled) return;
    const band = THREE.MathUtils.clamp(ts.band, 0, 1);
    const feather = 0.22 + 0.3 * band;
    tiltShift.offset = 1 - 2 * ts.focusY;        // vUv2.y spans -1 (bottom) .. +1 (top)
    tiltShift.focusArea = band + feather;         // sharp half-height (= band) + blend ramp
    tiltShift.feather = feather;
    tiltShift.rotation = l.rollDeg * DEG;
    (tiltShift.blurPass as any).blurMaterial.scale = 0.35 + 1.15 * THREE.MathUtils.clamp(ts.blur, 0, 1.5);
  }

  function setDebug(mode: PostDebugView): void {
    debug = mode;
    finish.setDebug(mode === 'off' ? 0 : mode === 'haze-mask' ? 1 : 2);
    applyTuning();   // keeps the mask pass alive while a debug view is on, even if the preset has haze off
  }

  setQuality(quality);
  setPreset(preset);

  const unsub: Array<() => void> = [];
  if (opts.autoWire !== false) {
    unsub.push(ctx.events.on('preset', (e) => setPreset(e.preset)));
    unsub.push(ctx.events.on('quality', (e) => setQuality(e.quality)));
  }

  return {
    passes, setPreset, setLens, setQuality, setDebug, tuning, applyTuning,
    effects: { haze, bloom, exposureWB, tone, grade, lut, tiltShift, smaa, chromatic, finish },
    hazeMaskPass: hazeMask,
    dispose() {
      unsub.forEach((f) => f());
      for (const p of passes) p.dispose();
      noise.dispose();
      lutTex?.dispose();
      void lens;
    },
  };
}
