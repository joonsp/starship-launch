#!/usr/bin/env node
// Quantitative look check: render the real app in the calibrated photo view at the reference
// resolution (1677x943), wait for convergence, then compare the display-referred colour at every
// research/palette.json swatch (13x13 mean) against research/reference.jpeg.
// OWNER: orchestrator. Usage:
//   node scripts/qa-palette.mjs [url=http://127.0.0.1:5210/] [outDir=out/palette] [extraQuery]
// e.g. node scripts/qa-palette.mjs http://127.0.0.1:5211/ out/palette-volume "quality=medium"
// Prints per-swatch dRGB (render - reference), a per-role summary, and writes
// <outDir>/render.png, <outDir>/cmp.png (side by side), <outDir>/blend.png, <outDir>/report.json.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const [url = 'http://127.0.0.1:5210/', outDir = 'out/palette', extra = ''] = process.argv.slice(2);
const require = createRequire(path.join(process.cwd(), 'noop.js'));
const { chromium } = require('playwright');
const ROOT = process.cwd();
const REF = path.join(ROOT, 'research/reference.jpeg');
const pal = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/palette.json'), 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

const q = `mode=photo&ui=0&probe=0${extra ? '&' + extra : ''}`;
const full = url + (url.includes('?') ? '&' : '?') + q;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1677, height: 943 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(full, { waitUntil: 'load' });
await page.waitForFunction('window.app && window.app.ready && window.app.frames > 10', null, { timeout: 900000 });
// let progressive accumulation converge (volume stops marching after ~128 still frames)
const target = Number(process.env.CONVERGE_FRAMES || 150);
await page.waitForFunction(`window.app.frames > ${target}`, null, { timeout: 900000 }).catch(() => logs.push('converge timeout'));
await page.waitForTimeout(500);
const shot = path.join(outDir, 'render.png');
await page.screenshot({ path: shot });
await browser.close();

function mean(img, x, y, r = 6) {
  const out = execFileSync('magick', [img, '-crop', `${2 * r + 1}x${2 * r + 1}+${x - r}+${y - r}`, '+repage', '-scale', '1x1!', '-format', '%[fx:int(255*r+.5)] %[fx:int(255*g+.5)] %[fx:int(255*b+.5)]', 'info:']).toString().trim();
  return out.split(/\s+/).map(Number);
}
const rows = [];
for (const s of pal.swatches) {
  const [x, y] = s.px;
  const ref = mean(REF, x, y), ren = mean(shot, x, y);
  rows.push({ name: s.name, role: s.role, px: s.px, ref, ren, d: ren.map((v, i) => v - ref[i]) });
}
const byRole = {};
for (const r of rows) (byRole[r.role] ??= []).push(r);
console.log('swatch'.padEnd(34), 'role'.padEnd(10), 'ref'.padEnd(14), 'render'.padEnd(14), 'dR dG dB');
for (const r of rows) console.log(r.name.padEnd(34), r.role.padEnd(10), r.ref.join(',').padEnd(14), r.ren.join(',').padEnd(14), r.d.map((v) => (v >= 0 ? '+' : '') + v).join(' '));
console.log('\nper-role mean dRGB and mean |d|:');
let tot = 0, n = 0;
for (const [role, rs] of Object.entries(byRole)) {
  const m = [0, 1, 2].map((i) => Math.round(rs.reduce((a, r) => a + r.d[i], 0) / rs.length));
  const abs = rs.reduce((a, r) => a + (Math.abs(r.d[0]) + Math.abs(r.d[1]) + Math.abs(r.d[2])) / 3, 0) / rs.length;
  tot += abs * rs.length; n += rs.length;
  console.log(' ', role.padEnd(10), `n=${rs.length}`.padEnd(6), `mean d=(${m.join(', ')})`.padEnd(26), `mean|d|=${abs.toFixed(1)}`);
}
console.log(`\nOVERALL mean |d| = ${(tot / n).toFixed(1)} (0 = identical; lower is better)`);
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ url: full, overall: tot / n, rows }, null, 1));
execFileSync('magick', [shot, REF, '+append', '-resize', '2560x', path.join(outDir, 'cmp.png')]);
execFileSync('magick', [shot, REF, '-compose', 'blend', '-define', 'compose:args=50', '-composite', path.join(outDir, 'blend.png')]);
console.log('wrote', outDir, '\n' + logs.slice(0, 30).join('\n'));
