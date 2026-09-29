// The sound-front sphere: a translucent Fresnel shell centred at the ignition point (0, 20, 0),
// radius c * (T_F + engine_start_lead). Drawn with depth test ON (terrain and the vehicle occlude it,
// so it reads as a real volume in the scene) but no depth write. Both faces are drawn, because the
// photo camera and the walker are INSIDE the sphere (r is about 3.5 km) while an orbiting camera at
// 8 km is outside it. Lines of latitude and longitude every 15 degrees, plus a stronger horizon ring at
// ground level, make the curvature readable from inside, where a pure Fresnel rim would vanish.
//
// UI overlay: ignores uViewMode, fog and plume light by design (an annotation must not change with the view).
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec3 vObj; varying vec3 vN; varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vObj = position; vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor; uniform float uOpacity; uniform float uLines;
varying vec3 vObj; varying vec3 vN; varying vec3 vV;
float gridLine(float x, float w) {          // x in "cells"; anti-aliased with fwidth
  float d = abs(fract(x + 0.5) - 0.5);
  float fw = fwidth(x) * w;
  return 1.0 - smoothstep(0.0, max(fw, 1e-4), d);
}
void main() {
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  float ndv = clamp(dot(n, normalize(vV)), 0.0, 1.0);
  float rim = pow(1.0 - ndv, 3.0);
  vec3 o = normalize(vObj);
  float lat = asin(clamp(o.y, -1.0, 1.0)), lon = atan(o.z, o.x);
  float k = 3.14159265 / 12.0;              // 15 degree cells
  float g = gridLine(lat / k, 1.4) * smoothstep(1.45, 1.1, abs(lat) / k)
          + gridLine(lon / k, 1.4) * smoothstep(0.0, 0.35, 1.0 - abs(o.y));
  float horizon = 1.0 - smoothstep(0.0, 0.012, abs(o.y));   // ground-level ring
  float a = uOpacity * (0.04 + 0.6 * rim) + uLines * (0.10 * min(g, 1.0) + 0.5 * horizon);
  vec3 col = uColor * (0.75 + 1.0 * rim) + vec3(0.6, 0.75, 0.9) * horizon * 0.6;
  gl_FragColor = vec4(col * a, a);           // premultiplied
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class SoundFront {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  readonly centre = new THREE.Vector3();
  radius = 1;

  constructor(centre: THREE.Vector3) {
    this.centre.copy(centre);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { uColor: { value: new THREE.Color('#6cc3ff').convertSRGBToLinear() }, uOpacity: { value: 0.26 }, uLines: { value: 1.0 } },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), this.mat);
    this.mesh.name = 'edu-soundfront';
    this.mesh.position.copy(centre);
    this.mesh.renderOrder = 900;
    this.mesh.frustumCulled = false;
  }

  setRadius(r: number): void { this.radius = r; this.mesh.scale.setScalar(Math.max(r, 1)); }
  setVisible(v: boolean): void { this.mesh.visible = v; }

  /** World point on the sphere in direction `dir` (unit) from the centre. */
  pointAt(dir: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(dir).multiplyScalar(this.radius).add(this.centre);
  }

  dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose(); }
}
