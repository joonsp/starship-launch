// Shared onBeforeCompile hook for every lit MeshStandardMaterial / MeshPhysicalMaterial.
// OWNER: orchestrator. MANDATORY for all lit materials in the scene (vehicle, pad, terrain, etc.).
//
// What it injects:
//  - the plume as a LINE LIGHT (globals.uPlumeLight along uPlumeAxisA→B) through three's own
//    RE_Direct path, so it gets correct diffuse + GGX specular. Nobody adds point lights for the
//    plume; the plume module only sets globals.uPlumeLight / axis.
//  - ViewMode.Clay: albedo → 0.7 grey, metalness 0, roughness 0.85 (textures/detail ignored).
//  - ViewMode.Thermal: output = sl_thermalRamp(kelvin), where kelvin = opts.kelvin (default 290 K)
//    or the GLSL expression opts.kelvinExpr, plus automatic plume heating by proximity.
//  - Aerial perspective fog (globals.uFogColor / uFogDensity) in Photo mode.
//  - varyings available to kelvinExpr and to your own chained code:
//      vec3 vSlWorldPos  (world position), vec3 vSlObjPos (object-space `transformed`)
//
// Chaining: set your own material.onBeforeCompile FIRST, then call applyGlobals(); the hook
// calls yours first, then its own injections. Your code must keep the standard
// `#include <...>` lines intact (append after them, never delete them), because this hook
// anchors on: <common>, <worldpos_vertex>, <color_fragment>, <metalnessmap_fragment>,
// <lights_fragment_end>, <opaque_fragment>.
// NOTE: material.clone() does NOT copy onBeforeCompile; call applyGlobals() on clones again.
import * as THREE from 'three';
import type { Globals } from '../contracts.ts';
import common from '../shaders/common.glsl?raw';

export interface GlobalsHookOptions {
  /** Constant surface temperature for the thermal view (kelvin). Default 290. */
  kelvin?: number;
  /** GLSL float expression for the surface temperature (may use vSlWorldPos, vSlObjPos, vUv if present). Overrides `kelvin`. */
  kelvinExpr?: string;
  /** Apply the plume line light (default true). */
  plumeLight?: boolean;
  /** Apply aerial-perspective fog (default true). */
  fog?: boolean;
  /** Add automatic plume-proximity heating in the thermal view (default true). */
  plumeHeat?: boolean;
  /** Extra cache key when kelvinExpr/your chained code varies per material. */
  cacheKey?: string;
}

export function applyGlobals<T extends THREE.MeshStandardMaterial>(material: T, globals: Globals, opts: GlobalsHookOptions = {}): T {
  const prev = material.onBeforeCompile?.bind(material);
  const prevKey = material.customProgramCacheKey?.bind(material);
  const kelvinExpr = opts.kelvinExpr ?? `${(opts.kelvin ?? 290).toFixed(1)}`;
  const plume = opts.plumeLight !== false;
  const fog = opts.fog !== false;
  const heat = opts.plumeHeat !== false;

  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    Object.assign(shader.uniforms, {
      uViewMode: globals.uViewMode,
      uPlumeLight: globals.uPlumeLight,
      uPlumeAxisA: globals.uPlumeAxisA,
      uPlumeAxisB: globals.uPlumeAxisB,
      uFogColor: globals.uFogColor,
      uFogDensity: globals.uFogDensity,
      uSlTime: globals.uTime,
      uSlDrift: globals.uDrift,
    });

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vSlWorldPos;\nvarying vec3 vSlObjPos;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  {
    vec4 slwp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      slwp = instanceMatrix * slwp;
    #endif
    vSlWorldPos = (modelMatrix * slwp).xyz;
    vSlObjPos = transformed;
  }`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vSlWorldPos;
varying vec3 vSlObjPos;
uniform int uViewMode;
uniform vec3 uPlumeLight;
uniform vec3 uPlumeAxisA;
uniform vec3 uPlumeAxisB;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uSlTime;
uniform float uSlDrift;
${common}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  if (uViewMode == VIEW_CLAY) diffuseColor.rgb = vec3(0.7);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
  if (uViewMode == VIEW_CLAY) { metalnessFactor = 0.0; roughnessFactor = 0.85; }`)
      .replace('#include <lights_fragment_end>', `${plume ? `
  {
    // Plume line light, integrated with 3 samples along segment A-B (view space). A single
    // closest-point sample leaves horizontal ground unlit (N.L ~ 0), so we sample the column.
    vec3 slA = (viewMatrix * vec4(uPlumeAxisA, 1.0)).xyz;
    vec3 slB = (viewMatrix * vec4(uPlumeAxisB, 1.0)).xyz;
    vec3 slWA = uPlumeAxisA, slWB = uPlumeAxisB;
    for (int slI = 0; slI < 3; slI++) {
      float slT = (float(slI) + 0.5) / 3.0;
      vec3 slQ = mix(slA, slB, slT);
      vec3 slWQ = mix(slWA, slWB, slT);
      vec3 slD = slWQ - vSlWorldPos;
      float slFall = mix(0.8, 1.6, slT) * 3333.3 / (dot(slD, slD) + 36.0); // each sample carries 1/3 of the line
      IncidentLight slLight;
      slLight.direction = normalize(slQ - geometryPosition);
      slLight.color = uPlumeLight * slFall;
      slLight.visible = true;
      RE_Direct(slLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    }
  }` : ''}
#include <lights_fragment_end>`)
      .replace('#include <opaque_fragment>', `
  if (uViewMode == VIEW_THERMAL) {
    float slK = (${kelvinExpr});
    ${heat ? 'slK += 30.0 * min(sl_plumeLineFalloff(vSlWorldPos, uPlumeAxisA, uPlumeAxisB, 6.0), 60.0);' : ''}
    outgoingLight = sl_thermalRamp(slK);
  }${fog ? `
  else {
    outgoingLight = sl_applyFog(outgoingLight, length(vViewPosition), uFogColor, uFogDensity);
  }` : ''}
#include <opaque_fragment>`);
  };

  material.customProgramCacheKey = () =>
    `slg|${prevKey ? prevKey() : ''}|${kelvinExpr}|${plume}|${fog}|${heat}|${opts.cacheKey ?? ''}`;
  material.needsUpdate = true;
  return material;
}
