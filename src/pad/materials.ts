// Procedural PBR materials of the launch pad. OWNER: pad module.
//
// The pad GLB has no UVs. Every material derives albedo / roughness / metalness / bump from WORLD position
// (vSlWorldPos, instance aware) or, for the cladding, the tower-local object position (vSlObjPos), then
// applyGlobals() adds the plume line light, fog and the Clay / Thermal view modes. Roles are the GLB material
// names written by blender/build_pad.py:
//
//   tower_paint     weathered rust-red painted lattice, run-off streaks, chipped paint, dust
//   tower_clad      top-house cladding (same paint, 0.2 m corrugation)
//   galv            galvanised stairs, handrails, pipes, brackets
//   grating         bar grating (30 mm bars, 100 mm rods); averages to a mid grey with distance
//   dark_steel      machinery, bolts, cables, catch hardware
//   concrete        footings, sleepers, plinths (stained, cracked)
//   concrete_scorch trench walls and floor: soot, spalling, panel joints; hot in the thermal view
//   apron           the pad slab: 12 m expansion joints, radial soot fan, oil, wash-down sheen
//   stainless       deluge plumbing, trench lining (heat tint near the axis)
//   olm_steel       water-cooled deck plate: weld seams, scorch round the booster opening
//   olm_column      painted grey support steel
//   diverter        heat-blackened double-sided flame diverter
//   tank_lox/ln2/ch4/water/gas   white painted tanks (frost on cryogenic ones); 90 / 77 / 111 / 285 K
//   tank_band, pipe_insul        tank ring bands, insulated propellant lines
//   annex           grey corrugated-panel building round the tower foot (OSM roof polygon)
//   beacon          red aviation lights (emissive)
//
// Detail fades by pixel footprint (fwidth of world position), so the 20 px tower of the photo view has no shimmer
// while a 1.7 m eye-height close-up shows pores, weld seams and grating bars. Frozen: no time dependence at all.
import * as THREE from 'three';
import type { Globals, QualityId, QualitySettings } from '../contracts.ts';
import { applyGlobals } from '../core/material-hooks.ts';
import padGlsl from './glsl/pad.glsl?raw';

export type PadRole =
  | 'tower_paint' | 'tower_clad' | 'galv' | 'grating' | 'dark_steel' | 'beacon' | 'concrete' | 'concrete_scorch'
  | 'apron' | 'stainless' | 'olm_steel' | 'olm_column' | 'diverter' | 'tank_lox' | 'tank_ln2' | 'tank_ch4'
  | 'tank_water' | 'tank_gas' | 'tank_band' | 'pipe_insul' | 'fence_mesh' | 'annex';

/** fbm octaves per quality tier (the dominant per-pixel cost). */
const OCTAVES: Record<QualityId, number> = { low: 3, medium: 4, high: 5, ultra: 6 };

interface Recipe {
  /** GLSL expression evaluating to a PdSurf; may use p (world pos), nW (world normal), op (object pos). */
  call: string;
  /** GLSL float expression for the thermal view (kelvin). */
  kelvin: string;
  /** bump strength multiplier on the height (metres) */
  bump: number;
  /** Share of the hook's automatic plume heating kept in the thermal view. */
  plumeHeat?: number;
  metalness?: number;
  roughness?: number;
}

const RECIPES: Record<Exclude<PadRole, 'beacon'>, Recipe> = {
  tower_paint: { call: 'pdTowerPaint(p, nW)', kelvin: '291.0 + 6.0 * pdNoise(vSlWorldPos * 0.2) + pdKRad(vSlWorldPos)', bump: 3, plumeHeat: 0 },
  tower_clad: { call: 'pdTowerClad(p, nW, op)', kelvin: '292.0 + pdKRad(vSlWorldPos)', bump: 3, plumeHeat: 0 },
  galv: { call: 'pdGalv(p, nW)', kelvin: '290.0 + 8.0 * pdNoise(vSlWorldPos * 0.5) + pdKRad(vSlWorldPos)', bump: 3, plumeHeat: 0 },
  grating: { call: 'pdGrating(pdL(p), pdL(nW))', kelvin: '292.0 + pdKRad(vSlWorldPos)', bump: 2, plumeHeat: 0 },
  dark_steel: { call: 'pdDarkSteel(p, nW)', kelvin: '293.0 + pdKRad(vSlWorldPos)', bump: 3, plumeHeat: 0 },
  concrete: { call: 'pdConcrete(pdL(p), pdL(nW), 0)', kelvin: '292.0 + 6.0 * pdNoise(vSlWorldPos * 0.3) + pdKRad(vSlWorldPos)', bump: 4, plumeHeat: 0 },
  concrete_scorch: { call: 'pdConcrete(pdL(p), pdL(nW), 2)', kelvin: 'pdKTrench(pdL(vSlWorldPos))', bump: 4, plumeHeat: 0 },
  apron: { call: 'pdConcrete(pdL(p), pdL(nW), 1)', kelvin: 'pdKApron(pdL(vSlWorldPos))', bump: 4, plumeHeat: 0 },
  stainless: { call: 'pdStainless(pdL(p), pdL(nW), exp(-abs(pdL(p).x) / 14.0) * smoothstep(0.5, -8.0, p.y), 0.0)', kelvin: 'pdKStainless(pdL(vSlWorldPos))', bump: 2, plumeHeat: 0 },
  olm_steel: { call: 'pdOlmSteel(pdL(p), pdL(nW))', kelvin: 'pdKDeck(pdL(vSlWorldPos))', bump: 3, plumeHeat: 0 },
  olm_column: { call: 'pdOlmColumn(pdL(p), pdL(nW))', kelvin: 'pdKColumn(pdL(vSlWorldPos))', bump: 3, plumeHeat: 0 },
  diverter: { call: 'pdDiverter(pdL(p), pdL(nW))', kelvin: 'pdKDiverter(pdL(vSlWorldPos))', bump: 4, plumeHeat: 0 },
  tank_lox: { call: 'pdTank(p, op, nW, 0.55)', kelvin: '90.0 + 4.0 * pdNoise(vSlWorldPos)', bump: 3, plumeHeat: 0 },
  tank_ln2: { call: 'pdTank(p, op, nW, 0.65)', kelvin: '77.0 + 4.0 * pdNoise(vSlWorldPos)', bump: 3, plumeHeat: 0 },
  tank_ch4: { call: 'pdTank(p, op, nW, 0.25)', kelvin: '111.0 + 4.0 * pdNoise(vSlWorldPos)', bump: 3, plumeHeat: 0 },
  tank_water: { call: 'pdTank(p, op, nW, 0.0)', kelvin: '285.0', bump: 3, plumeHeat: 0 },
  tank_gas: { call: 'pdTank(p, op, nW, 0.0)', kelvin: '288.0', bump: 3, plumeHeat: 0 },
  tank_band: { call: 'pdDarkSteel(p, nW)', kelvin: '250.0', bump: 3, plumeHeat: 0 },
  pipe_insul: { call: 'pdTank(p, op, nW, 0.5)', kelvin: '96.0 + 5.0 * pdNoise(vSlWorldPos * 0.5)', bump: 3, plumeHeat: 0 },
  annex: { call: 'pdAnnex(p, nW)', kelvin: '293.0 + pdKRad(vSlWorldPos)', bump: 3, plumeHeat: 0 },
  fence_mesh: { call: 'pdDarkSteel(p, nW)', kelvin: '292.0', bump: 1 },
};

export class PadMaterials {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  private oct = 5;

  constructor(private globals: Globals, quality: QualitySettings) {
    this.oct = OCTAVES[quality.id];
  }

  /** Material for a GLB material name (see the role table above). Unknown names get a plain grey standard material. */
  forGlb(name: string): THREE.MeshStandardMaterial {
    let m = this.cache.get(name);
    if (m) return m;
    m = this.make(name as PadRole);
    m.name = `pad_${name}`;
    this.cache.set(name, m);
    return m;
  }

  /** Emissive intensity of the aviation beacons (the flash in slow-drift mode). */
  setBeacon(intensity: number): void {
    const b = this.cache.get('beacon');
    if (b) b.emissiveIntensity = intensity;
  }

  setQuality(q: QualitySettings): void {
    const o = OCTAVES[q.id];
    if (o === this.oct) return;
    this.oct = o;
    for (const m of this.cache.values()) m.needsUpdate = true;   // recompile with the new PD_OCT define
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }

  private make(role: PadRole): THREE.MeshStandardMaterial {
    if (role === 'beacon') {
      const m = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: new THREE.Color(1.0, 0.05, 0.02), emissiveIntensity: 6, roughness: 0.4 });
      return applyGlobals(m, this.globals, { kelvin: 330, plumeLight: false });
    }
    const r = RECIPES[role as Exclude<PadRole, 'beacon'>];
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: r?.roughness ?? 0.7, metalness: r?.metalness ?? 0.0 });
    if (!r) return applyGlobals(m, this.globals, { kelvin: 290 });
    const self = this;
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader
        // prelude goes AFTER the hook's own declarations (it appends to <common> first, then we append here)
        .replace('#include <common>', `#include <common>\n#define PD_OCT ${self.oct}\n#define PD_BUMP ${r.bump.toFixed(2)}\n${padGlsl}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  PdSurf pdS; pdS.alb = diffuseColor.rgb; pdS.rough = 0.7; pdS.metal = 0.0; pdS.H = 0.0; pdS.frost = 0.0;
  if (uViewMode != VIEW_CLAY) {
    vec3 p = vSlWorldPos;
    vec3 op = vSlObjPos;
    pdInit(p);
    vec3 nW = normalize(transpose(mat3(viewMatrix)) * normalize(vNormal));
    pdS = ${r.call};
    diffuseColor.rgb = pdS.alb;
  }`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
  if (uViewMode != VIEW_CLAY) { roughnessFactor = pdS.rough; metalnessFactor = pdS.metal; }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  if (uViewMode != VIEW_CLAY) normal = pdBump(-vViewPosition, normal, pdS.H, PD_BUMP);`);
    };
    m.customProgramCacheKey = () => `pad|${role}|${this.oct}`;
    return applyGlobals(m, this.globals, {
      kelvinExpr: r.kelvin,
      plumeHeat: (r.plumeHeat ?? 1) > 0,
      cacheKey: `${role}|${this.oct}`,
    });
  }
}
