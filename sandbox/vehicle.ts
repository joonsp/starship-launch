// Vehicle sandbox: the stack alone, harness sun + hemisphere light, RoomEnvironment PMREM for metal reflections.
// Scripted checks (scripts/shoot.mjs) drive window.app.sb.setPhotoView() / setOrbit() and app.vehicle.
//   ?plume=0.004  plume line-light strength (the real value is set by the plume module)
//   ?envi=0.5     environment intensity, ?env=room for the studio environment
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createSandbox } from './harness.ts';
import { VehicleModule } from '../src/vehicle/index.ts';
import { ANCHORS } from '../src/scene-config.ts';

const q = new URLSearchParams(location.search);
const sb = await createSandbox({ title: 'Vehicle', view: 'photo', background: 0x2e78b4 });
const g = sb.ctx.globals;

// reflections: a gradient sky PMREM close to the real app's environment (blue zenith, pale warm horizon, dark ground,
// no sun disc: the DirectionalLight already provides the sun). ?env=room switches to the RoomEnvironment studio.
// the harness hemisphere light is replaced by the environment map (as in the real app)
sb.ctx.scene.children.filter((o) => (o as THREE.HemisphereLight).isHemisphereLight).forEach((o) => sb.ctx.scene.remove(o));
const pmrem = new THREE.PMREMGenerator(sb.ctx.renderer);
function skyEnv(): THREE.Texture {
  const sc = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vD; void main(){
      float h = vD.y;
      vec3 zen = vec3(0.10, 0.30, 0.85) * 1.1, hor = vec3(0.85, 0.80, 0.72) * 1.0, gnd = vec3(0.16, 0.13, 0.11);
      vec3 c = h > 0.0 ? mix(hor, zen, pow(h, 0.55)) : mix(hor * 0.6, gnd, 1.0 - smoothstep(-0.35, 0.0, h));
      gl_FragColor = vec4(c, 1.0); }`,
  });
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat));
  return pmrem.fromScene(sc, 0.02).texture;
}
sb.ctx.scene.environment = q.get('env') === 'room' ? pmrem.fromScene(new RoomEnvironment(), 0.04).texture : skyEnv();
sb.ctx.scene.environmentIntensity = Number(q.get('envi') ?? 0.25);

// the plume lights the stack through the shared line light; a modest value so the tank walls glow near the base
g.uPlumeLight.value.setRGB(1.0, 0.62, 0.34).multiplyScalar(Number(q.get('plume') ?? 0.004));

// warm bounce from the sunlit launch clouds (the reference photo lights the shaded side orange-cream); sandbox only.
// ?bounce=0 disables it. The real app gets this from the environment / volume module.
const bounce = Number(q.get('bounce') ?? 1.5);
if (bounce > 0) {
  const b = new THREE.DirectionalLight(0xffc48a, bounce);
  b.position.set(0.55, 0.05, 0.83).multiplyScalar(1000);   // from the camera side, slightly below, toward the vehicle
  sb.ctx.scene.add(b);
}

const vehicle = new VehicleModule();
await vehicle.init(sb.ctx);
sb.add(vehicle);
(window as any).app.vehicle = vehicle;
(window as any).app.THREE = THREE;
(window as any).app.anchors = ANCHORS;
// helper for scripted close-ups in VEHICLE-frame coordinates: look at `t` from `p` (both vehicle frame, metres)
(window as any).app.look = (p: number[], t: number[]) => {
  const w = (v: number[]) => vehicle.root.localToWorld(new THREE.Vector3(v[0], v[1], v[2])).toArray() as [number, number, number];
  sb.setOrbit(w(p), w(t));
};
// same in WORLD coordinates (the sun is toward +x, 5.7 deg up: a camera at +x sees the fully lit side)
(window as any).app.lookW = (p: number[], t: number[]) => sb.setOrbit(p as [number, number, number], t as [number, number, number]);
sb.start();
