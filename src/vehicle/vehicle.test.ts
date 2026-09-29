// Parity checks between the Blender-built GLB (blender/build_vehicle.py) and the shared layout formulas.
// Reads the exported GLB directly (no WebGL): engine positions, part names, size, no Draco.
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { boosterEngines } from '../core/engine-layout.ts';
import { val } from '../specs.ts';

const GLB = new URL('../../public/models/starship.glb', import.meta.url);

function readGlbJson(): any {
  const buf = readFileSync(GLB);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

describe('starship.glb', () => {
  const json = readGlbJson();
  const nodes: any[] = json.nodes;
  const byName = new Map<string, any>(nodes.map((n) => [n.name, n]));

  it('is uncompressed and under the size budget', () => {
    expect(statSync(GLB).size).toBeLessThan(25e6);
    expect(JSON.stringify(json.extensionsUsed ?? [])).not.toContain('DRACO');
  });

  it('places the 33 booster engines exactly at the engine-layout.ts slots', () => {
    const slots = boosterEngines();
    expect(slots).toHaveLength(33);
    slots.forEach((s, i) => {
      const n = byName.get(`raptor_${String(i).padStart(2, '0')}`);
      expect(n, `raptor_${i}`).toBeTruthy();
      const t = n.translation ?? [0, 0, 0];
      expect(t[0]).toBeCloseTo(s.x, 4);
      expect(t[1]).toBeCloseTo(0, 4);
      expect(t[2]).toBeCloseTo(s.z, 4);
    });
  });

  it('has the named parts the module and hotspots rely on', () => {
    for (const name of [
      'booster_hull', 'booster_skirt', 'hotstage', 'ship_hull', 'ship_nose', 'booster_engines', 'ship_engines',
      'flap_fwd_L', 'flap_fwd_R', 'flap_aft_L', 'flap_aft_R', 'gridfin_0', 'gridfin_1', 'gridfin_2',
    ]) expect(byName.has(name), name).toBe(true);
  });

  it('puts the ship engines on the spec rings at the ship base', () => {
    const rv = val('vehicle.ship.rvac.radius');
    const rs = val('vehicle.ship.rsl.radius');
    const y0 = val('vehicle.booster.length');
    for (let i = 0; i < 3; i++) {
      const v = byName.get(`raptor_rvac_${i}`).translation;
      expect(Math.hypot(v[0], v[2])).toBeCloseTo(rv, 4);
      expect(v[1]).toBeCloseTo(y0, 3);
      const s = byName.get(`raptor_rsl_${i}`).translation;
      expect(Math.hypot(s[0], s[2])).toBeCloseTo(rs, 4);
    }
  });

  it('keeps hull parts at identity transforms so object space = vehicle frame', () => {
    for (const name of ['booster_hull', 'booster_skirt', 'ship_hull', 'ship_nose', 'hotstage', 'gridfin_0', 'flap_aft_L']) {
      const n = byName.get(name);
      expect(n.translation, name).toBeUndefined();
      expect(n.rotation, name).toBeUndefined();
      expect(n.scale, name).toBeUndefined();
    }
  });
});
