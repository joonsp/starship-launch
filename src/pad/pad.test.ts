// Structural checks of the pad build: public/models/pad.glb (from blender/build_pad.py) and public/data/colliders.json.
// Runs headless (no WebGL): the GLB JSON chunk is parsed by hand.
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Collider } from '../contracts.ts';
import { val, vec3 } from '../specs.ts';

const GLB = new URL('../../public/models/pad.glb', import.meta.url);
const COL = new URL('../../public/data/colliders.json', import.meta.url);

interface Gltf {
  nodes: { name?: string; mesh?: number; translation?: number[]; rotation?: number[] }[];
  meshes: { name?: string; primitives: { attributes: Record<string, number>; material?: number }[] }[];
  materials: { name: string }[];
  accessors: { min?: number[]; max?: number[]; count: number }[];
}

function readGltf(): Gltf {
  const b = readFileSync(GLB);
  expect(b.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8')) as Gltf;
}

const ROLES = new Set(['tower_paint', 'tower_clad', 'galv', 'grating', 'dark_steel', 'beacon', 'concrete', 'concrete_scorch',
  'apron', 'stainless', 'olm_steel', 'olm_column', 'diverter', 'tank_lox', 'tank_ln2', 'tank_ch4', 'tank_water', 'tank_gas',
  'tank_band', 'pipe_insul', 'fence_mesh', 'annex']);

describe('pad.glb', () => {
  const g = readGltf();
  const named = (n: string) => g.nodes.filter((x) => x.name === n || x.name?.replace(/[._]?\d+$/, '') === n);
  const meshMaxY = (nodeName: string) => {
    const node = g.nodes.find((x) => x.name === nodeName)!;
    return Math.max(...g.meshes[node.mesh!].primitives.map((p) => g.accessors[p.attributes.POSITION].max![1]));
  };

  it('is under the 30 MB budget and has no UVs', () => {
    expect(statSync(GLB).size).toBeLessThan(30e6);
    for (const m of g.meshes) for (const p of m.primitives) expect(p.attributes.TEXCOORD_0).toBeUndefined();
  });

  it('only uses material roles the materials module knows', () => {
    for (const m of g.materials) expect(ROLES.has(m.name), m.name).toBe(true);
  });

  it('contains the named parts', () => {
    for (const n of ['tower_lattice_a', 'tower_lattice_b', 'tower_lattice_lo', 'tower_top', 'tower_masts', 'chopsticks', 'olm_deck',
      'olm_columns', 'trench', 'diverter', 'apron', 'pipes', 'tower1_lattice', 'tower1_mount']) {
      expect(named(n).length, n).toBeGreaterThan(0);
    }
  });

  it('stacks 22 bays on the tower centre (spec pad.tower2_centre)', () => {
    const [cx, , cz] = vec3('pad.tower2_centre');
    const bays = g.nodes.filter((x) => /^tower_lattice_[ab]/.test(x.name ?? ''));
    expect(bays.length).toBe(22);
    for (const b of bays) {
      expect(b.translation![0]).toBeCloseTo(cx, 3);
      expect(b.translation![2]).toBeCloseTo(cz, 3); // glTF (x, y, z) = three frame
    }
  });

  it('has the lightning masts at the spec tower height and the OLM deck at 20 m', () => {
    const top = g.nodes.find((x) => x.name === 'tower_masts')!;
    const y = (top.translation?.[1] ?? 0) + meshMaxY('tower_masts');
    expect(y).toBeCloseTo(val('pad.tower2_height'), 1);
    expect(meshMaxY('olm_deck')).toBeGreaterThanOrEqual(val('scene.olm_deck_height'));
    expect(meshMaxY('olm_deck')).toBeLessThan(val('scene.olm_deck_height') + 0.6);
    expect(meshMaxY('apron')).toBeCloseTo(0.12, 3);
  });
});

describe('colliders.json', () => {
  const cols = JSON.parse(readFileSync(COL, 'utf8')) as Collider[];

  it('matches the Collider shape with unique ids', () => {
    expect(cols.length).toBeGreaterThan(40);
    expect(new Set(cols.map((c) => c.id)).size).toBe(cols.length);
    for (const c of cols) {
      expect(['box', 'cylinder']).toContain(c.kind);
      expect(c.centre.length).toBe(3);
      c.centre.forEach((v) => expect(Number.isFinite(v)).toBe(true));
      if (c.kind === 'box') {
        expect(c.size!.length).toBe(3);
        c.size!.forEach((v) => expect(v).toBeGreaterThan(0));
      } else {
        expect(c.radius!).toBeGreaterThan(0);
        expect(c.height!).toBeGreaterThan(0);
      }
    }
  });

  it('has the tower legs, mount columns, fence, tanks and Pad 1', () => {
    const ids = cols.map((c) => c.id);
    for (const p of ['tower2_leg_', 'olm_column_', 'trench_fence_', 'tank_h_', 'tank_v_', 'tower1_leg_']) {
      expect(ids.some((i) => i.startsWith(p)), p).toBe(true);
    }
  });
});
