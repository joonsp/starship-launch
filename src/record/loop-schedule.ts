// The wallpaper-loop plan: frame schedule, crossfade weights, framing crop, bitrate and file names. OWNER: integrator.
// Pure functions (no DOM, no three.js), unit-tested in loop-schedule.test.ts; the recorder (recorder.ts) and the UI
// panel (src/ui/loop-panel.ts) both use them, so the framing guide and the recording cannot disagree.
//
// Seamless loop through a rotated crossfade. Slow drift is not periodic (the steam advects and grows, the plume flow
// scrolls), so the loop is closed with a dissolve. Render N + C frames f(0..N+C-1) in time order (N = loop frames,
// C = crossfade frames) and output N frames o(0..N-1):
//
//   f(0..C-1)            stored (compressed), not output yet: the "lead" frames
//   o(j) = f(C+j)        for j in [0, N-C)
//   o(j) = mix(f(C+j), f(j-N+C), w_k)   for j in [N-C, N), k = j-(N-C), w_k = (k+1)/(C+1)
//
// Looping o(N-1) -> o(0): o(N-1) = mix(f(N+C-1), f(C-1), C/(C+1)) and o(0) = f(C), i.e. the lead track advances
// from f(C-1) to f(C) while its weight steps from C/(C+1) to 1, the same 1/(C+1) step as every frame of the dissolve.
// No rendered frame is shown twice and every output index is written exactly once.

/** What the recorder does with rendered frame i. */
export type FrameAction =
  /** Keep this frame (compressed) as lead frame `lead`; nothing is encoded. */
  | { kind: 'store'; lead: number }
  /** Encode this frame as output `out`. */
  | { kind: 'output'; out: number }
  /** Encode mix(this frame, lead frame `lead`, w) as output `out` (w = weight of the lead frame). */
  | { kind: 'blend'; out: number; lead: number; w: number };

export interface LoopPlan {
  /** Output (loop) frames. */
  n: number;
  /** Crossfade frames. */
  c: number;
  /** Frames to render after the warm-up (n + c). */
  total: number;
}

/** Frames for a loop of `seconds` at `fps` with a `crossfadeS` dissolve. The crossfade is clamped to half the loop. */
export function loopPlan(seconds: number, fps: number, crossfadeS: number): LoopPlan {
  const n = Math.max(2, Math.round(seconds * fps));
  const c = Math.max(1, Math.min(Math.round(crossfadeS * fps), Math.floor(n / 2)));
  return { n, c, total: n + c };
}

/** Weight of the lead frame in dissolve frame k (0-based), rising 1/(C+1) ... C/(C+1). */
export function blendWeight(k: number, c: number): number {
  return (k + 1) / (c + 1);
}

/** The action for rendered frame i (0 <= i < n + c). */
export function frameAction(i: number, n: number, c: number): FrameAction {
  if (!(c >= 1 && c < n)) throw new RangeError(`crossfade ${c} must be in [1, ${n})`);
  if (!(i >= 0 && i < n + c) || !Number.isInteger(i)) throw new RangeError(`frame ${i} outside [0, ${n + c})`);
  if (i < c) return { kind: 'store', lead: i };
  const out = i - c;
  if (out < n - c) return { kind: 'output', out };
  const k = out - (n - c);
  return { kind: 'blend', out, lead: out - n + c, w: blendWeight(k, c) };
}

/** Output frame j as a mixture of rendered frames: [[renderedIndex, weight], ...] (weights sum to 1). */
export function outputMixture(j: number, n: number, c: number): Array<[number, number]> {
  if (j < n - c) return [[c + j, 1]];
  const k = j - (n - c);
  const w = blendWeight(k, c);
  return [[c + j, 1 - w], [j - n + c, w]];
}

// ── framing ───────────────────────────────────────────────────────────────────────────────────────

export interface FramingCrop {
  /** Crop rectangle in fractions of the live view (0..1), centred. */
  x: number; y: number; w: number; h: number;
  /**
   * tan(fov'/2) / tan(fov/2): how the vertical field of view must shrink so the recording shows exactly the crop.
   * 1 when the target is narrower than the view (pillarbox: same vertical extent, less width).
   */
  tanScale: number;
}

/**
 * The largest centred rectangle of the live view with the target aspect: what the recording will show. The camera's
 * fov is vertical, so a narrower target keeps the fov (pillarbox), a wider one narrows it (letterbox).
 */
export function framingCrop(viewAspect: number, targetAspect: number): FramingCrop {
  if (targetAspect <= viewAspect) {
    const w = targetAspect / viewAspect;
    return { x: (1 - w) / 2, y: 0, w, h: 1, tanScale: 1 };
  }
  const h = viewAspect / targetAspect;
  return { x: 0, y: (1 - h) / 2, w: 1, h, tanScale: h };
}

/** The recording's vertical fov (degrees) for a live fov and the crop. */
export function recordFovDeg(fovDeg: number, crop: FramingCrop): number {
  const r = Math.PI / 180;
  return (2 * Math.atan(Math.tan((fovDeg * r) / 2) * crop.tanScale)) / r;
}

// ── sizes, bitrate, names ─────────────────────────────────────────────────────────────────────────

/** Round to even pixel counts (4:2:0 chroma subsampling needs even dimensions). */
export function evenDims(w: number, h: number): { width: number; height: number } {
  const ev = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return { width: ev(w), height: ev(h) };
}

/** "This screen" in device pixels (screen.width x devicePixelRatio, ...), rounded to even numbers. */
export function screenDims(screenW: number, screenH: number, dpr: number): { width: number; height: number } {
  return evenDims(screenW * (dpr || 1), screenH * (dpr || 1));
}

/** Fixed output sizes offered next to "this screen". */
export const LOOP_PRESET_SIZES: Record<'1080' | '1440' | '2160', { width: number; height: number }> = {
  1080: { width: 1920, height: 1080 },
  1440: { width: 2560, height: 1440 },
  2160: { width: 3840, height: 2160 },
};

/** Greatest-common-divisor aspect label, e.g. 2880x1920 -> "3:2", 3440x1440 -> "43:18" (close to a known ratio -> that). */
export function aspectLabel(w: number, h: number): string {
  const known: Array<[number, number]> = [[16, 9], [16, 10], [3, 2], [4, 3], [21, 9], [32, 9], [5, 4], [9, 16]];
  const a = w / h;
  for (const [x, y] of known) if (Math.abs(a - x / y) / (x / y) < 0.012) return `${x}:${y}`;
  const g = (p: number, q: number): number => (q ? g(q, p % q) : p);
  const d = g(w, h);
  return `${w / d}:${h / d}`;
}

/**
 * Codec preference. H.264 plays everywhere, so it comes first wherever the browser has a real (hardware) H.264 encoder.
 * Chrome's only software H.264 encoder (OpenH264, e.g. on Linux) ignores the requested bitrate and, on this slow drift,
 * leaves the P-frames nearly unchanged and catches up at every keyframe: a visible tick every 2 s (measured: a
 * structural jump ~30x a normal frame step). libvpx VP9 tracks the motion, so without hardware H.264 it goes first.
 */
export function codecOrder(hardwareAvc: boolean): Array<'avc' | 'vp9' | 'av1'> {
  return hardwareAvc ? ['avc', 'vp9', 'av1'] : ['vp9', 'avc', 'av1'];
}

export const BITS_PER_PIXEL = 0.12;
export const MIN_BITRATE = 6e6;
export const MAX_BITRATE = 60e6;

/** Target bitrate (bits/s): ~0.12 bits per pixel per frame, clamped to 6..60 Mbit/s. */
export function loopBitrate(w: number, h: number, fps: number, bitsPerPixel = BITS_PER_PIXEL): number {
  return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, w * h * fps * bitsPerPixel)));
}

/** Estimated file size in bytes of the video (the encoder is VBR, so this is a ballpark). */
export function estimateBytes(w: number, h: number, fps: number, seconds: number): number {
  return (loopBitrate(w, h, fps) * seconds) / 8;
}

/**
 * Shared stem of the video and the poster: the wallpaper plugin pairs `<stem>.png` with `<stem>.mp4`. The LOCAL time
 * (minute resolution) keeps successive recordings apart, e.g. starship-loop-2560x1440-20260929-2251.
 */
export function loopStem(w: number, h: number, date: Date = new Date()): string {
  const p = (v: number) => String(v).padStart(2, '0');
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
  return `starship-loop-${w}x${h}-${stamp}`;
}
