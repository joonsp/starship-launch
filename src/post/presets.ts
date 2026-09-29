// Lighting presets (photo / noon / night / thermal / clay) and the per-preset post tuning.
// OWNER: post-processing module.
//
//   PRESETS[id]                the LightingPreset contract object (sun, sky, ambient, fog, grade ...)
//   POST_TUNING[id]            post-only knobs the contract has no field for (bloom, haze, LUT, ...)
//   applyPresetToGlobals(...)  writes the globals and emits {type:'preset'}
//   PRESET_ORDER / nextPreset  for the L key
//
// Radiance scale reminder (contracts.ts): sun-lit white diffuse = sun.color * sun.intensity / PI
// (three's Lambert BRDF), so intensity 3.2 gives a white wall at normal incidence about 1.0. The
// post exposure multiplies scene radiance before AgX.
import * as THREE from 'three';
import type { AppContext, LightingPreset, LightingPresetId } from '../contracts.ts';
import { ViewMode } from '../contracts.ts';
import { PHOTO_PRESET, dirFromHeading, SUN_DIR } from '../scene-config.ts';
import { registerStrings } from '../i18n.ts';

const c = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

/** Neutral grade: no colour push at all. */
const NEUTRAL_GRADE: LightingPreset['grade'] = { temperature: 0, tint: 0, contrast: 1, saturation: 1, lift: 0, gain: 1 };

// ── photo ── the calibrated golden-hour preset from scene-config (shared object on purpose).
const photo: LightingPreset = PHOTO_PRESET;

// ── noon ── sun about 65 degrees up, near white. Skylight dominates the fill, the plume is a
// smaller part of the picture, so its light contribution is halved and the grade is neutral-warm.
const noon: LightingPreset = {
  id: 'noon',
  label: { en: 'Noon', fi: 'Keskipäivä' },
  viewMode: ViewMode.Photo,
  sun: { dir: dirFromHeading(170, 65), color: c(1.0, 0.95, 0.88), intensity: 5.2 },
  sky: { turbidity: 2.6, rayleigh: 1.2, mieCoefficient: 0.005, mieDirectionalG: 0.8, brightness: 1.15 },
  ambient: { sky: c(0.36, 0.52, 0.8), ground: c(0.2, 0.17, 0.13), intensity: 1.15 },
  plumeLightScale: 0.55,
  exposure: 0.85,
  fog: { color: c(0.68, 0.78, 0.9), density: 0.00009 },
  grade: { temperature: 0.0, tint: 0.0, contrast: 1.04, saturation: 1.06, lift: 0.0, gain: 1.0 },
};

// ── night ── sun 15 degrees BELOW the horizon and switched off; only a faint blue moonlight-like
// ambient remains, so the plume (light scale 1.3, exposure up) lights everything it can reach.
const night: LightingPreset = {
  id: 'night',
  label: { en: 'Night launch', fi: 'Yölaukaisu' },
  viewMode: ViewMode.Photo,
  sun: { dir: dirFromHeading(95, -15), color: c(0.4, 0.5, 0.8), intensity: 0 },
  sky: { turbidity: 1.5, rayleigh: 0.35, mieCoefficient: 0.002, mieDirectionalG: 0.7, brightness: 0.012 },
  ambient: { sky: c(0.025, 0.04, 0.09), ground: c(0.012, 0.012, 0.018), intensity: 1.0 },
  plumeLightScale: 1.3,
  exposure: 1.7,
  fog: { color: c(0.012, 0.02, 0.045), density: 0.00006 },
  grade: { temperature: -0.1, tint: 0.0, contrast: 1.12, saturation: 1.05, lift: 0.0, gain: 1.0 },
};

// ── thermal ── false-colour temperature view; grading must not touch the ramp.
const thermal: LightingPreset = {
  id: 'thermal',
  label: { en: 'Thermal camera', fi: 'Lämpökamera' },
  viewMode: ViewMode.Thermal,
  sun: { dir: SUN_DIR.clone(), color: PHOTO_PRESET.sun.color.clone(), intensity: PHOTO_PRESET.sun.intensity },
  sky: { ...PHOTO_PRESET.sky },
  ambient: { sky: PHOTO_PRESET.ambient.sky.clone(), ground: PHOTO_PRESET.ambient.ground.clone(), intensity: PHOTO_PRESET.ambient.intensity },
  plumeLightScale: 1.0,
  exposure: 1.0,
  fog: { color: PHOTO_PRESET.fog.color.clone(), density: PHOTO_PRESET.fog.density },
  grade: { ...NEUTRAL_GRADE },
};

// ── clay ── albedo-neutral form study with the photo sun.
const clay: LightingPreset = {
  id: 'clay',
  label: { en: 'Clay (form study)', fi: 'Savimalli' },
  viewMode: ViewMode.Clay,
  sun: { dir: SUN_DIR.clone(), color: PHOTO_PRESET.sun.color.clone(), intensity: PHOTO_PRESET.sun.intensity },
  sky: { ...PHOTO_PRESET.sky },
  ambient: { sky: PHOTO_PRESET.ambient.sky.clone(), ground: PHOTO_PRESET.ambient.ground.clone(), intensity: PHOTO_PRESET.ambient.intensity },
  plumeLightScale: 1.0,
  exposure: 1.0,
  fog: { color: PHOTO_PRESET.fog.color.clone(), density: PHOTO_PRESET.fog.density },
  grade: { ...NEUTRAL_GRADE },
};

export const PRESETS: Record<LightingPresetId, LightingPreset> = { photo, noon, night, thermal, clay };

/** Order of the L key. */
export const PRESET_ORDER: LightingPresetId[] = ['photo', 'noon', 'night', 'thermal', 'clay'];

/** Post-only knobs per preset (the LightingPreset contract has no fields for them). */
export interface PostTuning {
  /** Multiplier on preset.exposure (1 = as the preset says). Lets the integrator trim the look without editing the contract preset. */
  exposureBias: number;
  /** Photo-look LUT strength, 0 = off. */
  lut: number;
  /** Bloom intensity (scene-referred, added before exposure and AgX). */
  bloomIntensity: number;
  /** Bloom threshold in DISPLAY-relative luminance: the effective linear threshold is this / exposure. */
  bloomThreshold: number;
  bloomSmoothing: number;
  /** Bloom mip radius. */
  bloomRadius: number;
  /** Heat-haze displacement in screen heights at mask = 1. */
  hazeAmp: number;
  /** Vignette darkness at the corners (0..1) and the radius where it starts. */
  vignette: number;
  vignetteOffset: number;
  /** Grain amplitude in display units. */
  grain: number;
  /** Chromatic aberration (uv units at the screen edge). */
  chromatic: number;
  /** Apply AgX (thermal bypasses it so the false-colour ramp is not desaturated). */
  toneMap: boolean;
}

const BASE_TUNING: PostTuning = {
  exposureBias: 1, lut: 1, bloomIntensity: 0.32, bloomThreshold: 2.6, bloomSmoothing: 1.6, bloomRadius: 0.72,
  hazeAmp: 0.0024, vignette: 0.14, vignetteOffset: 0.6, grain: 0.018, chromatic: 0.0006, toneMap: true,
};

export const POST_TUNING: Record<LightingPresetId, PostTuning> = {
  photo: { ...BASE_TUNING },
  noon: { ...BASE_TUNING, lut: 0.8, bloomIntensity: 0.25, hazeAmp: 0.0018, vignette: 0.12 },
  night: { ...BASE_TUNING, lut: 0.6, bloomIntensity: 0.5, bloomThreshold: 1.8, bloomSmoothing: 1.2, bloomRadius: 0.78, hazeAmp: 0.003, vignette: 0.32, grain: 0.03 },
  thermal: { ...BASE_TUNING, lut: 0, bloomIntensity: 0.16, bloomThreshold: 2.6, hazeAmp: 0, vignette: 0.1, grain: 0.01, chromatic: 0, toneMap: false },
  clay: { ...BASE_TUNING, lut: 0, bloomIntensity: 0.22, hazeAmp: 0.0012, grain: 0.012, vignette: 0.12 },
};

registerStrings({
  en: {
    'preset.photo': photo.label.en, 'preset.noon': noon.label.en, 'preset.night': night.label.en,
    'preset.thermal': thermal.label.en, 'preset.clay': clay.label.en,
  },
  fi: {
    'preset.photo': photo.label.fi, 'preset.noon': noon.label.fi, 'preset.night': night.label.fi,
    'preset.thermal': thermal.label.fi, 'preset.clay': clay.label.fi,
  },
});

/** The preset after `id` in PRESET_ORDER (wraps). dir = -1 goes backwards. */
export function nextPreset(id: LightingPresetId, dir: 1 | -1 = 1): LightingPresetId {
  const i = PRESET_ORDER.indexOf(id);
  return PRESET_ORDER[(i + dir + PRESET_ORDER.length) % PRESET_ORDER.length];
}

/**
 * Write a preset into the shared globals and announce it. Does not touch THREE lights (core owns
 * them and reacts to the 'preset' event) or globals.uPlumeLight (the plume module scales it by
 * preset.plumeLightScale in its onPreset).
 */
export function applyPresetToGlobals(ctx: AppContext, preset: LightingPreset): void {
  const g = ctx.globals;
  g.uSunDir.value.copy(preset.sun.dir).normalize();
  g.uSunColor.value.copy(preset.sun.color).multiplyScalar(preset.sun.intensity);
  g.uSkyAmbient.value.copy(preset.ambient.sky).multiplyScalar(preset.ambient.intensity);
  g.uGroundAmbient.value.copy(preset.ambient.ground).multiplyScalar(preset.ambient.intensity);
  g.uFogColor.value.copy(preset.fog.color);
  g.uFogDensity.value = preset.fog.density;
  g.uViewMode.value = preset.viewMode;
  ctx.preset = preset;
  ctx.events.emit({ type: 'preset', preset });
  ctx.events.emit({ type: 'reset-accumulation' });
}
