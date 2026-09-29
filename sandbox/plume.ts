// Plume sandbox: a mini version of the real frame graph so the plume can be judged in context.
//   RenderPass (sky dome, ground, placeholder OLM / tower / stack + 33 nozzles, all lit through
//   applyGlobals so the plume LINE LIGHT is visible) → PlumeCompositePass (plume.render(), then
//   out = scene + plume.rgb, standing in for the volume module's composite) → bloom → AgX.
// window.app = { ctx, controls, sb, plume, composer, setMode(id), overlay(alpha) } for scripted shots.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BloomEffect, EffectComposer, EffectPass, Pass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { createSandbox } from './harness.ts';
import { ANCHORS, PHOTO_PRESET } from '../src/scene-config.ts';
import { applyGlobals } from '../src/core/material-hooks.ts';
import { boosterEngines, NOZZLE_EXIT_D, NOZZLE_EXIT_BELOW_PLANE } from '../src/core/engine-layout.ts';
import type { AppContext } from '../src/contracts.ts';
import { ViewMode } from '../src/contracts.ts';
import { PlumeModule } from '../src/fx/plume/PlumeModule.ts';
import common from '../src/shaders/common.glsl?raw';

const DEG = Math.PI / 180;
const params = new URLSearchParams(location.search);

const sb = await createSandbox({ title: 'plume', view: 'photo' });
const { ctx } = sb;
const { renderer, scene, camera, globals: g } = ctx;
renderer.toneMapping = THREE.NoToneMapping; // the post chain tone-maps (AgX)
if (params.get('q')) ctx.quality = { ...ctx.quality, id: params.get('q') as any };
else ctx.quality = { ...ctx.quality, id: 'high' };

// ── lights (harness) + a neutral environment for metal reflections ─────────────
const sun = scene.children.find((o) => (o as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight;
const hemi = scene.children.find((o) => (o as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
scene.background = null;

// ── sky dome (HDR gradient, sun glow toward the low morning sun) ───────────────
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: { uSunDir: g.uSunDir, uViewMode: g.uViewMode, uNight: { value: 0 } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 uSunDir; uniform int uViewMode; uniform float uNight; varying vec3 vDir;
  ${common}
  void main(){
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 zen = vec3(0.05, 0.22, 0.62), hor = vec3(0.42, 0.55, 0.62);
    vec3 c = mix(hor, zen, pow(h, 0.45)) * 1.25;
    c += vec3(1.0, 0.62, 0.35) * 0.6 * pow(max(dot(d, uSunDir), 0.0), 8.0);
    if (d.y < 0.0) c = vec3(0.12, 0.1, 0.09);
    c *= mix(1.0, 0.0025, uNight);
    if (uViewMode == VIEW_THERMAL) c = sl_thermalRamp(230.0);
    gl_FragColor = vec4(c, 1.0);
  }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 16), skyMat);
sky.frustumCulled = false;
scene.add(sky);

// ── placeholder world, all through applyGlobals (plume line light, thermal, clay, fog) ─────────
const std = (color: number, rough = 0.9, metal = 0, kelvin?: string) =>
  applyGlobals(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }), g, kelvin ? { kelvinExpr: kelvin } : {});

const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), std(0x3b2e26, 1));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const padSlab = new THREE.Mesh(new THREE.BoxGeometry(120, 0.4, 90), std(0x6a6058, 0.95));
padSlab.position.set(0, 0.2, -5);
scene.add(padSlab);

// OLM: a square deck at 20 m with the central booster opening, on six columns
const olm = new THREE.Group();
const deckMat = std(0x77746f, 0.7, 0.3);
const deckH = 3, deckOuter = 30, hole = 11;
const side = (deckOuter - hole) / 2;
for (const [x, z, sx, sz] of [
  [0, -(hole + side) / 2, deckOuter, side], [0, (hole + side) / 2, deckOuter, side],
  [-(hole + side) / 2, 0, side, hole], [(hole + side) / 2, 0, side, hole],
] as const) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, deckH, sz), deckMat);
  m.position.set(x, ANCHORS.olmTableTopY - deckH / 2, z);
  olm.add(m);
}
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2 + 0.5;
  const col = new THREE.Mesh(new THREE.BoxGeometry(3, ANCHORS.olmTableTopY - deckH, 3), deckMat);
  col.position.set(Math.cos(a) * 12.5, (ANCHORS.olmTableTopY - deckH) / 2, Math.sin(a) * 12.5);
  olm.add(col);
}
scene.add(olm);

// tower + chopsticks (rusty red)
const towerMat = std(0x7a3b30, 0.8, 0.2);
const tower = new THREE.Mesh(new THREE.BoxGeometry(12.5, ANCHORS.towerHeight, 12.5), towerMat);
tower.position.set(ANCHORS.towerBase.x, ANCHORS.towerHeight / 2, ANCHORS.towerBase.z);
scene.add(tower);
for (const s of [-1, 1]) {
  const arm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.5, 26), towerMat);
  arm.position.set(ANCHORS.towerBase.x + s * 9, 124, ANCHORS.towerBase.z + 17);
  arm.rotation.y = -s * 28 * DEG;
  scene.add(arm);
}

// stack: booster (steel) + ship (black), with 33 nozzle bells below the engine plane
const stack = new THREE.Group();
stack.position.copy(ANCHORS.vehicleBase);
stack.rotation.y = ANCHORS.vehicleYawDeg * DEG;
const boosterL = 72.3, shipL = 52.1;
const booster = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, boosterL, 48, 1, true), std(0xb9b4ae, 0.38, 0.85, 'vSlObjPos.y < 30.0 ? 110.0 : 280.0'));
booster.position.y = boosterL / 2;
const ship = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, shipL - 12, 48), std(0x1b1a1a, 0.6, 0.1));
ship.position.y = boosterL + (shipL - 12) / 2;
const nose = new THREE.Mesh(new THREE.ConeGeometry(4.5, 12, 48), std(0x1b1a1a, 0.6, 0.1));
nose.position.y = boosterL + shipL - 6;
const aftDome = new THREE.Mesh(new THREE.CircleGeometry(4.5, 48), std(0x8a8580, 0.5, 0.7));
aftDome.rotation.x = Math.PI / 2;
aftDome.position.y = 0.9;
stack.add(booster, ship, nose, aftDome);
const bellGeo = new THREE.CylinderGeometry(0.28, NOZZLE_EXIT_D / 2, 1.5, 24, 1, true);
const bellMat = std(0x5a5550, 0.45, 0.8, '900.0');
bellMat.side = THREE.DoubleSide;
for (const e of boosterEngines()) {
  const b = new THREE.Mesh(bellGeo, bellMat);
  b.position.set(e.x, -NOZZLE_EXIT_BELOW_PLANE + 0.75, e.z);
  stack.add(b);
}
scene.add(stack);

// ── the module under test ─────────────────────────────────────────────────────
const plume = new PlumeModule();
await plume.init(ctx);
sb.add(plume);

// ── mini pipeline ─────────────────────────────────────────────────────────────
/** Stand-in for the volume module's composite: out = scene + plume.rgb (no clouds). */
class PlumeCompositePass extends Pass {
  private mat: THREE.ShaderMaterial;
  constructor(private plumeMod: PlumeModule, private c: AppContext) {
    super('PlumeCompositePass');
    this.needsDepthTexture = true;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tPlume: { value: null }, uPlumeOnly: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
      fragmentShader: `uniform sampler2D tScene; uniform sampler2D tPlume; uniform float uPlumeOnly; varying vec2 vUv;
        void main(){ vec4 p = texture2D(tPlume, vUv); vec3 s = texture2D(tScene, vUv).rgb;
          gl_FragColor = vec4(mix(s, vec3(0.0), uPlumeOnly) + p.rgb, 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    this.fullscreenMaterial = this.mat;
  }
  override setDepthTexture(depthTexture: THREE.Texture): void {
    this.c.targets.sceneDepth = depthTexture as THREE.DepthTexture;
  }
  override render(r: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget): void {
    this.plumeMod.render(r, this.c.camera);
    this.mat.uniforms.tScene.value = inputBuffer.texture;
    this.mat.uniforms.tPlume.value = this.plumeMod.target.texture;
    r.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    r.render(this.scene, this.camera);
  }
  setPlumeOnly(v: boolean) { this.mat.uniforms.uPlumeOnly.value = v ? 1 : 0; }
}

const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
composer.addPass(new RenderPass(scene, camera));
const compositePass = new PlumeCompositePass(plume, ctx);
composer.addPass(compositePass);
const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.35, intensity: 0.5, radius: 0.7 });
const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
composer.addPass(new EffectPass(camera, bloom, tone));

const resize = () => composer.setSize(innerWidth, innerHeight, false);
sb.start((dt) => composer.render(dt));
addEventListener('resize', resize);
resize();

// ── presets for the screenshots ───────────────────────────────────────────────
function setMode(id: 'photo' | 'night' | 'thermal' | 'clay') {
  const night = id === 'night';
  g.uViewMode.value = id === 'thermal' ? ViewMode.Thermal : id === 'clay' ? ViewMode.Clay : ViewMode.Photo;
  sun.intensity = night ? 0 : PHOTO_PRESET.sun.intensity;
  hemi.intensity = night ? 0.02 : PHOTO_PRESET.ambient.intensity;
  scene.environmentIntensity = night ? 0.01 : 0.35;
  skyMat.uniforms.uNight.value = night ? 1 : 0;
  g.uFogColor.value.copy(night ? new THREE.Color(0.002, 0.002, 0.003) : PHOTO_PRESET.fog.color);
}

// reference photo overlay (50 % blend check of the calibrated photo camera)
const img = document.createElement('img');
img.src = '/research/reference.jpeg';
img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;opacity:0';
document.body.appendChild(img);
const overlay = (a: number) => { img.style.opacity = String(a); };

Object.assign((window as any).app, {
  plume, composer, bloom, setMode, overlay,
  plumeOnly: (v: boolean) => compositePass.setPlumeOnly(v),
  look: plume.look,
});

/** Debug: read the plume target (rgb emission, a = distance) under a CSS pixel. */
function probe(x: number, y: number): number[] {
  const t = plume.target;
  const px = Math.round((x / innerWidth) * t.width), py = Math.round((1 - y / innerHeight) * t.height);
  try {
    const buf = new Uint16Array(4);
    renderer.readRenderTargetPixels(t, px, py, 1, 1, buf);
    return Array.from(buf).map((v) => +THREE.DataUtils.fromHalfFloat(v).toFixed(2));
  } catch {
    const f = new Float32Array(4);
    renderer.readRenderTargetPixels(t, px, py, 1, 1, f);
    return Array.from(f).map((v) => +v.toFixed(2));
  }
}
(window as any).app.probe = probe;
