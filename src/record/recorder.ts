// Offline wallpaper-loop recorder: fixed-dt frames -> crossfaded seamless loop -> WebCodecs -> MP4 (+ poster PNG).
// OWNER: integrator. Loaded on demand (dynamic import from main.ts) so mediabunny stays out of the main bundle.
//
// The host (main.ts) owns the app state: it resizes the pipeline to the output size, sets the camera aspect / fov,
// turns drift on, hides the UI and restores all of it afterwards. This module only drives frames through
// host.renderFrame(dt) and encodes them; it never looks at the wall clock for simulation time, so it may run slower
// than real time without changing the result.
//
// Per rendered frame (schedule and weights: loop-schedule.ts):
//   [blend frames: decode the stored lead frame first]  ->  renderFrame(dt)  ->  drawImage(GL canvas) into a 2D
//   OffscreenCanvas at the output size IN THE SAME TASK (the WebGL canvas has preserveDrawingBuffer: false)
//   -> [globalAlpha = w; drawImage(lead)] -> VideoFrame -> WebCodecs VideoEncoder (awaiting backpressure)
//   -> mediabunny (MP4 muxing only). Keyframes every 2 s of output.
// Lead frames f(0..C-1) are kept as PNG blobs: lossless (a lossy lead shows at the seam: o(N-1) is C/(C+1) lead,
// o(0) is a pristine render, and JPEG q0.95 measured a mean error of ~2 levels there against ~0.2 for a normal frame
// step) and compact (a raw 4K frame is ~33 MB, its PNG ~1/2.3 of that; Chrome pages large blobs out to disk).
// The poster is a PNG of the 2D canvas at output 0, i.e. exactly the pixels handed to the encoder as frame 0.
//
// Encoder pre-roll: the last 2 s of the warm-up are encoded too, with negative timestamps, and their packets dropped.
// They settle the rate control, so frame 0 (a forced keyframe, where the loop seam lands) is coded like every later
// keyframe instead of as the first frame of a fresh encoder (measured at 1440p without it: the seam step was ~1.7x the
// other keyframe steps, visible as sharpened static edges for one frame).
import { BufferTarget, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output, type VideoCodec } from 'mediabunny';
import { codecOrder, frameAction, loopBitrate, loopPlan, loopStem } from './loop-schedule.ts';

export interface RecordHost {
  /** The WebGL canvas the app renders into (its drawing buffer is already the output size). */
  canvas: HTMLCanvasElement;
  /** Advance the simulation by exactly dt seconds and render one frame into `canvas`. */
  renderFrame(dt: number): void;
}

export type RecordPhase = 'prepare' | 'warmup' | 'render' | 'finalize';

export interface RecordProgress {
  phase: RecordPhase;
  /** Frames done / total in this phase. */
  done: number;
  total: number;
  /** Output frames encoded so far / loop frames. */
  encoded: number;
  frames: number;
  /** Estimated seconds left for the whole job (null until measurable). */
  etaS: number | null;
  /** The 2D canvas holding the latest output frame (for a preview thumbnail). */
  frame?: OffscreenCanvas;
}

export interface RecordOptions {
  width: number;
  height: number;
  fps: number;
  /** Loop length in seconds. */
  seconds: number;
  /** Crossfade in seconds (clamped to half the loop). */
  crossfade: number;
  /** Warm-up (not in the file) in seconds: the drift EMA of the steam settles; its last 2 s prime the encoder. */
  warmup: number;
  onProgress?: (p: RecordProgress) => void;
  /** Checked between frames; true cancels (the promise resolves to null). */
  aborted?: () => boolean;
  /** Encoder tuning for scripts / experiments. Defaults: codecOrder(hardware H.264?), BITS_PER_PIXEL, 'variable'. */
  codecs?: VideoCodec[];
  bitsPerPixel?: number;
  bitrateMode?: 'variable' | 'constant';
  /** Further encoder knobs (experiments). */
  encoder?: EncoderTuning;
}

export interface EncoderTuning {
  latencyMode?: 'quality' | 'realtime';
  /** Seconds between keyframes (default 2). */
  keyFrameInterval?: number;
  /** Seconds of warm-up encoded (and dropped) before frame 0 so the rate control is settled there (default 2; 0 = off). */
  preroll?: number;
}

export interface RecordResult {
  video: Blob;
  poster: Blob;
  stem: string;
  codec: VideoCodec;
  mimeType: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  bitrate: number;
  /** Wall-clock time of the whole job (ms), and of the rendered + encoded part only. */
  totalMs: number;
  renderMs: number;
}

/** WebCodecs codec strings, with levels high enough for 4K60 (a higher level than needed is harmless). */
const CODEC_STRING: Partial<Record<VideoCodec, string>> = { avc: 'avc1.640034', vp9: 'vp09.00.51.08', av1: 'av01.0.13M.08' };

function encoderConfig(codec: VideoCodec, W: number, H: number, fps: number, bitrate: number, o: RecordOptions,
  hw: HardwareAcceleration = 'no-preference'): VideoEncoderConfig | null {
  const str = CODEC_STRING[codec];
  if (!str) return null;
  return {
    codec: str, width: W, height: H, framerate: fps, bitrate, bitrateMode: o.bitrateMode ?? 'variable',
    latencyMode: o.encoder?.latencyMode ?? 'quality', hardwareAcceleration: hw,
    ...(codec === 'avc' ? { avc: { format: 'avc' as const } } : {}),
  };
}

async function supported(cfg: VideoEncoderConfig | null): Promise<boolean> {
  if (!cfg) return false;
  try { return !!(await VideoEncoder.isConfigSupported(cfg)).supported; } catch { return false; }
}

// Yield to the event loop without rAF (never fires in a hidden tab) or setTimeout (throttled in background tabs).
const channel = new MessageChannel();
const waiting: Array<() => void> = [];
channel.port1.onmessage = () => { waiting.shift()?.(); };
const yieldTask = (): Promise<void> => new Promise((res) => { waiting.push(res); channel.port2.postMessage(0); });

export class RecordError extends Error {
  constructor(readonly code: 'no-codec' | 'too-big' | 'no-webcodecs', message: string) { super(message); }
}

export async function recordLoop(host: RecordHost, o: RecordOptions): Promise<RecordResult | null> {
  const t0 = performance.now();
  const started = new Date();   // the stem's timestamp: when Record was pressed
  const { width: W, height: H, fps } = o;
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    throw new RecordError('no-webcodecs', 'WebCodecs (VideoEncoder) is not available in this browser');
  }
  if (host.canvas.width !== W || host.canvas.height !== H) {
    throw new RecordError('too-big', `drawing buffer is ${host.canvas.width}x${host.canvas.height}, expected ${W}x${H}`);
  }
  const { n, c, total } = loopPlan(o.seconds, fps, o.crossfade);
  const warm = Math.max(0, Math.round(o.warmup * fps));
  const preroll = Math.min(warm, Math.max(0, Math.round((o.encoder?.preroll ?? 2) * fps)));
  const kfEvery = Math.max(1, Math.round((o.encoder?.keyFrameInterval ?? 2) * fps));
  const dt = 1 / fps;
  const frameUs = 1e6 / fps;
  const bitrate = loopBitrate(W, H, fps, o.bitsPerPixel);
  const report = (p: Omit<RecordProgress, 'frames'>): void => o.onProgress?.({ ...p, frames: n });
  report({ phase: 'prepare', done: 0, total: 1, encoded: 0, etaS: null });

  // ── codec: the first encodable one in the preference order, checked with the exact config that is used ──
  const hwAvc = await supported(encoderConfig('avc', W, H, fps, bitrate, o, 'prefer-hardware'));
  const order: VideoCodec[] = o.codecs?.length ? o.codecs : codecOrder(hwAvc);
  let codec: VideoCodec | null = null;
  let config: VideoEncoderConfig | null = null;
  for (const cand of order) {
    const cfg = encoderConfig(cand, W, H, fps, bitrate, o);
    if (await supported(cfg)) { codec = cand; config = cfg; break; }
  }
  if (!codec || !config) throw new RecordError('no-codec', `no encodable video codec for ${W}x${H} at ${fps} fps`);
  console.info(`[loop] encoder ${JSON.stringify(config)}; hardware H.264 ${hwAvc ? 'available' : 'not available'}`);

  const out = new OffscreenCanvas(W, H);
  const g = out.getContext('2d', { alpha: false });
  if (!g) throw new Error('2D OffscreenCanvas unavailable');
  g.imageSmoothingEnabled = false;   // same size: a straight copy

  // ── encoder -> MP4 muxer ──
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const source = new EncodedVideoPacketSource(codec);
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  let decoderConfig: VideoDecoderConfig | undefined;
  let kept = 0;
  let muxing: Promise<void> = Promise.resolve();
  let encodeError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig) decoderConfig = meta.decoderConfig;
      if (chunk.timestamp < 0) return;   // pre-roll: primes the rate control, not part of the file
      if (kept === 0 && chunk.type !== 'key') { encodeError ??= new Error('the first packet of the loop is not a keyframe'); return; }
      // the decoder config (avcC etc.) may have come with a dropped pre-roll packet: hand it over with the first kept one
      const m: EncodedVideoChunkMetadata | undefined = kept === 0 ? { ...meta, decoderConfig: meta?.decoderConfig ?? decoderConfig } : meta;
      kept++;
      const packet = EncodedPacket.fromEncodedChunk(chunk);
      muxing = muxing.then(() => source.add(packet, m)).catch((e) => { encodeError ??= e; });
    },
    error: (e) => { encodeError ??= e; },
  });
  encoder.configure(config);
  /** Encode the 2D canvas as frame `index` (negative = pre-roll), respecting encoder and muxer backpressure. */
  const encode = async (index: number, keyFrame: boolean): Promise<void> => {
    if (encodeError) throw encodeError;
    const vf = new VideoFrame(out, { timestamp: Math.round(index * frameUs), duration: Math.round(frameUs) });
    try { encoder.encode(vf, { keyFrame }); } finally { vf.close(); }
    while (encoder.encodeQueueSize > 2) await new Promise<void>((res) => encoder.addEventListener('dequeue', () => res(), { once: true }));
    await muxing;
  };

  const leads: Array<Blob | null> = new Array(c).fill(null);
  let poster: Blob | null = null;
  let finished = false;
  const cancel = async (): Promise<null> => {
    if (!finished) {
      finished = true;
      if (encoder.state !== 'closed') encoder.close();
      await output.cancel().catch(() => {});
    }
    return null;
  };

  try {
    // ── warm-up: fixed-dt frames (the drift EMA of the steam and the reflection settle); the last ones prime the encoder ──
    const tWarm = performance.now();
    for (let i = 0; i < warm; i++) {
      if (o.aborted?.()) return await cancel();
      host.renderFrame(dt);
      const pre = i - (warm - preroll);   // >= 0: a pre-roll frame
      if (pre >= 0) {
        g.globalAlpha = 1;
        g.drawImage(host.canvas, 0, 0, W, H);
        await encode(pre - preroll, pre === 0);
      }
      if ((i & 3) === 3 || i === warm - 1) {
        const per = (performance.now() - tWarm) / (i + 1);
        report({ phase: 'warmup', done: i + 1, total: warm, encoded: 0, etaS: (per * (warm - i - 1 + total * 1.3)) / 1000 });
        await yieldTask();
      }
    }

    // ── the loop: N + C frames ──
    const tRender = performance.now();
    let encoded = 0;
    // ETA per frame kind: the first C frames also write a PNG and the blends decode one, so one average misleads
    const cost = { store: { ms: 0, k: 0 }, output: { ms: 0, k: 0 }, blend: { ms: 0, k: 0 } };
    const etaAfter = (i: number): number | null => {
      const left = { store: Math.max(0, c - i - 1), output: Math.max(0, n - Math.max(i + 1, c)), blend: Math.max(0, n + c - Math.max(i + 1, n)) };
      const known = Object.values(cost).filter((x) => x.k > 0);
      if (!known.length) return null;
      const fallback = known.reduce((s, x) => s + x.ms / x.k, 0) / known.length;
      let ms = 0;
      for (const kind of ['store', 'output', 'blend'] as const) ms += left[kind] * (cost[kind].k ? cost[kind].ms / cost[kind].k : fallback);
      return ms / 1000;
    };
    for (let i = 0; i < total; i++) {
      if (o.aborted?.()) return await cancel();
      const tFrame = performance.now();
      const a = frameAction(i, n, c);
      // decode the lead BEFORE rendering: nothing may await between the render and the canvas copy
      let lead: ImageBitmap | null = null;
      if (a.kind === 'blend') {
        const blob = leads[a.lead];
        if (!blob) throw new Error(`lead frame ${a.lead} missing`);
        lead = await createImageBitmap(blob);
        leads[a.lead] = null;
      }

      host.renderFrame(dt);
      g.globalAlpha = 1;
      g.drawImage(host.canvas, 0, 0, W, H);

      if (a.kind === 'store') {
        leads[a.lead] = await out.convertToBlob({ type: 'image/png' });
      } else {
        if (lead && a.kind === 'blend') {
          g.globalAlpha = a.w;
          g.drawImage(lead, 0, 0, W, H);
          g.globalAlpha = 1;
          lead.close();
        }
        await encode(a.out, a.out % kfEvery === 0);
        encoded++;
        // poster = output frame 0 = the canvas just handed to the encoder (the 2D canvas keeps its pixels across awaits)
        if (a.out === 0) poster = await out.convertToBlob({ type: 'image/png' });
      }
      cost[a.kind].ms += performance.now() - tFrame;
      cost[a.kind].k++;
      report({ phase: 'render', done: i + 1, total, encoded, etaS: etaAfter(i), frame: out });
      await yieldTask();
    }

    if (o.aborted?.()) return await cancel();
    report({ phase: 'finalize', done: 0, total: 1, encoded, etaS: 0, frame: out });
    await encoder.flush();
    await muxing;
    if (encodeError) throw encodeError;
    encoder.close();
    if (kept !== n) throw new Error(`the encoder produced ${kept} frames, expected ${n}`);
    source.close();
    await output.finalize();
    finished = true;
    const renderMs = performance.now() - tRender;
    const buf = output.target.buffer;
    if (!buf || !poster) throw new Error('recording produced no data');
    const mimeType = await output.getMimeType();
    const video = new Blob([buf], { type: 'video/mp4' });
    report({ phase: 'finalize', done: 1, total: 1, encoded, etaS: 0, frame: out });
    return {
      video, poster, stem: loopStem(W, H, started), codec, mimeType, width: W, height: H, fps, frames: n, bitrate,
      totalMs: performance.now() - t0, renderMs,
    };
  } catch (e) {
    await cancel();
    throw e;
  }
}
