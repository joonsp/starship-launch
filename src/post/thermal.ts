// Thermal-camera look: re-colours the false-colour temperature image and draws a burned-in scale bar.
// OWNER: post-processing module.
//
// Every surface, the plume and the volume write sl_thermalRamp(kelvin) (src/shaders/common.glsl) in the
// Thermal view mode. That ramp is a fixed log scale from 240 K to 3500 K, so the whole ambient scene
// (sky ~230 K, water ~288 K, ground ~300 K, steam ~330 K) lands in its bottom 10 %: an unreadable purple.
// A real thermal camera spreads its palette over the temperatures that are actually in the frame
// (automatic gain control / histogram equalisation). This stage does the same with a FIXED curve so the
// still stays deterministic:
//   ramp colour -> s = r + g + b (strictly increasing along the ramp) -> kelvin -> palette position u(K)
//   -> ironbow palette.
// The first two steps invert common.glsl's ramp; the table is built here from a JS twin of it.
// Mixed pixels (thin steam over the ground) have an s between their two ends, so they read as an
// in-between temperature, as a radiometric camera would show them.
//
// The same u(K) and palette draw the legend, so its ticks are honest by construction.
//
// NOTE: the proper fix would be a kelvin (or ramp-index) channel from the scene instead of inverting the
// shared ramp; if sl_thermalRamp changes, update rampRGB() below (a unit test guards the round trip).
import * as THREE from 'three';
import { Effect, BlendFunction } from 'postprocessing';

// ── the scene ramp (JS twin of sl_thermalRamp in src/shaders/common.glsl) ─────────────────────────
export const RAMP_K_MIN = 240;
export const RAMP_K_MAX = 3500;
const RAMP_STOPS: Array<[number, number, number]> = [
  [0.0, 0.0, 0.02], [0.12, 0.0, 0.35], [0.6, 0.02, 0.45], [1.0, 0.3, 0.02], [1.0, 0.85, 0.2], [1.0, 1.0, 1.0],
];

/** sl_thermalRamp(kelvin): linear HDR colour. */
export function rampRGB(kelvin: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, Math.log(Math.max(kelvin, 200) / RAMP_K_MIN) / Math.log(RAMP_K_MAX / RAMP_K_MIN)));
  const i = Math.min(4, Math.floor(x / 0.2));
  const t = (x - i * 0.2) / 0.2;
  const a = RAMP_STOPS[i], b = RAMP_STOPS[i + 1];
  const k = 0.6 + 1.4 * x;
  return [(a[0] + (b[0] - a[0]) * t) * k, (a[1] + (b[1] - a[1]) * t) * k, (a[2] + (b[2] - a[2]) * t) * k];
}

/** Ramp position x (0..1) -> kelvin. */
const xToKelvin = (x: number) => RAMP_K_MIN * Math.pow(RAMP_K_MAX / RAMP_K_MIN, x);
/** The largest s = r + g + b the ramp produces (white-hot x 2). */
export const S_MAX = 6;

// ── the display curve u(K) ("fixed AGC") and the palette ───────────────────────────────────────
/**
 * Palette position for a temperature: piecewise linear in log(kelvin). About 40 % of the palette goes to
 * the 230-320 K of the everyday scene (cold sky, clouds, wet flats ~286 K, water ~291 K, dry mud and concrete
 * ~296 K, sun-warmed gravel ~312 K), so its structure reads; the steam (320-400 K) is magenta and the rest
 * spreads the 400-3500 K of the fire and the plume. Below 200 K (the frost, the LOX and LN2 tanks) is black.
 */
const U_KNOTS: Array<[number, number]> = [
  [200, 0.0], [230, 0.04], [270, 0.1], [285, 0.16], [300, 0.3], [320, 0.4], [400, 0.52], [700, 0.63], [1200, 0.74], [2000, 0.86], [3500, 1.0],
];
export function kelvinToU(kelvin: number): number {
  const lk = Math.log(Math.max(kelvin, 1));
  if (kelvin <= U_KNOTS[0][0]) return 0;
  for (let i = 1; i < U_KNOTS.length; i++) {
    const [k1, u1] = U_KNOTS[i];
    if (kelvin <= k1) {
      const [k0, u0] = U_KNOTS[i - 1];
      return u0 + (u1 - u0) * (lk - Math.log(k0)) / (Math.log(k1) - Math.log(k0));
    }
  }
  return 1;
}

/** Ironbow palette stops (position, display sRGB 0..255). */
const PALETTE: Array<[number, number, number, number]> = [
  [0.0, 4, 2, 14],
  [0.1, 22, 8, 72],
  [0.22, 66, 14, 130],
  [0.34, 128, 22, 146],
  [0.46, 190, 40, 120],
  [0.58, 232, 82, 56],
  [0.7, 250, 140, 20],
  [0.82, 254, 198, 40],
  [0.92, 255, 238, 132],
  [1.0, 255, 255, 240],
];
/** Palette colour (display sRGB, 0..1) at u. */
export function paletteSRGB(u: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, u));
  for (let i = 1; i < PALETTE.length; i++) {
    if (x <= PALETTE[i][0]) {
      const a = PALETTE[i - 1], b = PALETTE[i];
      const t = (x - a[0]) / (b[0] - a[0]);
      // smooth within each segment so the palette has no visible kinks
      const s = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
      return [(a[1] + (b[1] - a[1]) * s) / 255, (a[2] + (b[2] - a[2]) * s) / 255, (a[3] + (b[3] - a[3]) * s) / 255];
    }
  }
  const l = PALETTE[PALETTE.length - 1];
  return [l[1] / 255, l[2] / 255, l[3] / 255];
}

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

/** Table index t = sqrt(s / S_MAX) (more entries for the cool end, where the scene lives). */
export const TABLE_SIZE = 1024;

/** Inverse of s(x) along the ramp: kelvin for a given s = r + g + b. */
export function kelvinFromS(s: number): number {
  // bisection on x: s(x) is strictly increasing
  let lo = 0, hi = 1;
  const sOf = (x: number) => { const c = rampRGB(xToKelvin(x)); return c[0] + c[1] + c[2]; };
  if (s <= sOf(0)) return RAMP_K_MIN;
  if (s >= sOf(1)) return RAMP_K_MAX;
  for (let i = 0; i < 40; i++) {
    const m = 0.5 * (lo + hi);
    if (sOf(m) < s) lo = m; else hi = m;
  }
  return xToKelvin(0.5 * (lo + hi));
}

/** 1D table t -> linear RGB of the palette at u(kelvin(s)). */
function buildTable(): THREE.DataTexture {
  const data = new Uint16Array(TABLE_SIZE * 4);
  const H = THREE.DataUtils.toHalfFloat;
  // below the ramp's floor (it clamps at 200 K and its x = 0 end is 240 K) fade towards black
  const floorS = rampRGB(RAMP_K_MIN).reduce((a, b) => a + b, 0);
  for (let i = 0; i < TABLE_SIZE; i++) {
    const t = i / (TABLE_SIZE - 1);
    const s = t * t * S_MAX;
    const u = s < floorS ? kelvinToU(RAMP_K_MIN) * (s / floorS) : kelvinToU(kelvinFromS(s));
    const c = paletteSRGB(u).map(srgbToLinear);
    data[i * 4] = H(c[0]); data[i * 4 + 1] = H(c[1]); data[i * 4 + 2] = H(c[2]); data[i * 4 + 3] = H(1);
  }
  const tex = new THREE.DataTexture(data, TABLE_SIZE, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.name = 'post.thermalTable';
  return tex;
}

const THERMAL_FRAG = /* glsl */ `
uniform sampler2D tThermal;
uniform float uSMax;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float s = max(inputColor.r, 0.0) + max(inputColor.g, 0.0) + max(inputColor.b, 0.0);
  float t = sqrt(clamp(s / uSMax, 0.0, 1.0));
  float n = ${TABLE_SIZE.toFixed(1)};
  vec3 c = texture2D(tThermal, vec2((t * (n - 1.0) + 0.5) / n, 0.5)).rgb;
  outputColor = vec4(c, inputColor.a);
}
`;

/**
 * Linear HDR ramp colour in -> linear display colour of the thermal palette out. Runs in the main post
 * pass right after exposure (the preset bypasses AgX and the LUT). Its blend opacity is 0 outside the
 * thermal preset, so it costs one texture fetch there.
 */
export class ThermalEffect extends Effect {
  private table: THREE.DataTexture;
  constructor() {
    const table = buildTable();
    super('ThermalEffect', THERMAL_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['tThermal', new THREE.Uniform(table)],
        ['uSMax', new THREE.Uniform(S_MAX)],
      ]),
    });
    this.table = table;
  }
  /** On in the thermal preset only (opacity 0 = pass-through). */
  setActive(on: boolean): void { this.blendMode.opacity.value = on ? 1 : 0; }
  dispose(): void { this.table.dispose(); super.dispose(); }
}

// ── the legend ─────────────────────────────────────────────────────────────────────────────────
/** Temperatures labelled on the scale bar. */
export const LEGEND_TICKS = [250, 290, 330, 400, 700, 1200, 2000, 3500];

/**
 * Draw the scale bar into a canvas (transparent background). `px` = pixels per legend unit (the canvas
 * is drawn at 2x so a 2x export stays sharp). Layout in legend units: 120 x 360.
 */
export function drawLegend(canvas: HTMLCanvasElement | OffscreenCanvas, scale = 2): void {
  const W = 120, Hh = 360;
  canvas.width = W * scale;
  canvas.height = Hh * scale;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!g) return;
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.clearRect(0, 0, W, Hh);
  // backing panel
  g.fillStyle = 'rgba(6, 6, 12, 0.55)';
  roundRect(g, 4, 4, W - 8, Hh - 8, 8);
  g.fill();
  const barX = W - 44, barW = 14, top = 34, bot = Hh - 22;
  // bar: one row per pixel, straight from the palette (same as the image)
  for (let y = top; y < bot; y += 0.5) {
    const u = 1 - (y - top) / (bot - top);
    const c = paletteSRGB(u);
    g.fillStyle = `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
    g.fillRect(barX, y, barW, 0.6);
  }
  g.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  g.lineWidth = 0.75;
  g.strokeRect(barX - 0.5, top - 0.5, barW + 1, bot - top + 1);
  // ticks + labels
  g.font = '500 11px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (const k of LEGEND_TICKS) {
    const y = bot - kelvinToU(k) * (bot - top);
    g.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    g.beginPath(); g.moveTo(barX - 5, y); g.lineTo(barX, y); g.stroke();
    g.fillStyle = 'rgba(255, 255, 255, 0.92)';
    g.fillText(String(k), barX - 8, y);
  }
  g.textAlign = 'center';
  g.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  g.fillStyle = 'rgba(255, 255, 255, 0.92)';
  g.fillText('K', barX + barW / 2, 18);
  g.font = '500 9px ui-sans-serif, system-ui, sans-serif';
  g.fillStyle = 'rgba(255, 255, 255, 0.6)';
  g.textAlign = 'left';
  g.fillText('IR', 14, 18);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Legend texture (null outside a DOM, e.g. in unit tests). */
export function createLegendTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  drawLegend(canvas, 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;   // composited as display values in the finish pass
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.name = 'post.thermalLegend';
  return tex;
}
