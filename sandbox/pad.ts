// Pad sandbox: the pad alone with the harness sun (shadows on), a gradient-sky PMREM for metal reflections, a ground
// plane with the trench cutout the env module would leave, and a placeholder 9 m stack at the photo pose.
//   ?envi=0.5      environment intensity        ?plume=0.004   plume line-light strength
//   ?env=1         use the real environment module (sky, terrain with the trench cutout, ocean) + AgX + the photo preset
//                  (?preset=noon|night|thermal|clay, ?exp=1.0); the harness sky/ground stand-ins are skipped
//   ?bounce=1.5    warm bounce light (sandbox stand-in for the launch clouds)   ?stack=0 hides the stack placeholder
// Scripted checks drive window.app.sb.setPhotoView() / setOrbit(pos, target), app.look(pos, target), app.overlay(alpha).
import * as THREE from 'three';
import { createSandbox } from './harness.ts';
import { PadModule } from '../src/pad/index.ts';
import { ANCHORS, TRENCH_CUTOUT } from '../src/scene-config.ts';
import { applyGlobals } from '../src/core/material-hooks.ts';
import { EnvironmentModule } from '../src/env/EnvironmentModule.ts';
import { PRESETS, applyPresetToGlobals } from '../src/post/presets.ts';

const q = new URLSearchParams(location.search);
const useEnv = q.get('env') === '1';
const sb = await createSandbox({ title: 'Pad', view: 'photo', background: 0x2e78b4, lights: !useEnv });
const g = sb.ctx.globals;
const scene = sb.ctx.scene;

// sun shadows over the pad region (the real app's core owns this)
let env: EnvironmentModule | null = null;
let preset = PRESETS.photo;
if (useEnv) {
  preset = PRESETS[(q.get('preset') as keyof typeof PRESETS) ?? 'photo'];
  applyPresetToGlobals(sb.ctx, preset);
  sb.ctx.renderer.toneMapping = preset.viewMode === 1 ? THREE.NoToneMapping : THREE.AgXToneMapping;
  sb.ctx.renderer.toneMappingExposure = preset.exposure * Number(q.get('exp') ?? 1.0);
  env = new EnvironmentModule({ sandboxReflection: true, bakeRes: 512 });
  await env.init(sb.ctx);
  sb.add(env);
  const s = new THREE.DirectionalLight(preset.sun.color, preset.sun.intensity);
  s.position.copy(preset.sun.dir).multiplyScalar(2000);
  scene.add(s);
  scene.add(new THREE.HemisphereLight(preset.ambient.sky, preset.ambient.ground, preset.ambient.intensity * 0.5));
}
const sun = scene.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight | undefined;
if (sun) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const c = sun.shadow.camera as THREE.OrthographicCamera;
  const R = Number(q.get('shadowR') ?? 160);
  c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 100; c.far = 4000;
  sun.position.copy(g.uSunDir.value).multiplyScalar(1500);
  sun.target.position.set(0, 40, -10);
  scene.add(sun.target);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
  c.updateProjectionMatrix();
}

// reflections: the vehicle sandbox's gradient sky PMREM; the harness hemisphere light is replaced by it
if (!useEnv) scene.children.filter((o) => (o as THREE.HemisphereLight).isHemisphereLight).forEach((o) => scene.remove(o));
const pmrem = new THREE.PMREMGenerator(sb.ctx.renderer);
if (useEnv) {
  scene.environment = pmrem.fromScene(env!.environmentScene(), 0, 0.1, 100).texture;
} else {
  const sc = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vD; void main(){
      float h = vD.y;
      vec3 zen = vec3(0.10, 0.30, 0.85) * 1.1, hor = vec3(0.85, 0.80, 0.72), gnd = vec3(0.16, 0.13, 0.11);
      vec3 c = h > 0.0 ? mix(hor, zen, pow(h, 0.55)) : mix(hor * 0.6, gnd, 1.0 - smoothstep(-0.35, 0.0, h));
      gl_FragColor = vec4(c, 1.0); }`,
  });
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat));
  scene.environment = pmrem.fromScene(sc, 0.02).texture;
  scene.environmentIntensity = Number(q.get('envi') ?? 0.35);
}
g.uPlumeLight.value.setRGB(1.0, 0.62, 0.34).multiplyScalar(Number(q.get('plume') ?? (useEnv ? 0 : 0.004)));
const bounce = Number(q.get('bounce') ?? (useEnv ? 0 : 1.2));
if (bounce > 0) {
  const b = new THREE.DirectionalLight(0xffc48a, bounce);
  b.position.set(0.55, 0.05, 0.83).multiplyScalar(1000);
  scene.add(b);
}

// ground with the env module's trench cutout (80 x 32 m), dark tidal-flat mud (skipped when the real environment is on)
if (!useEnv) {
  const R = 4000, h = TRENCH_CUTOUT;
  const shape = new THREE.Shape([new THREE.Vector2(-R, -R), new THREE.Vector2(R, -R), new THREE.Vector2(R, R), new THREE.Vector2(-R, R)]);
  shape.holes.push(new THREE.Path([new THREE.Vector2(-h.halfX, -h.halfZ), new THREE.Vector2(-h.halfX, h.halfZ), new THREE.Vector2(h.halfX, h.halfZ), new THREE.Vector2(h.halfX, -h.halfZ)]));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const m = applyGlobals(new THREE.MeshStandardMaterial({ color: 0x3a3028, roughness: 1 }), g);
  const ground = new THREE.Mesh(geo, m);
  ground.receiveShadow = true;
  scene.add(ground);
}

// placeholder stack at the photo pose (9 m x 124 m)
if (q.get('stack') !== '0') {
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 124, 32), applyGlobals(new THREE.MeshStandardMaterial({ color: 0xc8c8cc, metalness: 0.6, roughness: 0.35 }), g, { kelvin: 200 }));
  stack.position.set(0, ANCHORS.vehicleBase.y + 62, 0);
  stack.castShadow = true;
  scene.add(stack);
}

const pad = new PadModule();
await pad.init(sb.ctx);
sb.add(pad);
const w = window as any;
w.app.pad = pad;
w.app.THREE = THREE;
w.app.anchors = ANCHORS;
w.app.look = (p: number[], t: number[]) => sb.setOrbit(p as [number, number, number], t as [number, number, number]);
/** 50% blend of the reference photo over the canvas (photo view). */
w.app.overlay = (a: number) => {
  let img = document.getElementById('ref') as HTMLImageElement | null;
  if (!img) {
    img = document.createElement('img');
    img.id = 'ref';
    img.src = import.meta.env.BASE_URL + '../research/reference.jpeg';
    img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;';
    document.body.appendChild(img);
  }
  img.style.opacity = String(a);
};
// ?colliders=1 draws the collider boxes / cylinders as wireframes (alignment check)
if (q.get('colliders') === '1') {
  const wire = new THREE.MeshBasicMaterial({ color: 0x00ff66, wireframe: true, fog: false });
  for (const c of sb.ctx.colliders) {
    const geo = c.kind === 'box' ? new THREE.BoxGeometry(...(c.size as [number, number, number])) : new THREE.CylinderGeometry(c.radius!, c.radius!, c.height!, 16);
    const m = new THREE.Mesh(geo, wire);
    m.position.set(...c.centre);
    if (c.rotationY) m.rotation.y = c.rotationY;
    scene.add(m);
  }
}
// ?hs=1 draws the hotspot anchors as magenta spheres
if (q.get('hs') === '1') {
  for (const h of sb.ctx.hotspots) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff00ff, fog: false, depthTest: false }));
    m.position.copy(h.position); m.renderOrder = 10; scene.add(m);
  }
}
w.app.info = () => ({ calls: sb.ctx.renderer.info.render.calls, tris: sb.ctx.renderer.info.render.triangles, geos: sb.ctx.renderer.info.memory.geometries, progs: sb.ctx.renderer.info.programs?.length });
console.log('pad hotspots', pad.root.children.length, 'colliders', sb.ctx.colliders.length, 'hotspots', sb.ctx.hotspots.map((h) => h.id).join(','));
const dump: string[] = [];
pad.model!.traverse((o) => { if (o.parent === pad.model) dump.push(o.name); });
console.log('top-level nodes', dump.length, dump.slice(0, 12).join(' '));
sb.start();
