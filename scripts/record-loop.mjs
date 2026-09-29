#!/usr/bin/env node
// Headless wallpaper-loop recorder: drives the app's own offline recorder (window.app.recordLoop) in Chromium and writes
// <stem>.mp4 + <stem>.png (the poster = video frame 0) into outDir. The Omarchy background plugin plays <stem>.mp4
// while the current background is <stem>.png from the same folder. OWNER: integrator.
//
// Usage:  node scripts/record-loop.mjs <width> <height> <seconds> <fps> <outDir> [crossfadeS=2]
//   e.g.  npm run dev   (in another terminal)
//         node scripts/record-loop.mjs 2560 1440 15 30 ~/Pictures/wallpapers
// Env:    URL=http://127.0.0.1:5173/  app URL (the dev server or `npm run preview`)
//         QUALITY=high                  render quality (low|medium|high|ultra; default high)
//         PRESET=photo                  lighting preset (photo|noon|night|thermal|clay)
//         CHROME=/usr/bin/chromium      use this browser instead of Playwright's Chromium
//         SW=1                          SwiftShader software rendering (very slow; no GPU needed)
//         CODEC=avc,vp9,av1             codec preference (default: avc first only with a hardware H.264 encoder, else vp9)
//         BPP=0.12                      bits per pixel per frame (clamped to 6..60 Mbit/s)
//         BITRATE_MODE=variable         or constant
// The framing is the default photo camera: the viewport gets the output's aspect ratio, so nothing is cropped.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

function loadPlaywright() {
  const tries = [process.cwd(), path.dirname(new URL(import.meta.url).pathname)];
  try { tries.push(execSync('npm root -g', { encoding: 'utf8' }).trim()); } catch { /* ignore */ }
  for (const base of tries) {
    try { return createRequire(path.join(base, 'noop.js'))('playwright'); } catch { /* next */ }
  }
  throw new Error('playwright not found: npm i -D playwright && npx playwright install chromium');
}

const [w, h, secs, fpsArg, outDir, fadeArg] = process.argv.slice(2);
const width = Number(w), height = Number(h), seconds = Number(secs), fps = Number(fpsArg), crossfade = Number(fadeArg ?? 2);
if (!(width > 0 && height > 0 && seconds > 0 && fps > 0) || !outDir) {
  console.error('usage: node scripts/record-loop.mjs <width> <height> <seconds> <fps> <outDir> [crossfadeS=2]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const base = process.env.URL || 'http://127.0.0.1:5173/';
const url = new URL(base);
url.searchParams.set('ui', '0');
url.searchParams.set('probe', '0');
url.searchParams.set('quality', process.env.QUALITY || 'high');
if (process.env.PRESET) url.searchParams.set('preset', process.env.PRESET);

// Viewport with the output's aspect (fits in 1600 x 1000 CSS px): the recording is then the whole live view.
const s = Math.min(1600 / width, 1000 / height);
const viewport = { width: Math.round(width * s), height: Math.round(height * s) };

const { chromium } = loadPlaywright();
const gpuArgs = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit'];
const swArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({
  headless: true,
  args: process.env.SW === '1' ? swArgs : gpuArgs,
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
});
const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const t0 = Date.now();
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
try {
  console.log(`${since()} loading ${url} (viewport ${viewport.width}x${viewport.height})`);
  await page.goto(url.toString(), { waitUntil: 'load' });
  // Wait for the app, but give up at once on an uncaught page error (a broken build never becomes ready).
  const readyBy = Date.now() + Number(process.env.QA_TIMEOUT || 600000);
  while (!(await page.evaluate(() => window.app?.ready === true))) {
    const err = logs.find((l) => l.startsWith('[pageerror]'));
    if (err) throw new Error(`the app failed to start: ${err}`);
    if (Date.now() > readyBy) throw new Error('the app did not become ready in time');
    await page.waitForTimeout(500);
  }
  const gpu = await page.evaluate(() => window.app.gpu);
  console.log(`${since()} app ready; GPU ${gpu?.gpu} (${gpu?.id})`);

  // Start the job in the page; progress is polled from here (functions cannot cross the page boundary).
  await page.evaluate((opts) => {
    window.__loop = { progress: null, result: null, error: null, done: false };
    window.app.recordLoop({ ...opts, download: false, onProgress: (p) => { window.__loop.progress = { phase: p.phase, done: p.done, total: p.total, encoded: p.encoded, frames: p.frames, etaS: p.etaS }; } })
      .then((r) => { window.__loop.result = r; window.__loop.done = true; })
      .catch((e) => { window.__loop.error = String(e?.stack || e); window.__loop.done = true; });
  }, {
    width, height, seconds, fps, crossfade,
    ...(process.env.CODEC ? { codecs: process.env.CODEC.split(',') } : {}),
    ...(process.env.BPP ? { bitsPerPixel: Number(process.env.BPP) } : {}),
    ...(process.env.BITRATE_MODE ? { bitrateMode: process.env.BITRATE_MODE } : {}),
  });

  let lastLine = '';
  for (;;) {
    const st = await page.evaluate(() => ({ done: window.__loop.done, p: window.__loop.progress, err: window.__loop.error }));
    if (st.p) {
      const eta = st.p.etaS == null ? '' : ` eta ${Math.round(st.p.etaS)} s`;
      const line = `${since()} ${st.p.phase} ${st.p.done}/${st.p.total} (encoded ${st.p.encoded}/${st.p.frames})${eta}`;
      if (line !== lastLine) { console.log(line); lastLine = line; }
    }
    if (st.done) { if (st.err) throw new Error(st.err); break; }
    await page.waitForTimeout(2000);
  }

  const meta = await page.evaluate(() => {
    const r = window.__loop.result;
    if (!r) return null;
    return { stem: r.stem, codec: r.codec, mimeType: r.mimeType, width: r.width, height: r.height, fps: r.fps, frames: r.frames, bitrate: r.bitrate,
      videoBytes: r.video.size, posterBytes: r.poster.size, renderMs: r.renderMs, totalMs: r.totalMs };
  });
  if (!meta) throw new Error('recording was cancelled or produced nothing');

  // Pull a blob out of the page as base64 chunks (a single multi-10-MB string is slow to serialise).
  async function pull(which, file) {
    const size = await page.evaluate((k) => window.__loop.result[k].size, which);
    const fd = fs.openSync(file, 'w');
    const CHUNK = 6 * 1024 * 1024;
    for (let off = 0; off < size; off += CHUNK) {
      const b64 = await page.evaluate(async ([k, a, b]) => {
        const buf = new Uint8Array(await window.__loop.result[k].slice(a, b).arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        return btoa(s);
      }, [which, off, Math.min(size, off + CHUNK)]);
      fs.writeSync(fd, Buffer.from(b64, 'base64'));
    }
    fs.closeSync(fd);
    return file;
  }
  const mp4 = await pull('video', path.join(outDir, `${meta.stem}.mp4`));
  const png = await pull('poster', path.join(outDir, `${meta.stem}.png`));
  console.log(`${since()} wrote ${mp4} (${(meta.videoBytes / 1e6).toFixed(1)} MB) and ${png} (${(meta.posterBytes / 1e6).toFixed(1)} MB)`);
  console.log(`codec ${meta.codec} (${meta.mimeType}), ${meta.frames} frames ${meta.width}x${meta.height} @ ${meta.fps} fps, `
    + `target ${(meta.bitrate / 1e6).toFixed(1)} Mbit/s; render ${(meta.renderMs / 1000).toFixed(1)} s = `
    + `${(meta.frames / (meta.renderMs / 1000)).toFixed(2)} output frames/s, job ${(meta.totalMs / 1000).toFixed(1)} s`);
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  const interesting = logs.filter((l) => /error|warn|\[loop\]/i.test(l));
  if (interesting.length) console.log(interesting.join('\n'));
  await browser.close();
}
