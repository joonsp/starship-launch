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
  /** Record a seamless wallpaper loop with these settings (the app shows progress through UiShell.recording). */
  recordLoop(settings: LoopSettings): void | Promise<void>;
}

/** Output resolutions offered for the wallpaper loop ('screen' = this monitor in device pixels). */
export type LoopResolutionId = 'screen' | '1080' | '1440' | '2160';
export const LOOP_RESOLUTIONS: LoopResolutionId[] = ['screen', '1080', '1440', '2160'];
export const LOOP_SECONDS = [10, 15, 20, 30] as const;
export const LOOP_FPS = [24, 30, 60] as const;
export const LOOP_CROSSFADE = { min: 1, max: 4, step: 0.5 };

/** What the wallpaper-loop panel asks the app to record. */
export interface LoopSettings {
  width: number;
  height: number;
  seconds: number;
  fps: number;
  /** Crossfade that closes the loop, in seconds. */
  crossfade: number;
}

/** Progress of a running recording, as the overlay displays it. */
export interface LoopProgressView {
  phase: 'prepare' | 'warmup' | 'render' | 'finalize';
  done: number;
  total: number;
  /** Output frames encoded / loop frames. */
  encoded: number;
  frames: number;
  etaS: number | null;
  /** Latest output frame, for the preview thumbnail. */
  frame?: CanvasImageSource;
}

/** A finished recording: the two files the wallpaper plugin pairs by name. */
export interface LoopFiles {
  stem: string;
  video: Blob;
  poster: Blob;
  /** e.g. "H.264" */
  codecLabel: string;
  width: number;
  height: number;
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
export const LOADING_STAGES = ['models', 'textures', 'pad', 'clouds', 'shaders', 'frame', 'ready'] as const;
