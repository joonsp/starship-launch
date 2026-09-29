// Force vectors on the vehicle: thrust (from the engine plane, up), weight (from the estimated
// centre of mass, down) and the net force (from the centre of mass, up). Not ArrowHelper: each arrow
// is a tapered tube with a broad cone head, shaded by a custom ShaderMaterial (Fresnel rim, a glow that
// brightens toward the head, premultiplied blending so it adds light without flattening the scene).
// They are annotations, drawn on top of everything (depthTest off) with a dark under-hull so they stay
// legible against the white plume and clouds.
//
// UI overlay: these shaders deliberately ignore uViewMode, fog and the plume light (an annotation must look
// the same in Photo, Thermal and Clay). Emission is 2 to 4 in linear HDR: visible, but no bloom bomb.
import * as THREE from 'three';
import type { Anchors } from '../contracts.ts';
import type { LiftoffSample } from '../physics/liftoff.ts';

const DEG = Math.PI / 180;

/** World metres of arrow length per meganewton. */
export const FORCE_SCALE_M_PER_MN = 1.0;

/** Build a tapered arrow along +y in metres: tube tail radius rt -> rs, a flat collar, then a cone head. */
export function buildArrowGeometry(L: number, rt: number, rs: number, headR: number, headLen: number, seg = 40): THREE.BufferGeometry {
  headLen = Math.min(headLen, L * 0.55);
  const shaftLen = Math.max(L - headLen, 0.01);
  const pos: number[] = [], nor: number[] = [], along: number[] = [], idx: number[] = [];
  const ring = (y: number, r: number, nx: (c: number, s: number) => [number, number, number]) => {
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(c * r, y, s * r);
      nor.push(...nx(c, s));
      along.push(y / L);
    }
  };
  const link = (a: number, b: number) => {
    for (let i = 0; i < seg; i++) {
      const p = a + i, q = b + i;
      idx.push(p, q, p + 1, p + 1, q, q + 1);
    }
  };
  const slope = Math.atan2(rt - rs, shaftLen); // cone side normal tilt
  const sideN = (c: number, s: number): [number, number, number] => [c * Math.cos(slope), Math.sin(slope), s * Math.cos(slope)];
  const base = () => pos.length / 3;
  // shaft (tapered tube)
  let r0 = base(); ring(0, rt, sideN); let r1 = base(); ring(shaftLen, rs, sideN); link(r0, r1);
  // tail cap
  r0 = base(); ring(0, rt, () => [0, -1, 0]);
  const cap = base(); pos.push(0, 0, 0); nor.push(0, -1, 0); along.push(0);
  for (let i = 0; i < seg; i++) idx.push(cap, r0 + i + 1, r0 + i);
  // collar: a flat annulus at the head base facing down
  r0 = base(); ring(shaftLen, rs, () => [0, -1, 0]); r1 = base(); ring(shaftLen, headR, () => [0, -1, 0]); link(r1, r0);
  // cone head
  const hn = Math.atan2(headR, headLen);
  const coneN = (c: number, s: number): [number, number, number] => [c * Math.cos(hn), Math.sin(hn), s * Math.cos(hn)];
  r0 = base(); ring(shaftLen, headR, coneN);
  const apex = base();
  for (let i = 0; i <= seg; i++) { const a = ((i + 0.5) / seg) * Math.PI * 2; pos.push(0, L, 0); nor.push(Math.cos(a) * Math.cos(hn), Math.sin(hn), Math.sin(a) * Math.cos(hn)); along.push(1); }
  for (let i = 0; i < seg; i++) idx.push(r0 + i, apex + i, r0 + i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const VERT = /* glsl */ `
attribute float aAlong;
varying vec3 vN; varying vec3 vV; varying float vAlong;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vAlong = aAlong;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor; uniform float uIntensity; uniform float uAlpha;
varying vec3 vN; varying vec3 vV; varying float vAlong;
void main() {
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  float ndv = clamp(dot(n, normalize(vV)), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.2);
  float grow = smoothstep(0.0, 1.0, vAlong);          // narrow, dim tail -> bright head
  float core = pow(ndv, 6.0);                          // tube-like highlight along the front
  vec3 col = uColor * (0.55 + 1.5 * fres + 0.9 * core) * (0.55 + 0.9 * grow) * uIntensity;
  col += vec3(1.0, 0.96, 0.9) * (0.35 * core + 0.5 * pow(fres, 3.0)) * (0.4 + 0.6 * grow);
  float a = clamp(mix(0.32, 0.96, grow) * (0.62 + 0.38 * fres + 0.3 * core), 0.0, 1.0) * uAlpha;
  gl_FragColor = vec4(col * a, a);                     // premultiplied
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const HULL_FRAG = /* glsl */ `
precision highp float;
uniform float uAlpha;
varying vec3 vN; varying vec3 vV; varying float vAlong;
void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.5 * uAlpha * mix(0.4, 1.0, vAlong)); }`;

function arrowMaterial(color: THREE.Color, intensity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { uColor: { value: color }, uIntensity: { value: intensity }, uAlpha: { value: 1 } },
  });
}
function hullMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: HULL_FRAG, transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide,
    uniforms: { uAlpha: { value: 1 } },
  });
}

class Arrow {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private hull: THREE.Mesh;
  private key = '';
  constructor(readonly id: 'thrust' | 'weight' | 'net', color: THREE.Color, intensity: number) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), arrowMaterial(color, intensity));
    this.hull = new THREE.Mesh(this.mesh.geometry, hullMaterial());
    this.hull.scale.set(1.28, 1.015, 1.28);
    this.hull.renderOrder = 998; this.mesh.renderOrder = 999;
    this.mesh.frustumCulled = false; this.hull.frustumCulled = false;
    this.group.add(this.hull, this.mesh);
  }
  /** Set origin, unit direction and length (m). Rebuilds the geometry only when the shape changes. */
  set(origin: THREE.Vector3, dir: THREE.Vector3, L: number, widthScale = 1): void {
    const rs = THREE.MathUtils.clamp(0.7 + L * 0.011, 0.8, 2.0) * widthScale;
    const rt = rs * 0.22;
    const headR = rs * 2.3;
    const headLen = THREE.MathUtils.clamp(L * 0.24, 4, 14);
    const key = [L, rs].map((v) => v.toFixed(2)).join('|');
    if (key !== this.key) {
      this.key = key;
      const g = buildArrowGeometry(Math.max(L, 2), rt, rs, headR, headLen);
      this.mesh.geometry.dispose();
      this.mesh.geometry = g;
      this.hull.geometry = g;
    }
    this.group.position.copy(origin);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    (this.hull.material as THREE.Material).dispose();
  }
}

export interface ForceLabel { id: 'thrust' | 'weight' | 'net' | 'com' | 'plane'; world: THREE.Vector3; valueMN?: number }

/** The three force arrows plus the two anchor dots and the offset guides. */
export class ForceVectors {
  readonly group = new THREE.Group();
  private arrows: Record<'thrust' | 'weight' | 'net', Arrow>;
  private dots: THREE.Mesh[] = [];
  private guides: THREE.LineSegments;
  private labels: ForceLabel[] = [];
  private up = new THREE.Vector3(0, 1, 0);
  private right = new THREE.Vector3(1, 0, 0);
  private tmp = new THREE.Vector3();

  constructor(private anchors: Anchors) {
    this.group.name = 'edu-forces';
    // linear HDR colours from the UI tokens: plume orange, sky blue, ok green
    const thrust = new THREE.Color('#ff9a3c').convertSRGBToLinear();
    const weight = new THREE.Color('#6cc3ff').convertSRGBToLinear();
    const net = new THREE.Color('#5fd08b').convertSRGBToLinear();
    this.arrows = { thrust: new Arrow('thrust', thrust, 2.6), weight: new Arrow('weight', weight, 2.6), net: new Arrow('net', net, 2.8) };
    for (const a of Object.values(this.arrows)) this.group.add(a.group);
    for (const c of [thrust, net]) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 12), arrowMaterial(c, 2.4));
      dot.renderOrder = 1000; dot.frustumCulled = false;
      this.dots.push(dot); this.group.add(dot);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(4 * 3), 3));
    this.guides = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }));
    this.guides.renderOrder = 997; this.guides.frustumCulled = false;
    this.group.add(this.guides);
  }

  /** Place everything for the current camera and the physics state at the frozen instant. */
  update(camera: THREE.Camera, s: LiftoffSample, comHeight: number, offset = 11): void {
    const A = this.anchors;
    // vehicle axis (tilted about vehicleTiltAxis, normally 0)
    this.up.set(0, 1, 0).applyAxisAngle(A.vehicleTiltAxis, A.vehicleTiltDeg * DEG);
    // camera right, flattened to the horizontal so the arrows stay upright on screen
    this.right.setFromMatrixColumn(camera.matrixWorld, 0); this.right.y = 0;
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();
    const base = A.vehicleBase;
    const com = this.tmp.copy(base).addScaledVector(this.up, comHeight).clone();
    const Tm = s.thrust / 1e6, Wm = s.weight / 1e6, Nm = (s.thrust - s.drag - s.weight) / 1e6;
    const k = FORCE_SCALE_M_PER_MN;
    // keep the arrows readable from far away: widen them in steps as the camera recedes (rebuilds only on a step)
    const dist = camera.position.distanceTo(base);
    const ws = THREE.MathUtils.clamp(Math.round((dist / 450) * 4) / 4, 1, 3);
    const oT = base.clone().addScaledVector(this.right, -offset);
    const oW = com.clone().addScaledVector(this.right, offset);
    this.arrows.thrust.set(oT, this.up, Tm * k, ws);
    this.arrows.weight.set(oW, this.up.clone().negate(), Wm * k, ws);
    this.arrows.net.set(oW, this.up, Math.max(Nm * k, 0.5), ws);
    this.dots[0].position.copy(oT);
    this.dots[1].position.copy(oW);
    // guides: axis -> arrow tails
    const p = this.guides.geometry.getAttribute('position') as THREE.BufferAttribute;
    const cAxis = com;
    p.setXYZ(0, base.x, base.y, base.z); p.setXYZ(1, oT.x, oT.y, oT.z);
    p.setXYZ(2, cAxis.x, cAxis.y, cAxis.z); p.setXYZ(3, oW.x, oW.y, oW.z);
    p.needsUpdate = true;
    this.labels = [
      { id: 'thrust', world: oT.clone().addScaledVector(this.up, Tm * k), valueMN: Tm },
      { id: 'weight', world: oW.clone().addScaledVector(this.up, -Wm * k), valueMN: Wm },
      { id: 'net', world: oW.clone().addScaledVector(this.up, Nm * k), valueMN: Nm },
      { id: 'com', world: oW.clone() },
      { id: 'plane', world: oT.clone() },
    ];
  }

  /** World anchors for the DOM labels (valid after update()). */
  getLabels(): ForceLabel[] { return this.labels; }

  setVisible(v: boolean): void { this.group.visible = v; }

  dispose(): void {
    for (const a of Object.values(this.arrows)) a.dispose();
    for (const d of this.dots) { d.geometry.dispose(); (d.material as THREE.Material).dispose(); }
    this.guides.geometry.dispose(); (this.guides.material as THREE.Material).dispose();
  }
}
