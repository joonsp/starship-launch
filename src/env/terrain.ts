// Terrain: one huge flat quad (+-40 km) shaded entirely per fragment from the OSM splat masks, tileable noise,
// the planar reflection (tidal pools) and the coastline profile. Built on MeshStandardMaterial so it gets
// core's sun shadows, the PMREM environment and the plume line light for free (applyGlobals is mandatory).
import * as THREE from 'three';
import type { Globals } from '../contracts.ts';
import { applyGlobals } from '../core/material-hooks.ts';
import { HAZE_APPLY, HAZE_DECL } from './haze.ts';
import terrainGlsl from './glsl/terrain.glsl?raw';
import coastGlsl from './glsl/coast.glsl?raw';
import type { SplatSet } from './splat.ts';
import type { SiteData } from './site-data.ts';
import { coastProfile } from './site-data.ts';

export const COAST_N = 1024;
export const COAST_R = 16000;

/** Flame trench opening (the pad module's apron sits above the rest at y ~ 0.12). */
export const TRENCH_HALF_X = 40;
export const TRENCH_HALF_Z = 16;

export interface TerrainTuning {
  poolThreshold: number;   // moisture above which the flats turn to open water (higher = fewer pools)
  poolBias: number;        // extra moisture in the foreground flats south of the pad
  channels: number;        // amount of thin tidal channels
  vegetation: number;      // procedural vegetation patches on the flats
  ripple: number;          // water micro-ripple strength
  sheen: number;           // planar-reflection sheen on wet mud
}

export const DEFAULT_TERRAIN_TUNING: TerrainTuning = { poolThreshold: 0.60, poolBias: 0.15, channels: 1.0, vegetation: 0.0, ripple: 0.15, sheen: 0.55 };

// GLSL pieces injected at the standard three chunk anchors.
const AT_CLIP = /* glsl */`
  float slDist = length(vSlWorldPos - cameraPosition);
  SlSurface slS = slTerrain(vSlWorldPos, slDist);
  float slKelvin = slS.kelvin;
  float slSeaD = slSeaDist(vSlWorldPos.xz);
  if (slSeaD > 0.0 || (abs(vSlWorldPos.x) < ${TRENCH_HALF_X.toFixed(1)} && abs(vSlWorldPos.z) < ${TRENCH_HALF_Z.toFixed(1)})) discard;
`;

const AT_COLOR = /* glsl */`
  {
    vec3 bed = mix(slS.albedo, vec3(0.05, 0.036, 0.026), 0.6) * exp(-vec3(1.5, 2.3, 3.1) * slS.depth * 1.7);
    diffuseColor.rgb = mix(slS.albedo, bed, slS.water);
    if (uViewMode == VIEW_CLAY) diffuseColor.rgb = vec3(0.7);
  }
`;

const AT_ROUGHNESS = /* glsl */`
  roughnessFactor = mix(slS.rough, 0.03, slS.water);
  if (uViewMode == VIEW_CLAY) roughnessFactor = 0.85;
`;

const AT_NORMAL = /* glsl */`
  normal = normalize((viewMatrix * vec4(slS.nW, 0.0)).xyz);
`;

const AT_DEBUG = /* glsl */`
  if (uReflParams.w > 8.5) {
    if (uReflParams.w < 9.5) outgoingLight = totalEmissiveRadiance;
    else if (uReflParams.w < 10.5) outgoingLight = reflectedLight.directDiffuse;
    else if (uReflParams.w < 11.5) outgoingLight = reflectedLight.indirectDiffuse;
    else if (uReflParams.w < 12.5) outgoingLight = reflectedLight.indirectSpecular + reflectedLight.directSpecular;
    else if (uReflParams.w < 13.5) outgoingLight = outgoingLight;
    else outgoingLight = vec3(isnan(outgoingLight.r) ? 1.0 : 0.0, isinf(outgoingLight.r) ? 1.0 : 0.0, min(outgoingLight.r, 1.0));
  } else if (uReflParams.w > 0.5) {
    if (uReflParams.w < 1.5 || uReflParams.w > 3.5) outgoingLight = vec3(slS.nW.x * 8.0 + 0.5, slS.nW.z * 8.0 + 0.5, 0.5);
    else if (uReflParams.w < 2.5) outgoingLight = vec3(slS.rough, slS.wet, slS.water);
    else outgoingLight = slS.albedo * 2.0;
  }
`;

const AT_LIGHTS_END = /* glsl */`
  {
    vec3 slV = normalize(cameraPosition - vSlWorldPos);
    float slNoV = clamp(dot(slS.nW, slV), 0.0, 1.0);
    float slF = 0.02 + 0.98 * pow(1.0 - slNoV, 5.0);
    // dry ground is rough and matte: tame three's grazing-angle IBL Fresnel so it doesn't veil the land with sky colour
    reflectedLight.indirectSpecular *= mix(0.10, 1.0, clamp(slS.wet * 1.4, 0.0, 1.0));
    float slWaterK = (uViewMode == VIEW_CLAY) ? 0.0 : slS.water;
    float slSheenK = (uViewMode == VIEW_CLAY) ? 0.0 : slS.wet * uReflParams.y * (1.0 - slS.water) * (1.0 - slS.rough);
    totalEmissiveRadiance += diffuseColor.rgb * slBounce(vSlWorldPos) * (1.0 - slWaterK);
    if (slWaterK + slSheenK > 0.001) {
      vec3 slR = reflect(-slV, slS.nW);
      vec3 slRefl;
      if (uReflParams.x > 0.5) {
        vec4 rc = uReflMat * vec4(vSlWorldPos, 1.0);
        vec2 ruv = rc.xy / rc.w + slS.nW.xz * 1.4;
        // 5-tap blur, wider for glossy wet mud than for open water
        float blur = mix(0.0009, 0.0060, slSheenK * (1.0 - slWaterK));
        slRefl = texture(uReflect, ruv).rgb * 0.4;
        slRefl += texture(uReflect, ruv + vec2(blur, 0.0)).rgb * 0.15;
        slRefl += texture(uReflect, ruv - vec2(blur, 0.0)).rgb * 0.15;
        slRefl += texture(uReflect, ruv + vec2(0.0, blur * 1.7)).rgb * 0.15;
        slRefl += texture(uReflect, ruv - vec2(0.0, blur * 1.7)).rgb * 0.15;
      } else {
        slRefl = textureLod(uSkyCube, slR, 1.0).rgb;
      }
      float slRw = slF * slWaterK;
      reflectedLight.directDiffuse *= 1.0 - slRw;
      reflectedLight.indirectDiffuse *= 1.0 - slRw;
      reflectedLight.indirectSpecular *= (1.0 - slWaterK) * (1.0 - slSheenK);
      totalEmissiveRadiance += slRefl * (slRw + slF * slSheenK);
    }
  }
`;

/** Grid cell (m) of the camera-centred fine part of the terrain mesh; the mesh is re-centred in multiples of this. */
export const TERRAIN_CELL = 15;

/**
 * Non-uniform tensor-product grid (flat, y = 0): 15 m cells within +-480 m of the centre, then geometrically growing
 * cells out to +-40 km. Small triangles near the camera matter: the fragment shader derives its bump normals from
 * screen-space derivatives of the interpolated world position, and interpolating across a single 80 km quad leaves
 * only ~cm of precision in float32.
 */
function buildTerrainGrid(): THREE.BufferGeometry {
  const half: number[] = [0];
  let x = 0;
  while (x < 480) { x += TERRAIN_CELL; half.push(x); }
  let step = TERRAIN_CELL;
  while (x < 40000) { step *= 1.32; x = Math.min(x + step, 40000); half.push(x); }
  const lines = [...half.slice(1).reverse().map((v) => -v), ...half];
  const n = lines.length;
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const o = (j * n + i) * 3; pos[o] = lines[i]; pos[o + 1] = 0; pos[o + 2] = lines[j];
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    // counter-clockwise seen from +y (x east, z south): a -> c -> b
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  readonly u: Record<string, THREE.IUniform> = {};
  readonly coastTex: THREE.DataTexture;

  constructor(globals: Globals, site: SiteData, splats: SplatSet, noise: THREE.Texture, cell: THREE.Texture, waves: THREE.Texture, skyCube: THREE.Texture, hazeCube: THREE.Texture, tuning: TerrainTuning = DEFAULT_TERRAIN_TUNING) {
    const coast = coastProfile(site, COAST_N, COAST_R);
    this.coastTex = new THREE.DataTexture(coast, COAST_N, 1, THREE.RedFormat, THREE.FloatType);
    this.coastTex.minFilter = this.coastTex.magFilter = THREE.NearestFilter;
    this.coastTex.needsUpdate = true;
    this.u = {
      uMaskIA: { value: splats.innerA }, uMaskIB: { value: splats.innerB }, uMaskOA: { value: splats.outerA }, uMaskOB: { value: splats.outerB },
      uNoise: { value: noise }, uCell: { value: cell }, uWave: { value: waves }, uCoast: { value: this.coastTex },
      uReflect: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uSkyCube: { value: skyCube }, uHazeCube: { value: hazeCube },
      uPool: { value: new THREE.Vector4(0, 0, 0, 0) }, uBounce: { value: new THREE.Vector4(0, 0, 0, 700) }, uReflParams: { value: new THREE.Vector4(0, 0, 0, 0) },
    };
    this.setTuning(tuning);

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    const u = this.u;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${HAZE_DECL}\n${coastGlsl}\n${terrainGlsl}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${AT_CLIP}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${AT_COLOR}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${AT_ROUGHNESS}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${AT_NORMAL}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${AT_LIGHTS_END}`)
        .replace('#include <opaque_fragment>', `${AT_DEBUG}\n${HAZE_APPLY}\n#include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => 'env-terrain-v1';
    this.material = applyGlobals(mat, globals, { fog: false, kelvinExpr: 'slKelvin', cacheKey: 'env-terrain' });

    const geo = buildTerrainGrid();
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'env.terrain';
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  tuning: TerrainTuning = { ...DEFAULT_TERRAIN_TUNING };

  /** Keep the fine part of the mesh under the camera (snapped so the grid never swims). */
  follow(cam: THREE.Vector3): void {
    this.mesh.position.set(Math.round(cam.x / TERRAIN_CELL) * TERRAIN_CELL, 0, Math.round(cam.z / TERRAIN_CELL) * TERRAIN_CELL);
  }

  setTuning(t: TerrainTuning): void {
    this.tuning = { ...t };
    (this.u.uPool.value as THREE.Vector4).set(t.poolThreshold, t.poolBias, t.channels, t.vegetation);
    const rp = this.u.uReflParams.value as THREE.Vector4;
    rp.set(rp.x, t.sheen, t.ripple, rp.w);
  }

  /** Warm bounce from the launch clouds: rgb (linear, scene units) and falloff radius in metres. */
  setBounce(c: THREE.Color, radius: number): void { (this.u.uBounce.value as THREE.Vector4).set(c.r, c.g, c.b, radius); }

  /** Dev: 1 = normals, 2 = rough/wet/water, 3 = albedo. */
  setDebug(mode: number): void { (this.u.uReflParams.value as THREE.Vector4).w = mode; }

  setSplats(s: SplatSet): void {
    this.u.uMaskIA.value = s.innerA; this.u.uMaskIB.value = s.innerB; this.u.uMaskOA.value = s.outerA; this.u.uMaskOB.value = s.outerB;
  }

  setReflection(tex: THREE.Texture | null, matrix: THREE.Matrix4): void {
    this.u.uReflect.value = tex;
    (this.u.uReflMat.value as THREE.Matrix4).copy(matrix);
    (this.u.uReflParams.value as THREE.Vector4).x = tex ? 1 : 0;
  }

  dispose(): void { this.mesh.geometry.dispose(); this.material.dispose(); this.coastTex.dispose(); }
}
