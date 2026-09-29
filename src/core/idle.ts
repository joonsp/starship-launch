// The idle gate: decides whether a frame must be drawn. OWNER: integrator (src/core).
//
// The scene is frozen, so once the progressive cloud accumulation has converged and the shadow map has settled, drawing
// the same image again is pure waste (a full HDR frame graph, 60 times a second). Rather than a fixed frame budget the
// gate is a pure function of a few facts, so it is unit-tested; main.ts gathers the facts each animation tick.

export interface IdleFacts {
  /** ?idle=0 turns the gate off (draw every frame). */
  gate: boolean;
  /** False during start-up: every frame is drawn (the loading screen warms them up). */
  ready: boolean;
  /** Frames still owed after an event that can change the image (camera moved, preset, quality, resize, ...). */
  awakeFrames: number;
  /** Slow drift animates the scene every frame. */
  drifting: boolean;
  /** The volume pass has accumulated all its frames (it stops marching then). */
  volumeConverged: boolean;
  /** The pipeline still owes a shadow / LOD refresh (camera settled recently). */
  pipelineBusy: boolean;
  /** A background sky re-bake is running (it swaps the sky in when done). */
  skyJobRunning: boolean;
  /** The 3D annotation overlay changed (layer switch, edu on / off) without any camera event. */
  overlayChanged: boolean;
  /** New shader programs are linking in the background: hold the last frame instead of stalling on them. */
  compiling: boolean;
}

/** True when the frame graph must run this tick. */
export function shouldDraw(f: IdleFacts): boolean {
  if (!f.gate || !f.ready) return true;
  if (f.compiling) return false;
  return f.awakeFrames > 0 || f.drifting || !f.volumeConverged || f.pipelineBusy || f.skyJobRunning || f.overlayChanged;
}

/** Has the drawing buffer grown enough since the auto-quality probe last ran that the verdict is stale (fullscreen, 4K monitor)? */
export function probeStale(probedPixels: number, nowPixels: number, factor = 1.5): boolean {
  return probedPixels > 0 && nowPixels > probedPixels * factor;
}
