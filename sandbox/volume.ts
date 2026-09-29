// Sandbox for the volumetric launch clouds (src/fx/volume). A mini frame graph like core's:
//   RenderPass (sky dome, ground, ocean, stack, tower, OLM placeholders)
//   -> PlumePlaceholderPass (additive cylinder into its own HalfFloat target, a = view distance)
//   -> VolumePass (march + composite) -> EffectPass(ToneMappingEffect AGX)
// URL params: ?q=low|medium|high|ultra  &view=photo|orbit|inside  &preset=photo|night|noon
// window.app adds: vol (VolumeModule), setPreset(id), setViewMode(n), overlay(opacity), views.*, stats()
import * as THREE from 'three';
import GUI from 'lil-gui';
import { EffectComposer, EffectPass, Pass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { createSandbox } from './harness.ts';
import { ANCHORS, PHOTO_PRESET, QUALITY, dirFromHeading } from '../src/scene-config.ts';
import { applyGlobals } from '../src/core/material-hooks.ts';
import { ViewMode, type LightingPreset, type QualityId } from '../src/contracts.ts';
import { VolumeModule, blackbodyColor } from '../src/fx/volume/index.ts';

const qs = new URLSearchParams(location.search);
const qid = (qs.get('q') ?? 'medium') as QualityId;

const sb = await createSandbox({ title: 'Volume (launch clouds)', lights: true });
const { ctx } = sb;
const { renderer, scene, camera, globals: g } = ctx;
renderer.toneMapping = THREE.NoToneMapping;       // AgX is applied by the ToneMappingEffect
ctx.quality = QUALITY[qid] ?? QUALITY.medium;
renderer.setPixelRatio(Math.min(devicePixelRatio, ctx.quality.pixelRatio));

// ── placeholder scene ──────────────────────────────────────────────────────
scene.background = null;
const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: true,
  uniforms: { uSunDir: g.uSunDir, uSunColor: g.uSunColor, uNight: { value: 0 } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `varying vec3 vDir; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uNight;
    void main(){
      vec3 d = normalize(vDir); float h = d.y;
      vec3 zen = vec3(0.012, 0.20, 0.52), hor = vec3(0.30, 0.46, 0.52);
      vec3 c = mix(hor, zen, pow(clamp(h, 0.0, 1.0), 0.5));
      c += vec3(1.0, 0.6, 0.3) * 0.25 * pow(max(dot(d, uSunDir), 0.0), 8.0);
      if (h < 0.0) c = hor * 0.5;
      c = mix(c, vec3(0.004, 0.007, 0.018) * (1.0 + h), uNight);
      gl_FragColor = vec4(c * 1.15, 1.0);
    }`,
}));
sky.frustumCulled = false;
scene.add(sky);

const std = (color: number, rough = 1, metal = 0, kelvin?: string) =>
  applyGlobals(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }), g, kelvin ? { kelvinExpr: kelvin } : {});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), std(0x3a2b22));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const ocean = new THREE.Mesh(new THREE.PlaneGeometry(10000, 20000), std(0x2c4650, 0.25));
ocean.rotation.x = -Math.PI / 2;
ocean.position.set(750 + 5000, 0.6, 0);
scene.add(ocean);
const booster = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 72.3, 32), std(0x9f9080, 0.5, 0.6, 'vSlObjPos.y < 0.0 ? 110.0 : 280.0'));
booster.position.set(0, ANCHORS.vehicleBase.y + 36.15, 0);
const ship = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 4.5, 52, 32), std(0x1d1b1a, 0.6));
ship.position.set(0, ANCHORS.vehicleBase.y + 72.3 + 26, 0);
const tower = new THREE.Mesh(new THREE.BoxGeometry(12.5, ANCHORS.towerHeight, 12.5), std(0x7b5958, 0.8));
tower.position.set(ANCHORS.towerBase.x, ANCHORS.towerHeight / 2, ANCHORS.towerBase.z);
const olm = new THREE.Mesh(new THREE.BoxGeometry(34, 20, 34), std(0x777777, 0.9));
olm.position.set(0, 10, 0);
scene.add(booster, ship, tower, olm);

// plume light like the plume module (LIGHT_COLOUR x LIGHT_INTENSITY)
const PLUME_LIGHT = blackbodyColor(2700).lerp(new THREE.Color(1.0, 0.62, 0.72), 0.15).multiplyScalar(0.2);
g.uPlumeLight.value.copy(PLUME_LIGHT);

// ── placeholder plume pass: additive column into its own target, a = view distance ──
class PlumePlaceholderPass extends Pass {
  readonly rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
  private readonly pScene = new THREE.Scene();
  private readonly mat: THREE.ShaderMaterial;
  constructor() {
    super('PlumePlaceholderPass');
    this.needsSwap = false;
    this.needsDepthTexture = true;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uSceneDepth: { value: null }, uNear: { value: 0.5 }, uFar: { value: 60000 }, uRes: { value: new THREE.Vector2(1, 1) }, uViewMode: g.uViewMode },
      vertexShader: `varying vec3 vW; varying vec3 vN; varying float vY;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vY = uv.y;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D uSceneDepth; uniform float uNear; uniform float uFar; uniform vec2 uRes; uniform int uViewMode;
        varying vec3 vW; varying vec3 vN; varying float vY;
        float lin(float d){ float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          float fz = lin(gl_FragCoord.z);
          float sz = lin(texture2D(uSceneDepth, gl_FragCoord.xy / uRes).r);
          if (sz < fz - 1.0) discard;
          float core = pow(abs(dot(normalize(vN), V)), 2.0);
          vec3 col = mix(vec3(1.0, 0.55, 0.25), vec3(1.0, 0.86, 0.9), core) * (6.0 + 30.0 * core) * mix(0.6, 1.0, vY);
          if (uViewMode == 1) col = vec3(1.0, 1.0, 0.9) * 4.0;
          gl_FragColor = vec4(col * core, length(cameraPosition - vW));
        }`,
      depthTest: true, depthWrite: true,
    });
    const A = ANCHORS.vehicleBase, B = ANCHORS.plumeImpact;
    const h = A.y - B.y;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(5.0, 11, h, 40, 1, true), this.mat);
    cyl.position.set(0, (A.y + B.y) / 2, 0);
    this.pScene.add(cyl);
  }
  override setDepthTexture(t: THREE.Texture): void { this.mat.uniforms.uSceneDepth.value = t; }
  override setSize(w: number, h: number): void { this.rt.setSize(w, h); this.mat.uniforms.uRes.value.set(w, h); }
  override render(r: THREE.WebGLRenderer): void {
    this.mat.uniforms.uNear.value = camera.near; this.mat.uniforms.uFar.value = camera.far;
    const prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(this.pScene, camera);
    r.setClearColor(prevColor, prevAlpha);
  }
}

// ── the module under test ─────────────────────────────────────────────────
const vol = new VolumeModule();
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
const plumePass = new PlumePlaceholderPass();
composer.addPass(new RenderPass(scene, camera));
composer.addPass(plumePass);
ctx.targets.plume = plumePass.rt.texture;
const tBake = performance.now();
await vol.init(ctx);
const bakeMs = performance.now() - tBake;
composer.addPass(vol.pass);
const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
composer.addPass(new EffectPass(camera, toneMapping));
sb.add(vol);

const onResize = () => composer.setSize(innerWidth, innerHeight, false);
addEventListener('resize', onResize);

// ── presets (mirrors of the post module's values; the sandbox must not depend on its file) ──
const night: LightingPreset = {
  ...PHOTO_PRESET, id: 'night', label: { en: 'Night', fi: 'Yö' },
  sun: { dir: dirFromHeading(95, -15), color: new THREE.Color(0.4, 0.5, 0.8), intensity: 0 },
  ambient: { sky: new THREE.Color(0.025, 0.04, 0.09), ground: new THREE.Color(0.012, 0.012, 0.018), intensity: 1 },
  plumeLightScale: 1.3, exposure: 1.7, fog: { color: new THREE.Color(0.012, 0.02, 0.045), density: 0.00006 },
};
const noon: LightingPreset = {
  ...PHOTO_PRESET, id: 'noon', label: { en: 'Noon', fi: 'Keskipäivä' },
  sun: { dir: dirFromHeading(170, 65), color: new THREE.Color(1.0, 0.95, 0.88), intensity: 5.2 },
  ambient: { sky: new THREE.Color(0.36, 0.52, 0.8), ground: new THREE.Color(0.2, 0.17, 0.13), intensity: 1.15 },
  plumeLightScale: 0.55, exposure: 0.85, fog: { color: new THREE.Color(0.68, 0.78, 0.9), density: 0.00009 },
};
const PRESETS: Record<string, LightingPreset> = { photo: PHOTO_PRESET, night, noon };
const lights = { sun: null as THREE.DirectionalLight | null, hemi: null as THREE.HemisphereLight | null };
scene.traverse((o) => {
  if ((o as THREE.DirectionalLight).isDirectionalLight) lights.sun = o as THREE.DirectionalLight;
  if ((o as THREE.HemisphereLight).isHemisphereLight) lights.hemi = o as THREE.HemisphereLight;
});
function setPreset(id: string): void {
  const p = PRESETS[id] ?? PHOTO_PRESET;
  g.uSunDir.value.copy(p.sun.dir);
  g.uSunColor.value.copy(p.sun.color).multiplyScalar(p.sun.intensity);
  g.uSkyAmbient.value.copy(p.ambient.sky).multiplyScalar(p.ambient.intensity);
  g.uGroundAmbient.value.copy(p.ambient.ground).multiplyScalar(p.ambient.intensity);
  g.uFogColor.value.copy(p.fog.color);
  g.uFogDensity.value = p.fog.density;
  g.uPlumeLight.value.copy(PLUME_LIGHT).multiplyScalar(p.plumeLightScale);
  renderer.toneMappingExposure = p.exposure;
  if (lights.sun) { lights.sun.color.copy(p.sun.color); lights.sun.intensity = p.sun.intensity; lights.sun.position.copy(p.sun.dir).multiplyScalar(2000); }
  if (lights.hemi) { lights.hemi.color.copy(p.ambient.sky); lights.hemi.groundColor.copy(p.ambient.ground); lights.hemi.intensity = p.ambient.intensity; }
  (sky.material as THREE.ShaderMaterial).uniforms.uNight.value = id === 'night' ? 1 : 0;
  ctx.preset = p;
  vol.onPreset(p);
  ctx.events.emit({ type: 'preset', preset: p });
}
function setViewMode(m: number): void { g.uViewMode.value = m; ctx.events.emit({ type: 'reset-accumulation' }); }

// ── photo overlay for alignment checks ──────────────────────────────────────
const img = document.createElement('img');
img.src = '/research/reference.jpeg';
img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:fill;opacity:0;pointer-events:none';
document.body.appendChild(img);
const overlay = (o: number) => { img.style.opacity = String(o); };

// ── camera presets ─────────────────────────────────────────────────────────
const views = {
  photo: () => sb.setPhotoView(),
  orbit: () => sb.setOrbit([-700, 520, 1050], [60, 90, 40]),        // ~1.2 km from the pad
  inside: () => { camera.near = 0.3; sb.setOrbit([150, 22, 262], [60, 40, 60]); camera.fov = 70; camera.updateProjectionMatrix(); },
  walk: () => { sb.setOrbit([ANCHORS.walkSpawn.pos.x, 1.7, ANCHORS.walkSpawn.pos.z], [0, 30, 0]); camera.fov = 65; camera.updateProjectionMatrix(); },
  east: () => sb.setOrbit([900, 160, 300], [150, 110, 60]),
  top: () => sb.setOrbit([0, 1500, 300], [0, 0, 0]),
};

// ── reflection path test: mirror the camera in the ground plane, render the scene + volume
//    (vol.renderReflection) into a HalfFloat target with a DepthTexture and show it in a corner.
const reflRT = new THREE.WebGLRenderTarget(480, 270, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(480, 270, THREE.FloatType) });
const mirrorCam = new THREE.PerspectiveCamera();
const reflQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { uTex: { value: reflRT.texture } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D uTex; varying vec2 vUv; void main(){ vec3 c = texture2D(uTex, vUv).rgb; c = c / (1.0 + c); gl_FragColor = vec4(pow(c, vec3(1.0/2.2)), 1.0); }',
  depthTest: false, depthWrite: false,
}));
reflQuad.frustumCulled = false;
const reflScene = new THREE.Scene();
reflScene.add(reflQuad);
let showRefl = false;
function renderReflectionTest(): void {
  mirrorCam.copy(camera);
  mirrorCam.position.y = -camera.position.y;
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  fwd.y = -fwd.y;
  mirrorCam.up.set(0, 1, 0);
  mirrorCam.lookAt(mirrorCam.position.clone().add(fwd));
  mirrorCam.aspect = reflRT.width / reflRT.height;
  mirrorCam.updateProjectionMatrix();
  mirrorCam.updateMatrixWorld();
  const prevGround = ground.visible, prevOcean = ocean.visible;
  ground.visible = false; ocean.visible = false;       // the mirror plane itself
  renderer.setRenderTarget(reflRT);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, true, false);
  renderer.render(scene, mirrorCam);
  ground.visible = prevGround; ocean.visible = prevOcean;
  vol.renderReflection(mirrorCam, reflRT);
  renderer.setRenderTarget(null);
}

// ── frame timing (headless SwiftShader numbers are only a relative guide) ──
const times: number[] = [];
let last = performance.now();
// debug: horizontal slice of the baked density (top view), app.slice(heightMetres) / app.slice(null)
const sliceMat = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: { uTex: { value: null }, uY: { value: 0.1 }, uChan: { value: 0 }, uAxis: { value: 0 } },
  vertexShader: 'out vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `precision highp sampler3D; uniform sampler3D uTex; uniform float uY; uniform int uChan; uniform int uAxis; in vec2 vUv; out vec4 o;
    void main(){ vec4 v = texture(uTex, uAxis == 0 ? vec3(vUv.x, uY, 1.0 - vUv.y) : uAxis == 1 ? vec3(vUv.x, vUv.y, uY) : vec3(vUv.x * 3.0 - 1.0, vUv.y * 3.0 - 1.0, uY)); float x = uChan == 0 ? v.r : uChan == 1 ? v.g : uChan == 2 ? v.b : v.a;
      o = vec4(vec3(x), 1.0); }`,
});
const sliceScene = new THREE.Scene();
const sliceQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sliceMat);
sliceQuad.frustumCulled = false;
sliceScene.add(sliceQuad);
let sliceY: number | null = null;
const slice = (y: number | null, tex: 'density' | 'lightA' | 'shape' | 'detail' = 'density', chan = 0, axis = 0) => {
  sliceY = y;
  const t = vol.getTextures();
  const b = (vol as any).baker;
  sliceMat.uniforms.uTex.value = tex === 'density' ? t?.density : tex === 'lightA' ? t?.lightA : tex === 'shape' ? b.shape.texture : b.detail.texture;
  sliceMat.uniforms.uChan.value = chan;
  sliceMat.uniforms.uAxis.value = axis;
  if (y !== null) sliceMat.uniforms.uY.value = axis === 0 ? (y - ANCHORS.volumeBounds.min.y) / (ANCHORS.volumeBounds.max.y - ANCHORS.volumeBounds.min.y) : y;
};

sb.start((dt) => {
  if (sliceY !== null) { renderer.setRenderTarget(null); renderer.render(sliceScene, sb.ctx.camera); return; }
  composer.render(dt);
  if (showRefl) {
    renderReflectionTest();
    const c = renderer.domElement;
    renderer.setViewport(0, 0, Math.round(c.width * 0.4 / renderer.getPixelRatio()), Math.round(c.height * 0.4 / renderer.getPixelRatio()));
    renderer.render(reflScene, camera);
    renderer.setViewport(0, 0, c.width / renderer.getPixelRatio(), c.height / renderer.getPixelRatio());
  }
  const now = performance.now();
  times.push(now - last); last = now;
  if (times.length > 60) times.shift();
});
onResize();

const initialPreset = qs.get('preset') ?? 'photo';
setPreset(initialPreset);
const v = qs.get('view') as keyof typeof views | null;
if (v && views[v]) views[v]();

// ── GUI ─────────────────────────────────────────────────────────────────
const gui = new GUI({ title: 'volume' });
const p = vol.params;
gui.add({ preset: initialPreset }, 'preset', Object.keys(PRESETS)).onChange(setPreset);
gui.add({ mode: 0 }, 'mode', { Photo: ViewMode.Photo, Thermal: ViewMode.Thermal, Clay: ViewMode.Clay }).onChange(setViewMode);
gui.add({ view: 'photo' }, 'view', Object.keys(views)).onChange((k: keyof typeof views) => views[k]());
gui.add({ overlay: 0 }, 'overlay', 0, 1, 0.05).onChange(overlay);
gui.add(vol.pass, 'debug', { composite: 0, volume: 1, transmittance: 2 });
gui.add({ drift: false }, 'drift').onChange((d: boolean) => { g.uDrift.value = d ? 1 : 0; ctx.events.emit({ type: 'drift', enabled: d }); });
gui.add(renderer, 'toneMappingExposure', 0.1, 4, 0.01).name('exposure');
const fl = gui.addFolder('medium');
fl.add(p, 'sigma', 0.02, 0.4, 0.005); fl.add(p, 'albedo', 0.8, 1, 0.001);
fl.add(p, 'shapeAmount', 0, 1, 0.01); fl.add(p, 'shapeScale', 100, 1200, 10);
fl.add(p, 'detailAmount', 0, 1, 0.01); fl.add(p, 'detailScale', 10, 200, 1);
const ll = gui.addFolder('light');
ll.add(p, 'sunGain', 0, 4, 0.01); ll.add(p, 'ambientGain', 0, 4, 0.01); ll.add(p, 'plumeGain', 0, 40, 0.1);
ll.add(p, 'emissionGain', 0, 4, 0.01); ll.add(p, 'fireLightGain', 0, 40, 0.1); ll.add(p, 'fireLightKelvin', 1200, 3500, 10);
ll.add(p, 'sunTauScale', 0, 1.5, 0.01); ll.add(p, 'powder', 0, 1, 0.01);
ll.add(p, 'hgForward', 0, 0.95, 0.01); ll.add(p, 'hgBack', -0.9, 0, 0.01); ll.add(p, 'hgMix', 0, 1, 0.01);
ll.add(p, 'msA', 0, 1, 0.01); ll.add(p, 'msB', 0, 1, 0.01); ll.add(p, 'msC', 0, 1, 0.01);
gui.close();
if (qs.has('nogui')) gui.hide();

// HDR probe: linear radiance of the volume composite at canvas pixels (x, y from the top-left)
const probeBuf = new Uint16Array(4);   // the composer buffers are HalfFloat
const origRender = vol.pass.render.bind(vol.pass);
let probeReq: [number, number][] | null = null;
let probeOut: number[][] = [];
vol.pass.render = (r: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget) => {
  origRender(r, input, output);
  if (probeReq) {
    probeOut = probeReq.map(([x, y]) => {
      r.readRenderTargetPixels(output, Math.round(x), Math.round(output.height - 1 - y), 1, 1, probeBuf);
      return Array.from(probeBuf.slice(0, 3)).map((v) => +THREE.DataUtils.fromHalfFloat(v).toFixed(3));
    });
    probeReq = null;
  }
};
const probe = async (pts: [number, number][]) => { probeReq = pts; await new Promise((res) => setTimeout(res, 1500)); return probeOut; };

const setDrift = (on: boolean) => { g.uDrift.value = on ? 1 : 0; ctx.events.emit({ type: 'drift', enabled: on }); };
const setQualityId = (id: QualityId) => {
  const q = QUALITY[id];
  ctx.quality = q;
  vol.onQuality(q);
  ctx.events.emit({ type: 'quality', quality: q });
};
Object.assign((window as any).app, {
  vol, composer, setPreset, setViewMode, overlay, views, gui, slice, probe, setDrift, setQualityId,
  reflection: (on: boolean) => { showRefl = on; },
  stats: () => ({
    bakeMs: Math.round(bakeMs), timings: vol.getTextures() && (vol as any).baker?.timings,
    frameMs: times.length ? +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : 0,
    accumulated: vol.pass.accumulated, quality: ctx.quality.id,
    size: [renderer.domElement.width, renderer.domElement.height],
  }),
});
