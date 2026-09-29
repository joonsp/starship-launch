// Sky bake + dome. The sky (single-scatter atmosphere), cirrus and raymarched background cumulus are baked into a
// HalfFloat cubemap once per lighting preset (the scene is frozen) and displayed on a camera-locked dome.
import * as THREE from 'three';
import common from '../shaders/common.glsl?raw';
import atmosphere from './glsl/atmosphere.glsl?raw';
import bakeFrag from './glsl/sky_bake.frag.glsl?raw';
import domeVert from './glsl/sky_dome.vert.glsl?raw';
import domeFrag from './glsl/sky_dome.frag.glsl?raw';
import { CLOUD_BASE, CLOUD_TOP } from './cloud-layout.ts';

/** Everything the bake shader needs, derived from a LightingPreset by the module. */
export interface SkyParams {
  sunDir: THREE.Vector3;
  cloudSunDir: THREE.Vector3; // sun direction used to light clouds
  sunLight: THREE.Color;      // ground-level sun colour * intensity (linear)
  e0: THREE.Color;            // extraterrestrial irradiance fed to the atmosphere
  msGain: number;
  atmo: THREE.Vector4;        // rayleigh scale, aerosol scale, mie g, ozone scale
  betaR: THREE.Vector3;       // Rayleigh coefficients (per m)
  horizonTint: THREE.Color;   // humid coastal haze: multiplies the sky near the horizon (teal-grey instead of violet-white)
  farCap: number;             // view-ray length cap (m)
  warmth: number;             // how much of the sun's reddening survives in scattered light (0..1)
  ambTop: THREE.Color;        // cloud ambient radiance from above
  ambBottom: THREE.Color;     // cloud ambient radiance from below
  cloudDensity: number;
  cloudCoarse: number;
  hazePerMetre: number;
  cirrus: number;             // 0..1 strength
  cirrusAngle: number;        // radians
  stars: number;              // 0..1
  skyFloor: THREE.Color;      // night airglow
  ground: THREE.Color;        // ground hemisphere radiance (env cube)
  sunDisc: number;
}

export interface BakeOptions {
  pos: THREE.Vector3;
  clouds: boolean;
  cloudSteps: number;
  below: boolean;             // paint the ground hemisphere (env cube) instead of clamping to the horizon
}

export interface CloudTextures {
  cover: THREE.Texture;
  shape: THREE.Data3DTexture;
  detail: THREE.Data3DTexture;
}

export class SkyBaker {
  private mat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(private renderer: THREE.WebGLRenderer, tex: CloudTextures, debug = 0) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `${common}\n${atmosphere}\n${bakeFrag}`,
      depthTest: false, depthWrite: false,
      uniforms: {
        uDebug: { value: debug }, uHorizonTint: { value: new THREE.Color(1, 1, 1) }, uFace: { value: 0 }, uBakePos: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uCloudSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uE0: { value: new THREE.Color() }, uMsGain: { value: 1 }, uSunLight: { value: new THREE.Color() },
        uAmbTop: { value: new THREE.Color() }, uAmbBottom: { value: new THREE.Color() },
        uCloud: { value: new THREE.Vector4(CLOUD_BASE, CLOUD_TOP, 96, 1) },
        uCirrus: { value: new THREE.Vector4(1, 9200, 0.6, 0) },
        uWeather: { value: new THREE.Vector4(1, 0.9, 2.2e-5, 0) },
        uSkyFloor: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uBelow: { value: 0 },
        uAtmo: { value: new THREE.Vector4(1, 1, 0.8, 1) }, uBetaR: { value: new THREE.Vector3(5.8e-6, 13.5e-6, 33e-6) }, uWarm: { value: 0.55 }, uFar: { value: 60000 },
        uCover: { value: tex.cover }, uNoiseS: { value: tex.shape }, uNoiseD: { value: tex.detail },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  createCube(size: number): THREE.WebGLCubeRenderTarget {
    const rt = new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    return rt;
  }

  private setUniforms(p: SkyParams, o: BakeOptions): void {
    const u = this.mat.uniforms;
    u.uBakePos.value.copy(o.pos);
    u.uSunDir.value.copy(p.sunDir); u.uCloudSunDir.value.copy(p.cloudSunDir);
    u.uE0.value.copy(p.e0); u.uMsGain.value = p.msGain; u.uSunLight.value.copy(p.sunLight);
    u.uAmbTop.value.copy(p.ambTop); u.uAmbBottom.value.copy(p.ambBottom);
    u.uCloud.value.set(CLOUD_BASE, CLOUD_TOP, o.cloudSteps, o.clouds ? 1 : 0);
    u.uCirrus.value.set(o.clouds ? p.cirrus : 0, 9200, p.cirrusAngle, 0);
    u.uWeather.value.set(p.cloudDensity, p.cloudCoarse, p.hazePerMetre, p.stars);
    u.uHorizonTint.value.copy(p.horizonTint);
    u.uSkyFloor.value.copy(p.skyFloor); u.uGround.value.copy(p.ground); u.uBelow.value = o.below ? 1 : 0;
    u.uAtmo.value.copy(p.atmo); u.uBetaR.value.copy(p.betaR); u.uWarm.value = p.warmth; u.uFar.value = p.farCap;
  }

  /**
   * Bake all six faces of `rt`. A generator: one `yield` per face so the caller can spread the work over frames
   * (drive with `for (const _ of bake(...))` for a synchronous bake). Only ONE generator may be in flight at a time
   * (the uniforms are shared), so finish or drop the previous one before starting another.
   */
  *bake(rt: THREE.WebGLCubeRenderTarget, p: SkyParams, o: BakeOptions): Generator<number> {
    const r = this.renderer;
    this.setUniforms(p, o);
    for (let f = 0; f < 6; f++) {
      // Renderer state is saved/restored around every face, so other code may render between two yields.
      const prevRT = r.getRenderTarget();
      const prevAC = r.autoClear;
      const prevActive = r.getActiveCubeFace();
      const prevXR = r.xr.enabled;
      r.xr.enabled = false;
      r.autoClear = false;
      this.mat.uniforms.uFace.value = f;
      try {
        r.setRenderTarget(rt, f);
        r.render(this.scene, this.cam);
      } finally {
        r.setRenderTarget(prevRT, prevActive);
        r.autoClear = prevAC;
        r.xr.enabled = prevXR;
      }
      yield f;
    }
  }

  dispose(): void { this.mat.dispose(); }
}

/** Camera-locked sky dome that displays a baked sky cube. */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(cube: THREE.CubeTexture, viewModeUniform: THREE.IUniform<number>) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: domeVert,
      fragmentShader: `${common}\n${atmosphere}\n${domeFrag}`,
      side: THREE.DoubleSide, depthWrite: false, depthTest: true,
      uniforms: {
        uSky: { value: cube }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uE0: { value: new THREE.Color() },
        uCamAlt: { value: 100 }, uSunDisc: { value: 1 }, uViewMode: viewModeUniform,
        uAtmo: { value: new THREE.Vector4(1, 1, 0.8, 1) }, uBetaR: { value: new THREE.Vector3(5.8e-6, 13.5e-6, 33e-6) }, uWarm: { value: 0.55 }, uFar: { value: 60000 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'env.skyDome';
  }

  setParams(p: SkyParams, camAlt: number): void {
    const u = this.material.uniforms;
    u.uSunDir.value.copy(p.sunDir); u.uE0.value.copy(p.e0); u.uCamAlt.value = camAlt; u.uSunDisc.value = p.sunDisc;
    u.uAtmo.value.copy(p.atmo); u.uBetaR.value.copy(p.betaR); u.uWarm.value = p.warmth; u.uFar.value = p.farCap;
  }
}
