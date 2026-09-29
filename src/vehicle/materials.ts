// Procedural PBR materials of the vehicle. OWNER: vehicle module.
//
// All materials are MeshPhysicalMaterial with an onBeforeCompile that computes albedo / roughness /
// metalness / bump / clearcoat per pixel from VEHICLE-FRAME object-space position (vSlObjPos), never from UVs
// (the UVs only give three.js a tangent frame for anisotropy). Then applyGlobals() adds the plume line light,
// fog and the Clay / Thermal view modes. Roles come from the GLB material names (see blender/build_vehicle.py):
//
//   steel_booster  booster hull, hot-stage truss, fins, pins, raceways   frost + steel + soot   (booster.glsl)
//   booster_dark   painted panels / vents                                dark metal            (engine.glsl)
//   steel_ship     ship hull + nose, hinge housings                      tiles + brushed steel (ship.glsl)
//   ship_dark      ship panels                                           dark metal
//   flap           the four flaps                                        tiles on the belly face (ship.glsl)
//   engine_bell    Raptor bells (sea level and RVac variants)            tempered dark bell    (engine.glsl)
//   engine_steel   chambers, pumps, plumbing                             bright stainless
//   engine_dark    gimbal actuators, flanges                             dark metal
//
// Detail fades by pixel footprint (fwidth of the object-space position, NaN-guarded), so the 200 px
// vehicle of the photo view is shimmer free while a 5 m close-up resolves individual tiles and crystals.
import * as THREE from 'three';
import type { Globals, QualityId, QualitySettings } from '../contracts.ts';
import { applyGlobals } from '../core/material-hooks.ts';
import { val } from '../specs.ts';
import commonGlsl from './glsl/common.glsl?raw';
import boosterGlsl from './glsl/booster.glsl?raw';
import shipGlsl from './glsl/ship.glsl?raw';
import engineGlsl from './glsl/engine.glsl?raw';

export type VehicleMaterialRole =
  | 'booster' | 'boosterDark' | 'ship' | 'shipDark' | 'flap' | 'bell' | 'bellRvac' | 'engineSteel' | 'engineDark';

/** fbm octaves per quality tier (the dominant per-pixel cost). */
const OCTAVES: Record<QualityId, number> = { low: 3, medium: 4, high: 5, ultra: 6 };

const f = (x: number) => x.toFixed(4);

/** Constants shared with the Blender model, straight from the spec. */
function specDefines(): string {
  return [
    `#define VH_SKIRT_TOP ${f(val('vehicle.booster.lox_tank_bottom_height'))}`,
    `#define VH_FROST_Y ${f(val('vehicle.photo.frost_boundary_height'))}`,
    `#define VH_TANK_TOP ${f(val('vehicle.booster.ch4_tank_top_height'))}`,
    `#define VH_SHIP_Y0 ${f(val('vehicle.booster.length'))}`,
    `#define VH_NOSE_Y0 ${f(val('vehicle.ship.nose.base_height'))}`,
    `#define VH_TILE ${f(val('vehicle.ship.tile.hex_size'))}`,
    `#define VH_TILE_GAP ${f(val('vehicle.ship.tile.gap'))}`,
    `#define VH_TILE_EDGE_PHI 1.7500`,   // windward half + a bit: |phi| < 100 deg from the belly
    `#define VH_TILE_Y0 3.8000`,          // tiles start above the aft skirt
    `#define VH_SKIRT_Y 3.4000`,          // ship skirt height (ship-relative)
  ].join('\n');
}

interface Recipe {
  fn: string;                 // GLSL function name
  glsl: string;               // source with that function
  signature: 'booster' | 'ship' | 'simple';
  extraDefines?: string;
  cc?: boolean;
  /** Share of the hook's automatic plume heating (+30 K x falloff) kept in the Thermal view. The engines carry their
   *  own 900-1400 K figures and the frost must stay cold, so the hook's proximity heating is cancelled in kelvinExpr. */
  plumeHeat: number;
}

const RECIPES: Record<VehicleMaterialRole, Recipe> = {
  booster: { fn: 'vhBooster', glsl: boosterGlsl, signature: 'booster', plumeHeat: 0.2 },
  boosterDark: { fn: 'vhDarkMetal', glsl: engineGlsl, signature: 'simple', plumeHeat: 0.2 },
  ship: { fn: 'vhShip', glsl: shipGlsl, signature: 'ship', cc: true, plumeHeat: 1 },
  shipDark: { fn: 'vhDarkMetal', glsl: engineGlsl, signature: 'simple', plumeHeat: 1 },
  flap: { fn: 'vhFlap', glsl: shipGlsl, signature: 'ship', cc: true, plumeHeat: 1 },
  bell: { fn: 'vhBell', glsl: engineGlsl, signature: 'simple', extraDefines: '#define VH_EXIT_Y -0.6000', plumeHeat: 0 },
  bellRvac: { fn: 'vhBell', glsl: engineGlsl, signature: 'simple', extraDefines: '#define VH_EXIT_Y -1.5000', plumeHeat: 0 },
  engineSteel: { fn: 'vhEngineSteel', glsl: engineGlsl, signature: 'simple', plumeHeat: 0 },
  engineDark: { fn: 'vhDarkMetal', glsl: engineGlsl, signature: 'simple', plumeHeat: 0 },
};

/** GLSL call site that fills the per-pixel `vh*` variables. Runs after <color_fragment>. */
function callSite(r: Recipe): string {
  const decl = `
  float vhK = 290.0, vhH = 0.0, vhRough = -1.0, vhMetal = -1.0, vhTile = 0.0, vhCC = 0.0, vhCCR = 0.3, vhFrost = 0.0;
  if (uViewMode != VIEW_CLAY) {
    vhInitFootprint(vSlObjPos);
    vec3 vhAlb = vec3(0.5); float vhR = 0.5, vhM = 1.0;`;
  let call = '';
  switch (r.signature) {
    case 'booster':
      call = `${r.fn}(vSlObjPos, vSlObjNrm, vhAlb, vhR, vhM, vhH, vhK, vhFrost);`;
      break;
    case 'ship':
      call = `${r.fn}(vSlObjPos, vSlObjNrm, vhAlb, vhR, vhM, vhH, vhK, vhTile, vhCC, vhCCR);`;
      break;
    default:
      call = `${r.fn}(vSlObjPos, vSlObjNrm, vhAlb, vhR, vhM, vhH, vhK);`;
  }
  return `${decl}
    ${call}
    diffuseColor.rgb = vhAlb; vhRough = vhR; vhMetal = vhM;
  }`;
}

/**
 * The launch cloud as part of the vehicle's environment light.
 *
 * Core's PMREM environment is the open sky over bare ground. At T+7 s the stack stands inside the launch cloud:
 * the banks on both sides hide much of the bright horizon sky from the hull, and their sunlit faces send warm
 * light back. Without this the frost's shaded side is lit by an unobstructed blue horizon (2-3x brighter and
 * much bluer than in the photo) and the warm sun barely shows against it.
 *   skyDiffuse   share of the sky's diffuse light that reaches sideways / downward normals (up-facing normals
 *                still see the open zenith)
 *   skySpecular  share of the sky's specular reflection for the same normals
 *   steamBounce  warm bounce from the sunlit steam: irradiance = pi x steamBounce x sun (the sunlit bank radiance
 *                ~ 0.35 x sun, seen over ~9 % of the cosine-weighted hemisphere), strongest for downward normals
 * Live: edit `materials.env` and call `applyEnv()`. Not applied in the thermal view.
 */
export const VEHICLE_ENV = { skyDiffuse: 0.45, skySpecular: 0.7, steamBounce: 0.03 };

const LAUNCH_CLOUD_ENV = /* glsl */ `
  if (uViewMode != VIEW_THERMAL) {
    vec3 vhWN = normalize((vec4(geometryNormal, 0.0) * viewMatrix).xyz);   // world-space normal
    float vhLow = 1.0 - smoothstep(-0.2, 0.9, vhWN.y);                      // 1 sideways / down, 0 up
    iblIrradiance *= mix(1.0, uVhEnv.x, vhLow);
    radiance *= mix(1.0, uVhEnv.y, vhLow);
    irradiance += uVhSun * (3.14159265 * uVhEnv.z * (0.5 - 0.5 * vhWN.y));
  }`;

export class VehicleMaterials {
  readonly byRole = {} as Record<VehicleMaterialRole, THREE.MeshPhysicalMaterial>;
  /** Launch-cloud environment knobs (see VEHICLE_ENV); call applyEnv() after editing. */
  readonly env = { ...VEHICLE_ENV };
  private readonly envUniform = new THREE.Uniform(new THREE.Vector3());
  /** Octave count (uVhOct), shared by every vehicle program: a uniform so a quality switch does not recompile. */
  private readonly octUniform = new THREE.Uniform(OCTAVES.high);

  constructor(private globals: Globals, quality: QualitySettings) {
    this.applyEnv();
    this.octUniform.value = OCTAVES[quality.id];
    for (const role of Object.keys(RECIPES) as VehicleMaterialRole[]) this.byRole[role] = this.make(role);
  }

  /** Map a GLB material name (+ ancestor hint for the RVac bell) to a material. */
  forGlb(name: string, isRvac: boolean): THREE.MeshPhysicalMaterial {
    switch (name) {
      case 'steel_booster': return this.byRole.booster;
      case 'booster_dark': return this.byRole.boosterDark;
      case 'steel_ship': return this.byRole.ship;
      case 'ship_dark': return this.byRole.shipDark;
      case 'flap': return this.byRole.flap;
      case 'engine_bell': return isRvac ? this.byRole.bellRvac : this.byRole.bell;
      case 'engine_steel': return this.byRole.engineSteel;
      case 'engine_dark': return this.byRole.engineDark;
      default: return this.byRole.boosterDark;
    }
  }

  applyEnv(): void {
    this.envUniform.value.set(this.env.skyDiffuse, this.env.skySpecular, this.env.steamBounce);
  }

  setQuality(q: QualitySettings): void {
    this.octUniform.value = OCTAVES[q.id];
  }

  dispose(): void {
    for (const m of Object.values(this.byRole)) m.dispose();
  }

  private make(role: VehicleMaterialRole): THREE.MeshPhysicalMaterial {
    const r = RECIPES[role];
    const m = new THREE.MeshPhysicalMaterial({
      name: `vehicle_${role}`,
      color: 0xffffff,
      metalness: 1.0,
      roughness: 0.4,
      envMapIntensity: 1.0,
    });
    if (r.cc) {
      m.clearcoat = 1.0;
      m.clearcoatRoughness = 0.25;
      m.anisotropy = 0.55;          // brushed stainless streaks along the circumference (UV u direction)
      m.anisotropyRotation = 0.0;
    }
    const self = this;
    const shaderSrc = commonGlsl + '\n' + r.glsl;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uVhEnv = self.envUniform;
      shader.uniforms.uVhOct = self.octUniform;
      shader.uniforms.uVhSun = self.globals.uSunColor;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSlObjNrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSlObjNrm = objectNormal;');
      const header = `${specDefines()}\n#define VH_OCT_MAX 6\nuniform float uVhOct;\n${r.extraDefines ?? ''}\nuniform vec3 uVhEnv;\nuniform vec3 uVhSun;\n`;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vSlObjNrm;\n${header}${shaderSrc}`)
        .replace('#include <lights_fragment_end>', `${LAUNCH_CLOUD_ENV}\n#include <lights_fragment_end>`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${callSite(r)}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n  if (vhRough >= 0.0) roughnessFactor = vhRough;`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n  if (vhMetal >= 0.0) metalnessFactor = vhMetal;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n  if (uViewMode != VIEW_CLAY) normal = vhPerturb(-vViewPosition, normal, vhH, faceDirection);`)
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
  #ifdef USE_CLEARCOAT
    if (uViewMode != VIEW_CLAY) {
      material.clearcoat = saturate(vhCC);
      material.clearcoatRoughness = min(max(vhCCR, 0.0525) + geometryRoughness, 1.0);
    }
  #endif
  #ifdef USE_ANISOTROPY
    material.alphaT = mix(pow2(material.roughness), 1.0, pow2(material.anisotropy * (1.0 - vhTile)));
  #endif`);
    };
    m.customProgramCacheKey = () => `vehicle:${role}`;
    // thermal: `vhK` is declared by the call site above in main() scope, so the hook can read it.
    const cancel = 30.0 * (1.0 - r.plumeHeat);
    const kelvinExpr = cancel > 0
      ? `vhK - ${cancel.toFixed(2)} * min(sl_plumeLineFalloff(vSlWorldPos, uPlumeAxisA, uPlumeAxisB, 6.0), 60.0)`
      : 'vhK';
    applyGlobals(m, this.globals, { kelvinExpr, cacheKey: role });
    return m;
  }
}
