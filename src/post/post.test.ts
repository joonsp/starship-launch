// Unit tests for the parts of the post module that need no GPU. OWNER: post-processing module.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { AppContext, AppEvent } from '../contracts.ts';
import { ViewMode } from '../contracts.ts';
import { createEmitter, createGlobals } from '../core/context.ts';
import { PHOTO_PRESET } from '../scene-config.ts';
import { PRESETS, PRESET_ORDER, POST_TUNING, PRESET_LOOKS, applyPresetToGlobals, nextPreset } from './presets.ts';
import { applyPhotoLook, whiteBalanceGains } from './grade.ts';
import { LEGEND_TICKS, RAMP_K_MAX, RAMP_K_MIN, kelvinFromS, kelvinToU, paletteSRGB, rampRGB } from './thermal.ts';
import { stillFilename } from './export.ts';
import { PHOTO_SWATCH_RADIANCE } from './targets.ts';

function stubCtx(): { ctx: AppContext; events: AppEvent[] } {
  const events: AppEvent[] = [];
  const emitter = createEmitter();
  const ctx = { globals: createGlobals(), preset: PHOTO_PRESET, events: { on: emitter.on, emit: (e: AppEvent) => { events.push(e); emitter.emit(e); } } } as unknown as AppContext;
  return { ctx, events };
}

describe('presets', () => {
  it('has every preset in order, keyed by its own id, with EN and FI labels and post tuning', () => {
    expect([...PRESET_ORDER].sort()).toEqual(Object.keys(PRESETS).sort());
    for (const id of PRESET_ORDER) {
      expect(PRESETS[id].id).toBe(id);
      expect(PRESETS[id].label.en.length).toBeGreaterThan(0);
      expect(PRESETS[id].label.fi.length).toBeGreaterThan(0);
      expect(POST_TUNING[id]).toBeDefined();
    }
    expect(PRESETS.photo).toBe(PHOTO_PRESET);
  });
  it('cycles with wrap-around in both directions', () => {
    expect(nextPreset('photo')).toBe('noon');
    expect(nextPreset('clay')).toBe('photo');
    expect(nextPreset('photo', -1)).toBe('clay');
  });
  it('noon sun is ~65 deg up, night sun is below the horizon and switched off', () => {
    expect(Math.asin(PRESETS.noon.sun.dir.y) * 180 / Math.PI).toBeCloseTo(65, 0);
    expect(Math.asin(PRESETS.night.sun.dir.y) * 180 / Math.PI).toBeCloseTo(-15, 0);
    expect(PRESETS.night.sun.intensity).toBe(0);
    expect(PRESETS.night.plumeLightScale).toBeGreaterThan(1);
    expect(PRESETS.night.exposure).toBeGreaterThan(1);
    expect(PRESETS.thermal.viewMode).toBe(ViewMode.Thermal);
    expect(PRESETS.clay.viewMode).toBe(ViewMode.Clay);
  });
  it('photo sun is a warm low-sun key (R > G > B, about 1 : 0.6 : 0.3) and every preset has a look', () => {
    const s = PHOTO_PRESET.sun.color;
    expect(s.r).toBeGreaterThan(s.g);
    expect(s.g).toBeGreaterThan(s.b);
    expect(s.b / s.r).toBeLessThan(0.4);
    for (const id of PRESET_ORDER) expect(PRESET_LOOKS[id]).toBeDefined();
    // clay: a raised, near-white sun and a near-monochrome grade
    expect(Math.asin(PRESETS.clay.sun.dir.y) * 180 / Math.PI).toBeGreaterThan(20);
    expect(PRESETS.clay.grade.saturation).toBeLessThan(0.5);
    // thermal: no bloom (it would read as false heat) and no tone mapping
    expect(POST_TUNING.thermal.bloomIntensity).toBe(0);
    expect(POST_TUNING.thermal.toneMap).toBe(false);
  });
  it('applyPresetToGlobals writes the globals and emits the preset event', () => {
    const { ctx, events } = stubCtx();
    applyPresetToGlobals(ctx, PRESETS.noon);
    const g = ctx.globals;
    expect(g.uSunDir.value.length()).toBeCloseTo(1, 5);
    expect(g.uSunColor.value.r).toBeCloseTo(PRESETS.noon.sun.color.r * PRESETS.noon.sun.intensity, 5);
    expect(g.uSkyAmbient.value.b).toBeCloseTo(PRESETS.noon.ambient.sky.b * PRESETS.noon.ambient.intensity, 5);
    expect(g.uFogDensity.value).toBe(PRESETS.noon.fog.density);
    expect(g.uViewMode.value).toBe(ViewMode.Photo);
    expect(ctx.preset).toBe(PRESETS.noon);
    expect(events.some((e) => e.type === 'preset' && e.preset === PRESETS.noon)).toBe(true);
    applyPresetToGlobals(ctx, PRESETS.thermal);
    expect(g.uViewMode.value).toBe(ViewMode.Thermal);
  });
});

describe('grade', () => {
  it('white balance gains keep luminance and warm/cool in the right direction', () => {
    const warm = whiteBalanceGains(0.5, 0);
    expect(warm.x).toBeGreaterThan(warm.z);
    expect(0.2126 * warm.x + 0.7152 * warm.y + 0.0722 * warm.z).toBeCloseTo(1, 5);
    const cool = whiteBalanceGains(-0.5, 0);
    expect(cool.z).toBeGreaterThan(cool.x);
    const magenta = whiteBalanceGains(0, 0.5);
    expect(magenta.y).toBeLessThan(magenta.x);
    const n = whiteBalanceGains(0, 0);
    expect([n.x, n.y, n.z].every((v) => Math.abs(v - 1) < 1e-9)).toBe(true);
  });
  it('photo look lifts blacks, keeps whites, stays in gamut and is monotone on greys', () => {
    const black = applyPhotoLook([0, 0, 0]);
    expect(Math.max(...black)).toBeGreaterThan(0.02);
    expect(Math.max(...black)).toBeLessThan(0.09);
    const white = applyPhotoLook([1, 1, 1]);
    expect(Math.min(...white)).toBeGreaterThan(0.95);
    let prev = -1;
    for (let i = 0; i <= 32; i++) {
      const v = i / 32;
      const o = applyPhotoLook([v, v, v]);
      for (const c of o) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
      const l = 0.2126 * o[0] + 0.7152 * o[1] + 0.0722 * o[2];
      expect(l).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = l;
    }
  });
  it('photo look never desaturates the cerulean sky and warms the highlights', () => {
    const sky = applyPhotoLook([18 / 255, 126 / 255, 190 / 255]);
    const sat = (c: number[]) => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
    expect(sat(sky)).toBeGreaterThanOrEqual(sat([18 / 255, 126 / 255, 190 / 255]) - 0.02);
    const cream = applyPhotoLook([0.9, 0.9, 0.9]);
    expect(cream[0] - cream[2]).toBeGreaterThan(0.01);
  });
});

describe('thermal', () => {
  it('matches sl_thermalRamp in common.glsl at known points', () => {
    const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 3));
    near(rampRGB(200), [0, 0, 0.012]);
    near(rampRGB(3500), [2, 2, 2]);
    near(rampRGB(300), [0.0358, 0, 0.1128]);
  });
  it('inverts the ramp (s = r + g + b) back to kelvin', () => {
    for (const k of [250, 290, 330, 500, 1000, 2000, 3400]) {
      const c = rampRGB(k);
      expect(kelvinFromS(c[0] + c[1] + c[2]) / k).toBeCloseTo(1, 2);
    }
    expect(kelvinFromS(0)).toBe(RAMP_K_MIN);
    expect(kelvinFromS(99)).toBe(RAMP_K_MAX);
  });
  it('has a monotone display curve and a palette that brightens with temperature', () => {
    let prevU = -1, prevL = -1;
    for (let k = 150; k <= 3600; k += 10) {
      const u = kelvinToU(k);
      expect(u).toBeGreaterThanOrEqual(prevU);
      prevU = u;
      const c = paletteSRGB(u);
      const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      expect(l).toBeGreaterThanOrEqual(prevL - 1e-3);
      prevL = l;
    }
    expect(kelvinToU(200)).toBe(0);
    expect(kelvinToU(3500)).toBeCloseTo(1, 6);
    // the everyday scene (water 288 K .. steam 340 K) gets a readable share of the palette
    expect(kelvinToU(340) - kelvinToU(285)).toBeGreaterThan(0.2);
    for (let i = 1; i < LEGEND_TICKS.length; i++) expect(kelvinToU(LEGEND_TICKS[i])).toBeGreaterThan(kelvinToU(LEGEND_TICKS[i - 1]));
  });
});

describe('export and targets', () => {
  it('names the still after the flight, the freeze time and the preset', () => {
    expect(stillFilename('photo')).toBe('starship-flight14-T+7.2s-photo.png');
    expect(stillFilename('night')).toBe('starship-flight14-T+7.2s-night.png');
  });
  it('has finite, positive radiance targets', () => {
    const list = Object.values(PHOTO_SWATCH_RADIANCE);
    expect(list.length).toBeGreaterThan(40);
    for (const s of list) for (const v of s.linear) { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThan(0); }
    void THREE;
  });
});
