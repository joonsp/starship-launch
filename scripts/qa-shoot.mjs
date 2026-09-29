#!/usr/bin/env node
// Headless QA screenshots of the full app (copy of scripts/shoot.mjs with a configurable ready timeout,
// because the full app bakes sky + clouds on load and SwiftShader is slow). OWNER: integrator.
// Extra env: QA_TIMEOUT=ms (default 600000).
//
// Usage:  node shoot.mjs <steps.json> <outDir> [url=http://127.0.0.1:5173/] [readySelectorJs]
//   steps.json: [["name", "js to evaluate in the page (return value is logged)", waitMs], ...]
//   readySelectorJs (optional): JS expression that becomes truthy once the app has loaded, e.g.
//     "document.querySelector('#loading')?.style.display === 'none'"
// Expose app internals on window (e.g. window.app = {player, viewer, ...}) so steps can drive them.
// Console errors and page errors are printed at the end — always read them.
// Viewport: VIEWPORT=390x844 node shoot.mjs …  (default 1600x950) — check narrow/mobile layouts too.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

function loadPlaywright() {
  const tries = [process.cwd(), path.dirname(new URL(import.meta.url).pathname)];
  try {
    // global install (npm i -g playwright / mise npm:playwright)
    const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
    tries.push(g);
  } catch { /* ignore */ }
  try {
    const bin = execSync('command -v playwright', { encoding: 'utf8', shell: '/bin/bash' }).trim();
    if (bin) tries.push(path.resolve(fs.realpathSync(bin), '../../..'));
  } catch { /* ignore */ }
  for (const base of tries) {
    try { return createRequire(path.join(base, 'noop.js'))('playwright'); } catch { /* next */ }
  }
  throw new Error('playwright not found: npm i -D playwright && npx playwright install chromium');
}

const [stepsFile, outDir, url = 'http://127.0.0.1:5173/', ready] = process.argv.slice(2);
if (!stepsFile || !outDir) { console.error('usage: node shoot.mjs steps.json outDir [url] [readyJs]'); process.exit(2); }
const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const [vw, vh] = (process.env.VIEWPORT || '1600x950').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const logs = [];
const t0 = Date.now();
const live = (l) => { if (process.env.QA_LIVE) console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${l}`); };
page.on('console', (m) => { if (m.type() !== 'debug') { const l = `[${m.type()}] ${m.text()}`; logs.push(l); live(l); } });
page.on('pageerror', (e) => { logs.push(`[pageerror] ${e.message}`); live(`[pageerror] ${e.message}`); });
await page.goto(url, { waitUntil: 'load' });
if (ready) await page.waitForFunction(ready, null, { timeout: Number(process.env.QA_TIMEOUT || 600000), polling: 1000 }).catch(() => logs.push('TIMEOUT waiting for ready condition'));
else await page.waitForTimeout(3000);
for (const [name, js, wait] of steps) {
  try {
    const r = js ? await page.evaluate(js) : undefined;
    if (r !== undefined && r !== null) logs.push(`${name}: ${JSON.stringify(r)}`);
  } catch (e) { logs.push(`${name} ERROR ${e.message}`); }
  await page.waitForTimeout(wait ?? 1000);   // software rendering is slow: give camera tweens time
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log('shot', path.join(outDir, `${name}.png`));
}
console.log(logs.join('\n'));
await browser.close();
