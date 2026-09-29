// The Gulf of Mexico: a polygon east of the OSM coastline (there is no sea polygon in the data), out to 70 km.
import * as THREE from 'three';
import common from '../shaders/common.glsl?raw';
import coastGlsl from './glsl/coast.glsl?raw';
import vert from './glsl/ocean.vert.glsl?raw';
import frag from './glsl/ocean.frag.glsl?raw';
import type { Globals } from '../contracts.ts';
import type { SiteData } from './site-data.ts';
import { coastProfile } from './site-data.ts';
import { COAST_N, COAST_R } from './terrain.ts';
import { WATER_Y } from './reflection.ts';

export class Ocean {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(globals: Globals, site: SiteData, coastTex: THREE.Texture, noise: THREE.Texture, waves: THREE.Texture, skyCube: THREE.Texture, hazeCube: THREE.Texture) {
    // polygon: coastline (x(z), pushed 1.5 m inland so it overlaps the terrain; the terrain wins the overlap via
    // polygon offset) + a far rectangle. ShapeGeometry lies in x/y; y = -z_world, then rotate onto the ground plane.
    const prof = coastProfile(site, COAST_N, COAST_R);
    const FAR = 70000;
    const pts: THREE.Vector2[] = [];
    pts.push(new THREE.Vector2(prof[0] - 1.5, FAR)); // z = -FAR  -> y = +FAR
    for (let i = 0; i < COAST_N; i++) {
      const z = -COAST_R + (i / (COAST_N - 1)) * 2 * COAST_R;
      pts.push(new THREE.Vector2(prof[i] - 1.5, -z));
    }
    pts.push(new THREE.Vector2(prof[COAST_N - 1] - 1.5, -FAR));
    pts.push(new THREE.Vector2(FAR, -FAR));
    pts.push(new THREE.Vector2(FAR, FAR));
    const geo = new THREE.ShapeGeometry(new THREE.Shape(pts));
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, WATER_Y, 0);

    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: `${common}\n${coastGlsl}\n${frag}`,
      side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4,
      uniforms: {
        uSunDir: globals.uSunDir, uSunColor: globals.uSunColor, uSkyAmb: globals.uSkyAmbient,
        uViewMode: globals.uViewMode, uFogDensity: globals.uFogDensity,
        uNoise: { value: noise }, uWave: { value: waves }, uReflect: { value: null }, uReflMat: { value: new THREE.Matrix4() },
        uSkyCube: { value: skyCube }, uHazeCube: { value: hazeCube }, uCoast: { value: coastTex },
        uOcean: { value: new THREE.Vector4(0, 1.0, 0.30, 1.0) },
        uBody: { value: new THREE.Color(0.07, 0.15, 0.18) },
      },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'env.ocean';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -9;
  }

  setReflection(tex: THREE.Texture | null, matrix: THREE.Matrix4): void {
    const u = this.material.uniforms;
    u.uReflect.value = tex; u.uReflMat.value.copy(matrix); u.uOcean.value.x = tex ? 1 : 0;
  }

  dispose(): void { this.mesh.geometry.dispose(); this.material.dispose(); }
}
