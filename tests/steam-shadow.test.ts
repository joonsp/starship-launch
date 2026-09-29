// Ground shadow of the launch-cloud banks (src/env/steam-shadow.ts): a pure CPU bake, testable without a GL context.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SteamShadow, STEAM_SHADOW_HALF, STEAM_SHADOW_N } from '../src/env/steam-shadow.ts';
import { PHOTO_PRESET } from '../src/scene-config.ts';

const at = (sh: SteamShadow, x: number, z: number): number => {
  const cell = (2 * STEAM_SHADOW_HALF) / STEAM_SHADOW_N;
  const i = Math.floor((x + STEAM_SHADOW_HALF) / cell), j = Math.floor((z + STEAM_SHADOW_HALF) / cell);
  return (sh.texture.image.data as Uint8Array)[j * STEAM_SHADOW_N + i] / 255;
};

describe('steam shadow map', () => {
  it('shades the ground on the lee side of the banks and leaves the rest lit (photo sun, 5.7 deg)', () => {
    const sh = new SteamShadow();
    sh.update(PHOTO_PRESET.sun.dir);
    const d = sh.texture.image.data as Uint8Array;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i++) { if (d[i] < min) min = d[i]; if (d[i] > max) max = d[i]; }
    expect(max).toBe(255);                 // far from the steam: fully lit
    expect(min).toBeLessThan(0.4 * 255);   // under the thick banks: deep shade
    expect(min).toBeGreaterThan(0.05 * 255);   // never black (diffuse transmission)
    // the sun is in the east: a point far east of the pad is lit, and the shade lies to the west of the steam
    expect(at(sh, 3800, 200)).toBeGreaterThan(0.95);
    let shaded = 0;
    for (let x = -1500; x < 0; x += 50) if (at(sh, x, 250) < 0.8) shaded++;
    expect(shaded).toBeGreaterThan(5);
    sh.dispose();
  });
  it('is fully lit when the sun is below the horizon', () => {
    const sh = new SteamShadow();
    sh.update(new THREE.Vector3(0.5, -0.3, 0.1).normalize());
    const d = sh.texture.image.data as Uint8Array;
    expect(d.every((v) => v === 255)).toBe(true);
    sh.dispose();
  });
});
