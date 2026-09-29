// Public types of the DOM UI shell. OWNER: src/ui.
// The shell has NO runtime three.js dependency: it only imports types from contracts.ts.
import type { CameraModeId, Lang, LensState, LightingPresetId, QualityId } from '../contracts.ts';

export type QualityChoice = QualityId | 'auto';

/** Everything the shell can ask the app to do. The integrator wires these to controller / post / edu / core. */
export interface UiHandlers {
  setCameraMode(mode: CameraModeId): void;
  setPreset(preset: LightingPresetId): void;
  /** 'auto' = adaptive quality; otherwise a fixed QualityId. */
  setQuality(q: QualityChoice): void;
  setDrift(enabled: boolean): void;
  setEdu(enabled: boolean): void;
  /** MUST call i18n.setLang(lang) (the shell re-renders from onLangChange) and emit the 'lang' event. */
  setLang(lang: Lang): void;
  /** May return a promise; the button is disabled until it settles. Toast the result via UiShell.toast(). */
  exportStill(): void | Promise<void>;
  /** Partial lens update. When tilt-shift changes, `tiltShift` is always the FULL merged object. */
  setLens(partial: Partial<LensState>): void;
  resetLens(): void;
}

/** Current app state as the shell displays it. Push changes with UiShell.update(). */
export interface UiState {
  mode: CameraModeId;
  preset: LightingPresetId;
  quality: QualityChoice;
  drift: boolean;
  edu: boolean;
  lang: Lang;
  lens: LensState;
  /** Seconds after liftoff at which the scene is frozen (T_F from scene-config; shown in the badge). */
  T_F: number;
  /** Smoothed frames per second; the readout is hidden while undefined. */
  fps?: number;
  /** When quality is 'auto': the level currently chosen (shown as "Auto · High"). */
  effectiveQuality?: QualityId;
  /** Pointer-lock state override. Normally omitted: the shell listens to `pointerlockchange` itself. */
  locked?: boolean;
}

/** Slider ranges for the lens panel. Mutable so the integrator can tune them before constructing the shell. */
export const LENS_RANGES = {
  fovDeg: { min: 10, max: 110, step: 0.5 },
  rollDeg: { min: -45, max: 45, step: 0.5 },
  focusY: { min: 0, max: 1, step: 0.01 },
  band: { min: 0.02, max: 0.6, step: 0.01 },
  blur: { min: 0, max: 1, step: 0.01 },
};

/** Lighting presets shown in the menu, in cycle order (L key). */
export const PRESET_ORDER: LightingPresetId[] = ['photo', 'noon', 'night', 'thermal', 'clay'];
/** Quality choices shown in the menu. */
export const QUALITY_ORDER: QualityChoice[] = ['auto', 'low', 'medium', 'high', 'ultra'];
/** Camera modes, in key order (1-4). */
export const MODE_ORDER: CameraModeId[] = ['orbit', 'photo', 'walk', 'fly'];
/** Loading stages that have built-in translations; setLoading() also accepts free text. */
export const LOADING_STAGES = ['models', 'textures', 'pad', 'clouds', 'shaders', 'ready'] as const;
