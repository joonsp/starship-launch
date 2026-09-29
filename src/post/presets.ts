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
//
// Finishing (POST_TUNING): the photo look is a modern drone camera's: AgX for the highlight roll-off, a
// mild S-curve and split tone in the look LUT, bloom only on the fire and plume (threshold above sunlit
// cloud), a faint vignette, near-invisible grain (mostly a dither) and a sub-pixel chromatic fringe.
import * as THREE from 'three';
import type { AppContext, LightingPreset, LightingPresetId } from '../contracts.ts';
import { ViewMode } from '../contracts.ts';
import { PHOTO_PRESET, dirFromHeading, SUN_DIR } from '../scene-config.ts';
import { registerStrings } from '../i18n.ts';
import { DEFAULT_PHOTO_LOOK, type PhotoLook } from './grade.ts';

const c = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

/** Neutral grade: no colour push at all. */
const NEUTRAL_GRADE: LightingPreset['grade'] = { temperature: 0, tint: 0, contrast: 1, saturation: 1, lift: 0, gain: 1 };

// ── photo ── the calibrated golden-hour preset from scene-config (shared object on purpose).
const photo: LightingPreset = PHOTO_PRESET;

// ── noon ── sun 65 degrees up, almost white (~5600 K through a short, clean air path). Crisp: a strong
// key over a deep-blue sky fill, clean white steam, a neutral-cool grade. The plume is a smaller part of the
// picture, so its light is halved.
const noon: LightingPreset = {
  id: 'noon',
  label: { en: 'Noon', fi: 'Keskipäivä' },
  viewMode: ViewMode.Photo,
  sun: { dir: dirFromHeading(170, 65), color: c(1.0, 0.965, 0.92), intensity: 5.0 },
  sky: { turbidity: 2.1, rayleigh: 1.35, mieCoefficient: 0.0035, mieDirectionalG: 0.8, brightness: 1.0 },
  ambient: { sky: c(0.3, 0.48, 0.86), ground: c(0.2, 0.18, 0.15), intensity: 1.0 },
  plumeLightScale: 0.55,
  exposure: 0.7,
  fog: { color: c(0.64, 0.75, 0.9), density: 0.00008 },
  // daylight white balance: the steam's multiply scattered light is slightly amber (dust), the camera neutralises it
  grade: { temperature: -0.1, tint: 0.0, contrast: 1.1, saturation: 1.08, lift: 0.0, gain: 1.0 },
};

// ── night ── sun 15 degrees BELOW the horizon and switched off (the sky shows its stars); a faint blue
// moonlight-like ambient is the only other light, so the plume and the ground fire light everything they
// reach and the steam glows orange from within. Exposure up, deep blacks, contrast up.
const night: LightingPreset = {
  id: 'night',
  label: { en: 'Night launch', fi: 'Yölaukaisu' },
  viewMode: ViewMode.Photo,
  sun: { dir: dirFromHeading(95, -15), color: c(0.4, 0.5, 0.8), intensity: 0 },
  sky: { turbidity: 1.2, rayleigh: 0.35, mieCoefficient: 0.0015, mieDirectionalG: 0.7, brightness: 0.01 },
  ambient: { sky: c(0.016, 0.034, 0.1), ground: c(0.01, 0.009, 0.012), intensity: 1.0 },
  plumeLightScale: 1.35,
  exposure: 1.6,
  fog: { color: c(0.008, 0.014, 0.032), density: 0.00006 },
  grade: { temperature: -0.05, tint: 0.0, contrast: 1.12, saturation: 1.08, lift: 0.0, gain: 1.0 },
};

// ── thermal ── false-colour temperature view (the photo sun, so switching does not rebake the light
// volume). The post chain re-maps the ramp (thermal.ts) and draws the scale bar; no grade, no AgX.
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

// ── clay ── albedo-neutral form study, lit like an architectural visualisation: a white sun 28 degrees up
// from the south-east (the camera side, so the faces it sees are modelled by light and shade, and the long
// shadows draw the forms on the flat ground), a soft, pale sky, a near-monochrome grade with warm whites and
// cool shadows. Exposure is low because every surface is a 0.7 albedo. The plume keeps its light.
const clay: LightingPreset = {
  id: 'clay',
  label: { en: 'Clay (form study)', fi: 'Savimalli' },
  viewMode: ViewMode.Clay,
  sun: { dir: dirFromHeading(135, 28), color: c(1.0, 0.97, 0.93), intensity: 3.8 },
  sky: { turbidity: 4.5, rayleigh: 1.0, mieCoefficient: 0.006, mieDirectionalG: 0.75, brightness: 1.0 },
  ambient: { sky: c(0.42, 0.46, 0.52), ground: c(0.24, 0.23, 0.21), intensity: 1.0 },
  plumeLightScale: 0.8,
  exposure: 0.62,
  fog: { color: c(0.78, 0.8, 0.83), density: 0.00005 },
  grade: { temperature: 0.02, tint: 0.0, contrast: 1.14, saturation: 0.28, lift: 0.0, gain: 1.0 },
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
  exposureBias: 1, lut: 1, bloomIntensity: 0.36, bloomThreshold: 2.6, bloomSmoothing: 1.6, bloomRadius: 0.75,
  hazeAmp: 0.0024, vignette: 0.14, vignetteOffset: 0.6, grain: 0.012, chromatic: 0.0003, toneMap: true,
};

export const POST_TUNING: Record<LightingPresetId, PostTuning> = {
  photo: { ...BASE_TUNING },
  noon: { ...BASE_TUNING, bloomIntensity: 0.2, hazeAmp: 0.0018, vignette: 0.1, grain: 0.01 },
  night: { ...BASE_TUNING, bloomIntensity: 0.55, bloomThreshold: 1.6, bloomSmoothing: 1.2, bloomRadius: 0.8, hazeAmp: 0.003, vignette: 0.3, grain: 0.02 },
  thermal: { ...BASE_TUNING, lut: 0, bloomIntensity: 0, hazeAmp: 0, vignette: 0.06, grain: 0.008, chromatic: 0, toneMap: false },
  clay: { ...BASE_TUNING, bloomIntensity: 0.12, hazeAmp: 0, vignette: 0.1, grain: 0, chromatic: 0 },
};

/**
 * The look LUT of each preset (grade.ts applyPhotoLook). Photo: the reference-photo look. Noon: neutral
 * highlights, cool shadows, a deeper sky. Night: deep blacks, blue shadows, rich fire. Clay: a plain curve with
 * no colour moves (the grade desaturates). Thermal bypasses it (lut 0).
 */
export const PRESET_LOOKS: Record<LightingPresetId, PhotoLook> = {
  photo: DEFAULT_PHOTO_LOOK,
  noon: { ...DEFAULT_PHOTO_LOOK, blackLift: 0.03, shadowTint: [-0.006, 0.0, 0.012], highlightTint: [0.004, 0.002, -0.004], blueSat: 0.25, orangeSat: 0.05, globalSat: 0.04, richness: 0.3, flame: 0.5, curve: 0.22 },
  night: { ...DEFAULT_PHOTO_LOOK, blackLift: 0.012, shadowTint: [-0.004, 0.0, 0.014], highlightTint: [0.018, 0.004, -0.02], blueSat: 0.1, orangeSat: 0.22, globalSat: 0.06, richness: 0.45, flame: 0.7, curve: 0.25 },
  thermal: DEFAULT_PHOTO_LOOK,
  clay: { blackLift: 0.03, shadowTint: [-0.004, 0, 0.008], highlightTint: [0.012, 0.006, -0.006], blueSat: 0, orangeSat: 0, globalSat: 0, richness: 0, flame: 0, curve: 0.12 },
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
