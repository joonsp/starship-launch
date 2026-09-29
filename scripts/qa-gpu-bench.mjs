#!/usr/bin/env node
// Real-GPU benchmark: headless Chromium on the host GPU (ANGLE/Vulkan), vsync and the frame-rate limit off.
// Usage: node scripts/qa-gpu-bench.mjs [url=http://127.0.0.1:5200/] [WxH=1920x1080] [tiers=low,medium,high,ultra]
// "moving" = a camera-moved event every frame (the volume re-marches and reflections re-render: the worst case).
// "still"  = converged, idle gate off (?idle=0), so this is the cost of re-drawing a converged frame.
import { createRequire } from 'module'; import path from 'path';
const { chromium } = createRequire(path.join(process.cwd(), 'noop.js'))('playwright');
const [url = 'http://127.0.0.1:5200/', size = '1920x1080', tiersArg = 'low,medium,high,ultra'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const b = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
for (const q of tiersArg.split(',')) {
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: Number(process.env.DPR || 1) });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${url}?quality=${q}&idle=0&probe=0&ui=0&mode=photo`);
  await p.waitForFunction('window.app && window.app.ready && window.app.frames > 30', null, { timeout: 180000 });
  const r = await p.evaluate(async () => {
    const app = window.app;
    const gpu = (() => { const gl = app.ctx.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })();
    const measure = (ms, moving) => new Promise((res) => {
      const ts = []; const t0 = performance.now();
      const tick = (t) => { if (moving) app.ctx.events.emit({ type: 'camera-moved' }); ts.push(t); if (t - t0 < ms) requestAnimationFrame(tick); else res(ts); };
      requestAnimationFrame(tick);
    });
    const stats = (ts) => { const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b); const mean = d.reduce((a, b) => a + b, 0) / d.length; return { fps: +(1000 / mean).toFixed(1), meanMs: +mean.toFixed(2), p95Ms: +d[Math.floor(d.length * 0.95)].toFixed(2), n: d.length }; };
    await measure(1500, true); // warm-up
    const moving = stats(await measure(5000, true));
    await new Promise((r) => setTimeout(r, 4000)); // converge
    const still = stats(await measure(4000, false));
    return { gpu, moving, still, drawBuffer: app.ctx.renderer.getDrawingBufferSize(new app.ctx.camera.position.constructor()).toArray?.() };
  });
  console.log(q.padEnd(7), JSON.stringify({ moving: r.moving, still: r.still }), errs.length ? 'ERR ' + errs[0] : '');
  if (q === tiersArg.split(',')[0]) console.log('  gpu:', r.gpu);
  await p.close();
}
await b.close();
