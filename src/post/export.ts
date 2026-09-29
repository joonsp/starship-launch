// Still-image export: one converged frame at `scale` x the current resolution, as a PNG download.
// OWNER: post-processing module.
//
//   await exportStill(ctx, render, 2, { resize })
//
// Flow: remember the renderer/camera/globals state -> resize the drawing buffer to scale x
// (clamped to the GPU limits) -> reset accumulation -> render N frames (the accumulating
// volumetrics and the temporal filters converge) -> read the canvas back with toBlob IN THE SAME
// TASK as the last render (the app's renderer may have preserveDrawingBuffer = false) -> restore
// everything -> download. The scene is frozen, so the result is deterministic.
import * as THREE from 'three';
import type { AppContext } from '../contracts.ts';
import { T_F } from '../scene-config.ts';

export interface ExportOptions {
  /**
   * Resize the WHOLE pipeline (renderer, composer and every pass target) to a drawing buffer of
   * `width` x `height` pixels. `pixelRatio` is what the app should use for the CSS size it
   * restores to. The integrator passes its own resize function here (typically
   * composer.setSize(cssW, cssH) after renderer.setPixelRatio(pixelRatio)).
   * Default: renderer.setPixelRatio(pixelRatio) + renderer.setSize(width / pixelRatio, height /
   * pixelRatio, false), which resizes the canvas only, so it is only correct when `render` itself
   * resizes the composer to the canvas.
   */
  resize?: (width: number, height: number, pixelRatio: number) => void;
  /** Converged frames to render (default 24 when quality.accumulate, else 2). */
  frames?: number;
  /** Progress callback 0..1, called before each frame and once at the end. */
  onProgress?: (fraction: number) => void;
  /** Return true to abort; state is restored and nothing is downloaded. */
  aborted?: () => boolean;
  /** Set false to get the PNG blob back without triggering a download. */
  download?: boolean;
}

export interface ExportResult { blob: Blob; filename: string; width: number; height: number }

let busy = false;

/** File name used for the download, e.g. starship-flight14-T+7.2s-photo.png */
export function stillFilename(presetId: string): string {
  return `starship-flight14-T+${T_F.toFixed(1)}s-${presetId}.png`;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Largest size (same aspect) that fits the GPU limits and a 64 Mpx budget. */
function fitSize(renderer: THREE.WebGLRenderer, w: number, h: number, scale: number): { width: number; height: number; scale: number } {
  const gl = renderer.getContext();
  const maxTex = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, 8192);
  let s = scale;
  s = Math.min(s, maxTex / w, maxTex / h);
  s = Math.min(s, Math.sqrt((64e6) / (w * h)));
  s = Math.max(s, 1);
  return { width: Math.round(w * s), height: Math.round(h * s), scale: s };
}

export async function exportStill(
  ctx: AppContext,
  render: (frame: number, total: number) => void,
  scale = 2,
  opts: ExportOptions = {},
): Promise<ExportResult | null> {
  if (busy) return null;
  busy = true;
  const { renderer, canvas, camera, globals } = ctx;

  // ── remember ──
  const prevPixelRatio = renderer.getPixelRatio();
  const prevSize = renderer.getSize(new THREE.Vector2());
  const prevDrawing = renderer.getDrawingBufferSize(new THREE.Vector2());
  const prevStyleW = canvas.style.width, prevStyleH = canvas.style.height;
  const prevAspect = (camera as THREE.PerspectiveCamera).aspect;
  const prevRes = globals.uResolution.value.clone();
  const prevFrame = globals.uFrame.value;
  const target = fitSize(renderer, prevDrawing.x, prevDrawing.y, scale);
  const frames = opts.frames ?? (ctx.quality.accumulate ? 24 : 2);
  const doResize = opts.resize ?? ((w: number, h: number, pr: number) => { renderer.setPixelRatio(pr); renderer.setSize(Math.round(w / pr), Math.round(h / pr), false); });

  const restore = () => {
    // CSS size and pixel ratio are restored so the on-screen canvas is unchanged.
    doResize(Math.round(prevSize.x * prevPixelRatio), Math.round(prevSize.y * prevPixelRatio), prevPixelRatio);
    renderer.setPixelRatio(prevPixelRatio);
    canvas.style.width = prevStyleW;
    canvas.style.height = prevStyleH;
    if ('aspect' in camera) { (camera as THREE.PerspectiveCamera).aspect = prevAspect; (camera as THREE.PerspectiveCamera).updateProjectionMatrix(); }
    globals.uResolution.value.copy(prevRes);
    globals.uFrame.value = prevFrame;
    ctx.events.emit({ type: 'camera-moved' });
    ctx.events.emit({ type: 'reset-accumulation' });
  };

  try {
    // ── resize to the export size ──
    doResize(target.width, target.height, 1);
    const b = renderer.getDrawingBufferSize(prevDrawing);
    globals.uResolution.value.set(b.x, b.y);
    globals.uFrame.value = 0;
    ctx.events.emit({ type: 'camera-moved' });
    ctx.events.emit({ type: 'reset-accumulation' });

    // ── converge ──
    for (let i = 0; i < frames - 1; i++) {
      if (opts.aborted?.()) { restore(); return null; }
      opts.onProgress?.(i / frames);
      render(i, frames);
      globals.uFrame.value++;
      // Yield so the GPU queue drains and the tab stays responsive (a 5760x3240 frame is heavy).
      await nextFrame();
    }
    if (opts.aborted?.()) { restore(); return null; }

    // ── final frame + synchronous readback (same task) ──
    render(frames - 1, frames);
    globals.uFrame.value++;
    const width = canvas.width, height = canvas.height;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));   // snapshot is taken synchronously by toBlob
    opts.onProgress?.(1);
    restore();
    if (!blob) return null;

    const filename = stillFilename(ctx.preset.id);
    if (opts.download !== false) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    return { blob, filename, width, height };
  } catch (e) {
    restore();
    throw e;
  } finally {
    busy = false;
  }
}
