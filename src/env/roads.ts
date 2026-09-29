// OSM roads, tracks and paths as thin ribbons lying just above the terrain (MeshStandardMaterial + applyGlobals, so they
// share the terrain's lighting). Ribbons carry (across, along-metres, type, half-width) so the fragment shader can paint
// asphalt with wear and lane markings, concrete slabs with joints, gravel and two-rut dirt tracks with soft edges.
import * as THREE from 'three';
import type { Globals } from '../contracts.ts';
import { applyGlobals } from '../core/material-hooks.ts';
import { HAZE_APPLY, HAZE_DECL } from './haze.ts';
import type { SiteData, SiteFeature } from './site-data.ts';
import { APRON, toPadLocal } from '../scene-config.ts';

/** The pad module owns everything inside the APRON rectangle (PAD-LOCAL frame, rotated by the pad yaw) plus a margin. */
const PAD_ZONE_MARGIN = 12;
export const inPadZone = (x: number, z: number): boolean => {
  const [lx, lz] = toPadLocal(x, z);
  return lx > APRON.minX - PAD_ZONE_MARGIN && lx < APRON.maxX + PAD_ZONE_MARGIN && lz > APRON.minZ - PAD_ZONE_MARGIN && lz < APRON.maxZ + PAD_ZONE_MARGIN;
};

export const enum RoadType { Asphalt = 0, Concrete = 1, Gravel = 2, Dirt = 3, Path = 4 }

interface Style { w: number; type: RoadType; marks: boolean }

function styleOf(t: Record<string, string>): Style | null {
  const hw = t.highway, surf = t.surface;
  switch (hw) {
    case 'tertiary': case 'secondary': case 'primary': case 'unclassified': case 'residential':
      return surf === 'concrete' ? { w: 7, type: RoadType.Concrete, marks: false } : { w: 8, type: RoadType.Asphalt, marks: true };
    case 'service':
      if (surf === 'asphalt') return { w: 6, type: RoadType.Asphalt, marks: false };
      if (surf === 'concrete') return { w: 6, type: RoadType.Concrete, marks: false };
      return { w: 5, type: RoadType.Gravel, marks: false };
    case 'track': return { w: 4, type: RoadType.Dirt, marks: false };
    case 'path': return { w: 1.6, type: RoadType.Path, marks: false };
    case 'footway': return surf === 'asphalt' ? { w: 1.8, type: RoadType.Asphalt, marks: false } : { w: 1.8, type: RoadType.Concrete, marks: false };
    default: return null;
  }
}

/** Build one merged ribbon geometry for all roads. */
export function buildRoadGeometry(site: SiteData): THREE.BufferGeometry | null {
  const pos: number[] = [], road: number[] = [], idx: number[] = [];
  let base = 0;
  const y = 0.05;
  for (const f of site.features as SiteFeature[]) {
    if (f.kind !== 'road' || f.geom !== 'line' || f.points.length < 2) continue;
    const st = styleOf(f.tags);
    if (!st) continue;
    const P = f.points;
    // drop the vertices inside the pad zone (the pad module builds the apron there)
    let s = 0;
    const hw = st.w / 2;
    let run: number[][] = [];
    const flush = () => {
      if (run.length >= 2) {
        const n = run.length;
        let dist = 0;
        for (let i = 0; i < n; i++) {
          const p = run[i];
          const a = run[Math.max(i - 1, 0)], b = run[Math.min(i + 1, n - 1)];
          let dx = b[0] - a[0], dz = b[1] - a[1];
          const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
          // left normal in the x/z plane
          const nx = -dz, nz = dx;
          if (i > 0) dist += Math.hypot(p[0] - run[i - 1][0], p[1] - run[i - 1][1]);
          pos.push(p[0] + nx * hw, y, p[1] + nz * hw, p[0] - nx * hw, y, p[1] - nz * hw);
          road.push(-1, dist + s, st.type * 2 + (st.marks ? 1 : 0), hw, 1, dist + s, st.type * 2 + (st.marks ? 1 : 0), hw);
        }
        for (let i = 0; i < n - 1; i++) {
          const a = base + i * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
        base += n * 2;
        s += dist;
      }
      run = [];
    };
    for (const p of P) {
      if (inPadZone(p[0], p[1])) { flush(); continue; }
      run.push(p);
    }
    flush();
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRoad', new THREE.Float32BufferAttribute(road, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const VERT_DECL = `attribute vec4 aRoad;\nvarying vec4 vRoad;`;
const FRAG_DECL = /* glsl */`
varying vec4 vRoad;
uniform sampler2D uRoadNoise;
uniform sampler2D uSteamShade;   // sun transmittance of the launch-cloud banks (steam-shadow.ts)
`;

const AT_COLOR = /* glsl */`
  float slRoadK = 300.0;
  float slHazeCap = 1.0;
  float slDist = length(vSlWorldPos - cameraPosition);
  {
    float ru = vRoad.x, rs = vRoad.y, rw = vRoad.w;
    // type * 2 + marks, rounded: interpolated varyings are not bit-exact, so a plain floor() would flicker between neighbours
    float rzi = floor(vRoad.z + 0.5);
    float rtype = floor(rzi * 0.5), rmark = mod(rzi, 2.0);
    float dm = abs(ru) * rw;                                   // metres from the centre line
    vec2 wxz = vSlWorldPos.xz;
    vec4 rn = texture(uRoadNoise, wxz / 17.0);
    vec4 rn2 = texture(uRoadNoise, wxz / 3.1 + 5.3);
    float dist = slDist;
    float far = 1.0 - smoothstep(120.0, 700.0, dist);          // fine markings fade out with distance (aliasing)
    vec3 col; float a = 1.0;
    if (rtype < 0.5) {                                         // asphalt
      col = mix(vec3(0.022, 0.023, 0.026), vec3(0.042, 0.041, 0.041), rn.r * 0.6 + rn2.g * 0.4);
      // worn lighter wheel paths + oil-dark centre + cracks
      float wheel = exp(-pow((dm - rw * 0.42) / (rw * 0.14), 2.0));
      col *= 1.0 + 0.25 * wheel * (rn2.b - 0.3);
      col *= 1.0 - 0.35 * smoothstep(0.55, 0.75, rn.b) * far;
      float edgeWear = smoothstep(rw - 0.5, rw, dm);
      col = mix(col, vec3(0.075, 0.07, 0.065), edgeWear * (0.4 + 0.5 * rn.g));
      if (rmark > 0.5) {
        float edgeLine = smoothstep(rw - 0.62, rw - 0.55, dm) * (1.0 - smoothstep(rw - 0.42, rw - 0.35, dm));
        float ctr = (smoothstep(0.06, 0.1, dm) * (1.0 - smoothstep(0.16, 0.2, dm)));
        float ctr2 = ctr;
        col = mix(col, vec3(0.62, 0.6, 0.55), edgeLine * far * (0.6 + 0.4 * rn2.r));
        col = mix(col, vec3(0.65, 0.5, 0.08), (ctr + ctr2) * far * (0.65 + 0.35 * rn2.g));
      }
      a = 1.0 - smoothstep(rw - 0.25, rw, dm);
      slRoadK = 306.0;
    } else if (rtype < 1.5) {                                  // concrete slabs
      float jx = abs(fract(rs / 6.0 + 0.5) - 0.5) * 6.0;
      float joint = 1.0 - smoothstep(0.0, 0.05 + 0.002 * dist, jx);
      col = mix(vec3(0.22, 0.21, 0.195), vec3(0.31, 0.30, 0.28), rn.r * 0.6 + rn2.g * 0.4);
      col *= 1.0 - 0.45 * joint * far;
      col = mix(col, vec3(0.16, 0.15, 0.13), smoothstep(rw - 0.5, rw, dm) * 0.5);
      a = 1.0 - smoothstep(rw - 0.2, rw, dm);
      slRoadK = 300.0;
    } else if (rtype < 2.5) {                                  // gravel service road
      col = mix(vec3(0.22, 0.2, 0.17), vec3(0.34, 0.31, 0.26), rn.r * 0.5 + rn2.g * 0.5);
      a = 1.0 - smoothstep(0.62, 1.0, abs(ru) + (rn.g - 0.5) * 0.35);
      slRoadK = 297.0;
    } else if (rtype < 3.5) {                                  // dirt track with two ruts and a grassy crown
      float rut = exp(-pow((dm - rw * 0.5) / (rw * 0.16), 2.0));
      col = mix(vec3(0.16, 0.12, 0.085), vec3(0.28, 0.21, 0.145), rn.r);
      col = mix(col, vec3(0.06, 0.045, 0.03), rut * 0.6);
      col = mix(col, vec3(0.09, 0.085, 0.045), (1.0 - smoothstep(0.0, rw * 0.3, dm)) * 0.5 * rn2.g);
      a = (1.0 - smoothstep(0.55, 1.0, abs(ru) + (rn.g - 0.5) * 0.5)) * 0.92;
      slRoadK = 296.0;
    } else {                                                   // footpath
      col = mix(vec3(0.2, 0.17, 0.13), vec3(0.3, 0.26, 0.2), rn.r);
      a = (1.0 - smoothstep(0.35, 1.0, abs(ru) + (rn.g - 0.5) * 0.6)) * 0.75;
      slRoadK = 295.0;
    }
    diffuseColor.rgb = col;
    diffuseColor.a = a;
    if (uViewMode == VIEW_CLAY) diffuseColor.rgb = vec3(0.7);
  }
`;

// the launch-cloud banks shade the road from the low sun (the scene's sun light only; runs before the plume line light)
const AT_SHADE = /* glsl */`
  {
    float slSteamT = texture(uSteamShade, vSlWorldPos.xz * (0.5 / 4096.0) + 0.5).r;
    reflectedLight.directDiffuse *= slSteamT;
    reflectedLight.directSpecular *= slSteamT;
  }
`;

export class Roads {
  readonly mesh: THREE.Mesh | null;
  readonly material: THREE.MeshStandardMaterial;

  constructor(globals: Globals, site: SiteData, noise: THREE.Texture, hazeCube: THREE.Texture, steamShade: THREE.Texture) {
    const geo = buildRoadGeometry(site);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.92, metalness: 0, envMapIntensity: 0.3, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRoadNoise = { value: noise };
      shader.uniforms.uHazeCube = { value: hazeCube };
      shader.uniforms.uSteamShade = { value: steamShade };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvRoad = aRoad;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${HAZE_DECL}\n${FRAG_DECL}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${AT_COLOR}`)
        .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>\n${AT_SHADE}`)
        .replace('#include <opaque_fragment>', `${HAZE_APPLY}\n#include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => 'env-roads-v1';
    this.material = applyGlobals(mat, globals, { fog: false, kelvinExpr: 'slRoadK', cacheKey: 'env-roads' });
    if (geo) {
      this.mesh = new THREE.Mesh(geo, this.material);
      this.mesh.name = 'env.roads';
      this.mesh.receiveShadow = true;
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = -5;
    } else this.mesh = null;
  }

  dispose(): void { this.mesh?.geometry.dispose(); this.material.dispose(); }
}
