// Sandbox for src/post: test scene + the real post chain (pmndrs EffectComposer) + a GUI.
// The test scene is deliberately photo-like (blue sky dome, cream cloud billows, orange steam,
// a stack, a tower and an HDR plume cylinder) so the grade can be judged against the reference.
//
// window.app.post exposes: chain, composer, setPreset(id), debug(mode), measure(colours),
// invert(hexes), exportTest(scale). See the screenshot steps in out/post/steps*.json.
import * as THREE from 'three';
import GUI from 'lil-gui';
import { EffectComposer, RenderPass, EffectPass, Effect, BlendFunction } from 'postprocessing';
import { createSandbox } from './harness.ts';
import { ANCHORS, PHOTO_PRESET, QUALITY } from '../src/scene-config.ts';
import { applyGlobals } from '../src/core/material-hooks.ts';
import { createPostChain, PRESETS, PRESET_ORDER, applyPresetToGlobals, nextPreset, exportStill } from '../src/post/index.ts';
import type { LightingPresetId, QualityId } from '../src/contracts.ts';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import common from '../src/shaders/common.glsl?raw';

const sb = await createSandbox({ title: 'post-processing', ground: false });
const ctx = sb.ctx;
const { renderer, scene, camera, globals } = ctx;
renderer.toneMapping = THREE.NoToneMapping;          // the post chain owns tone mapping
renderer.setPixelRatio(1);
globals.uPlumeLight.value.setRGB(1.0, 0.5, 0.2).multiplyScalar(2.2);

// ── sky dome (linear HDR) ───────────────────────────────────────────────────────────────────
const skyU = {
  // Linear radiances found with app.post.invert() so the graded sky lands on the palette swatches
  // (#127ebe zenith, #7fa5c2 mid, #8bb4bc horizon).
  uZenith: { value: new THREE.Color(0.0066, 0.13, 0.327) },
  uMid: { value: new THREE.Color(0.17, 0.3, 0.5) },
  uHorizon: { value: new THREE.Color(0.2, 0.42, 0.5) },
  uScale: { value: 1 },
  uViewMode: globals.uViewMode,
  uSunDir: globals.uSunDir,
  uSunGlow: { value: new THREE.Color(1, 0.7, 0.4) },
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(30000, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: skyU,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 uZenith, uMid, uHorizon, uSunGlow, uSunDir; uniform float uScale; uniform int uViewMode;
      varying vec3 vDir;
      ${common}
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.12, h));
        c = mix(c, uZenith, smoothstep(0.08, 0.4, h));
        c += uSunGlow * 0.5 * pow(max(dot(d, uSunDir), 0.0), 6.0);
        c *= uScale;
        if (d.y < 0.0) c = uHorizon * uScale * 0.5;
        if (uViewMode == 1) c = sl_thermalRamp(230.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }),
);
sky.renderOrder = -10; sky.frustumCulled = false;
scene.add(sky);

// ── ground ──────────────────────────────────────────────────────────────────────────────────
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), applyGlobals(new THREE.MeshStandardMaterial({ color: 0x4a3a30, roughness: 0.95 }), globals, { kelvin: 295 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.receiveShadow = true; scene.add(ground);
const sea = new THREE.Mesh(new THREE.PlaneGeometry(40000, 20000), applyGlobals(new THREE.MeshStandardMaterial({ color: 0x1d3a44, roughness: 0.35, metalness: 0.0 }), globals, { kelvin: 288 }));
sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.2, -12000); scene.add(sea);

// ── vehicle placeholder (booster + ship), tower, OLM ────────────────────────────────────────
const steel = applyGlobals(new THREE.MeshStandardMaterial({ color: 0xb8b4ae, metalness: 0.85, roughness: 0.32 }), globals, { kelvinExpr: 'vSlObjPos.y < 0.0 ? 900.0 : 285.0' });
const black = applyGlobals(new THREE.MeshStandardMaterial({ color: 0x1a1918, metalness: 0.4, roughness: 0.5 }), globals, { kelvin: 290 });
const base = ANCHORS.vehicleBase.y;
const booster = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 72.3, 40), steel); booster.position.y = base + 36.2;
const ship = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 40, 40), black); ship.position.y = base + 72.3 + 20;
const nose = new THREE.Mesh(new THREE.ConeGeometry(4.5, 14, 40), black); nose.position.y = base + 72.3 + 47;
scene.add(booster, ship, nose);
const red = applyGlobals(new THREE.MeshStandardMaterial({ color: 0x8a5a55, roughness: 0.6, metalness: 0.2 }), globals, { kelvin: 292 });
const tower = new THREE.Mesh(new THREE.BoxGeometry(12.5, ANCHORS.towerHeight, 12.5), red);
tower.position.set(ANCHORS.towerBase.x, ANCHORS.towerHeight / 2, ANCHORS.towerBase.z);
scene.add(tower);
const olm = new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), applyGlobals(new THREE.MeshStandardMaterial({ color: 0x6a5c58, roughness: 0.8 }), globals, { kelvin: 300 }));
olm.position.y = 10; scene.add(olm);

// ── cloud billows: lit spheres. Steam near the pad, cumulus at altitude ──────────────────────
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const cloudMat = applyGlobals(new THREE.MeshStandardMaterial({ color: 0xf4f0ea, roughness: 1.0 }), globals, { kelvin: 300 });
// Cauliflower-ish billow: icosphere displaced by a few octaves of value noise.
function vnoise(x: number, y: number, z: number): number {
  const h = (a: number, b: number, c: number) => { let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2147483647); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  let acc = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
    acc += h(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return acc;
}
function billow(r: number): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(r, 4);
  geo.deleteAttribute('normal'); geo.deleteAttribute('uv');
  geo = mergeVertices(geo, 1e-3 * r);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const off = rnd() * 100;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / r, y = pos.getY(i) / r, z = pos.getZ(i) / r;
    const n = vnoise(x * 3 + off, y * 3 + off, z * 3 + off) * 0.6 + vnoise(x * 7 + off, y * 7 + off, z * 7 + off) * 0.3 + vnoise(x * 15 + off, y * 15 + off, z * 15 + off) * 0.1;
    const k = 0.82 + 0.4 * n;
    pos.setXYZ(i, x * r * k, y * r * k, z * r * k);
  }
  geo.computeVertexNormals();
  return geo;
}
function cluster(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, n: number, rmin: number, rmax: number): void {
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, v = rnd() * 2 - 1, w = rnd() * 2 - 1;
    if (u * u + v * v + w * w > 1) { i--; continue; }
    const r = rmin + (rmax - rmin) * Math.pow(rnd(), 1.5);
    const m = new THREE.Mesh(billow(r), cloudMat);
    m.position.set(cx + u * rx, cy + v * ry * (v < 0 ? 0.6 : 1) + ry * 0.4, cz + w * rz);
    scene.add(m);
  }
}
const camDir = new THREE.Vector3(Math.sin(26.8 * Math.PI / 180), 0, -Math.cos(26.8 * Math.PI / 180));
const camRight = new THREE.Vector3(camDir.z * -1, 0, camDir.x).normalize();   // right of the view direction (y up)
const at = (along: number, side: number, y: number) => new THREE.Vector3().addScaledVector(camDir, along).addScaledVector(camRight, side).setY(y);
{
  // steam: left and right masses beside the plume
  let p = at(-20, -170, 60); cluster(p.x, p.y, p.z, 110, 60, 60, 60, 16, 42);
  p = at(-10, 250, 90); cluster(p.x, p.y, p.z, 170, 100, 90, 90, 22, 62);
  // cumulus behind
  p = at(2200, 200, 760); cluster(p.x, p.y, p.z, 900, 260, 500, 34, 160, 420);
  p = at(2600, -1300, 800); cluster(p.x, p.y, p.z, 700, 200, 300, 16, 120, 300);
}
// fireball stand-in (volume module owns the real one): bright HDR blobs at the base
const fireMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 5.2, 1.6), toneMapped: false });
for (let i = 0; i < 9; i++) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(9 + rnd() * 9, 20, 14), fireMat);
  m.position.set((rnd() - 0.5) * 60, 6 + rnd() * 10, (rnd() - 0.5) * 30); m.scale.y = 0.6; scene.add(m);
}

// ── plume stand-in: HDR cylinder rendered into its own HalfFloat target (a = view distance) ──
const plumeScene = new THREE.Scene();
const plumeMat = new THREE.ShaderMaterial({
  side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: false,
  uniforms: { uTop: { value: base }, uBot: { value: -4 } },
  vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: `
    uniform float uTop, uBot; varying vec3 vW;
    void main(){
      vec3 ro = cameraPosition; vec3 rd = normalize(vW - ro);
      float t = -dot(ro.xz, rd.xz) / max(dot(rd.xz, rd.xz), 1e-6);   // closest approach to the vertical axis
      vec3 p = ro + rd * t;
      float b = length(p.xz), y = p.y;
      float s = clamp((uTop - y) / (uTop - uBot), 0.0, 1.0);          // 0 at the nozzles, 1 at the ground
      float R = 9.0 + 16.0 * s;
      float core = exp(-pow(b / (0.42 * R), 2.0)) * mix(38.0, 22.0, s);
      float sheath = exp(-pow(b / R, 2.0)) * 5.5;
      vec3 col = core * vec3(1.0, 0.86, 0.88) + sheath * vec3(1.0, 0.5, 0.26);
      float fade = smoothstep(0.0, 0.03, s) * (1.0 - smoothstep(0.93, 1.0, s));
      col *= fade;
      float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
      if (L < 1e-3 || y > uTop || y < uBot) discard;
      gl_FragColor = vec4(col, t);
    }`,
});
const plumeMesh = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, base + 4, 24, 1, true), plumeMat);
plumeMesh.position.y = (base - 4) / 2; plumeMesh.frustumCulled = false;
plumeScene.add(plumeMesh);
const plumeRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false });
ctx.targets.plume = plumeRT.texture;

class AddTextureEffect extends Effect {
  constructor(tex: THREE.Texture) {
    super('AddPlume', 'uniform sampler2D tPlume; void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){ outputColor = vec4(inputColor.rgb + texture2D(tPlume, uv).rgb, 1.0); }',
      { blendFunction: BlendFunction.NORMAL, uniforms: new Map<string, THREE.Uniform>([['tPlume', new THREE.Uniform(tex)]]) });
  }
}

// ── composer + post chain ───────────────────────────────────────────────────────────────────
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
composer.addPass(new EffectPass(camera, new AddTextureEffect(plumeRT.texture)));   // stands in for the volume-pass composite
const chain = createPostChain(ctx);
for (const p of chain.passes) composer.addPass(p);

// Harness lights follow the preset (core does this in the real app).
const sunLight = scene.children.find((o) => (o as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight;
const hemi = scene.children.find((o) => (o as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight;
ctx.events.on('preset', (e) => {
  const p = e.preset;
  sunLight.color.copy(p.sun.color); sunLight.intensity = p.sun.intensity; sunLight.position.copy(p.sun.dir).multiplyScalar(2000);
  hemi.color.copy(p.ambient.sky); hemi.groundColor.copy(p.ambient.ground); hemi.intensity = p.ambient.intensity;
  skyU.uScale.value = p.sky.brightness;
  globals.uPlumeLight.value.setRGB(1.0, 0.5, 0.2).multiplyScalar(2.2 * p.plumeLightScale);
});

function setPreset(id: LightingPresetId): void { applyPresetToGlobals(ctx, PRESETS[id]); }
function setQuality(id: QualityId): void { ctx.quality = QUALITY[id]; ctx.events.emit({ type: 'quality', quality: ctx.quality }); }
setPreset('photo');

// ── measuring the chain: scene-linear colours in -> 8-bit display values out ─────────────────
// A 64x64 chart of linear colours is drawn through the real chain (vignette, grain, bloom, SMAA
// and CA off) and read back at each cell centre.
const chartTex = new THREE.DataTexture(new Float32Array(64 * 64 * 4), 64, 64, THREE.RGBAFormat, THREE.FloatType);
chartTex.magFilter = chartTex.minFilter = THREE.NearestFilter;
const chartScene = new THREE.Scene();
const chartCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
chartScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { t: { value: chartTex } }, depthTest: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(t, vUv).rgb, 1.0); }',
})));
// Checker grid scene: high-frequency content for judging tilt-shift and SMAA.
const gridScene = new THREE.Scene();
gridScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  depthTest: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'varying vec2 vUv; void main(){ vec2 g = floor(vUv * vec2(160.0, 90.0)); float c = mod(g.x + g.y, 2.0); gl_FragColor = vec4(vec3(mix(0.05, 0.7, c)), 1.0); }',
})));
function gridTest(on: boolean): void { (renderPass as any).scene = on ? gridScene : scene; (renderPass as any).camera = on ? chartCam : camera; composer.passes[1].enabled = !on; }
function measure(colors: number[][]): number[][] {
  const N = 64 * 64;
  const data = chartTex.image.data as Float32Array;
  for (let i = 0; i < N; i++) {
    const c = colors[Math.min(i, colors.length - 1)];
    data[i * 4] = c[0]; data[i * 4 + 1] = c[1]; data[i * 4 + 2] = c[2]; data[i * 4 + 3] = 1;
  }
  chartTex.needsUpdate = true;
  const saved = { ...chain.tuning };
  Object.assign(chain.tuning, { bloomIntensity: 0, vignette: 0, grain: 0, chromatic: 0, hazeAmp: 0 });
  chain.applyTuning();
  const tilt = chain.passes[3].enabled, smaaOn = chain.passes[4].enabled;
  chain.passes[3].enabled = false; chain.passes[4].enabled = false;
  (renderPass as any).scene = chartScene; (renderPass as any).camera = chartCam;
  const plumePass = composer.passes[1]; plumePass.enabled = false;
  composer.render(0.016);
  const gl = renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const buf = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  (renderPass as any).scene = scene; (renderPass as any).camera = camera; plumePass.enabled = true;
  chain.passes[3].enabled = tilt; chain.passes[4].enabled = smaaOn;
  Object.assign(chain.tuning, saved); chain.applyTuning();
  const out: number[][] = [];
  for (let i = 0; i < Math.min(N, colors.length); i++) {
    const cx = Math.floor(((i % 64) + 0.5) / 64 * W);
    const cy = Math.floor((Math.floor(i / 64) + 0.5) / 64 * H);
    const o = (cy * W + cx) * 4;
    out.push([buf[o], buf[o + 1], buf[o + 2]]);
  }
  return out;
}
const s2l = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
/** Find scene-linear RGB whose chain output matches each #rrggbb (damped log-domain fixed point). */
function invert(hexes: string[], iters = 70): { hex: string; linear: number[]; got: number[]; err: number }[] {
  const tgt = hexes.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  let x = tgt.map((t) => t.map((v) => Math.max(s2l(v), 1e-3)));
  let got: number[][] = [];
  for (let it = 0; it < iters; it++) {
    got = measure(x);
    x = x.map((c, i) => c.map((v, k) => {
      const t = Math.max(s2l(tgt[i][k]), 1 / 255 / 12.92), f = Math.max(s2l(got[i][k]), 1 / 255 / 12.92);
      return Math.min(400, Math.max(1e-4, v * Math.pow(t / f, 0.6)));
    }));
  }
  got = measure(x);
  return hexes.map((hex, i) => ({ hex, linear: x[i].map((v) => +v.toFixed(4)), got: got[i], err: Math.max(...got[i].map((v, k) => Math.abs(v - tgt[i][k]))) }));
}

// ── GUI ─────────────────────────────────────────────────────────────────────────────────────
const gui = new GUI({ title: 'post' });
const state = { preset: 'photo' as LightingPresetId, quality: 'high' as QualityId, debug: 'off', tilt: false, focusY: 0.55, band: 0.12, blur: 0.8, roll: 0, camRoll: 0, drift: 0 };
const lens = () => chain.setLens({ fovDeg: 45, dollyZoom: false, rollDeg: state.roll, tiltShift: { enabled: state.tilt, focusY: state.focusY, band: state.band, blur: state.blur } });
gui.add(state, 'preset', PRESET_ORDER).onChange((v: LightingPresetId) => { setPreset(v); gui.controllersRecursive().forEach((c) => c.updateDisplay()); });
gui.add(state, 'quality', ['low', 'medium', 'high', 'ultra']).onChange((v: QualityId) => setQuality(v));
gui.add(state, 'debug', ['off', 'haze-mask', 'haze-mask-only']).onChange((v: string) => chain.setDebug(v as any));
gui.add(state, 'drift', 0, 1, 1).onChange((v: number) => { globals.uDrift.value = v; });
const f = gui.addFolder('tilt-shift');
f.add(state, 'tilt').onChange(lens); f.add(state, 'focusY', 0, 1, 0.01).onChange(lens); f.add(state, 'band', 0, 0.6, 0.01).onChange(lens);
f.add(state, 'blur', 0, 1.5, 0.01).onChange(lens); f.add(state, 'roll', -20, 20, 0.5).onChange(lens);
const t = gui.addFolder('tuning');
const upd = () => chain.applyTuning();
t.add(chain.tuning, 'exposureBias', 0.3, 3, 0.01).onChange(upd);
t.add(chain.tuning, 'lut', 0, 1, 0.01).onChange(upd);
t.add(chain.tuning, 'bloomIntensity', 0, 2, 0.01).onChange(upd);
t.add(chain.tuning, 'bloomThreshold', 0, 8, 0.05).onChange(upd);
t.add(chain.tuning, 'bloomSmoothing', 0, 4, 0.05).onChange(upd);
t.add(chain.tuning, 'bloomRadius', 0, 1, 0.01).onChange(upd);
t.add(chain.tuning, 'hazeAmp', 0, 0.02, 0.0002).onChange(upd);
t.add(chain.tuning, 'vignette', 0, 0.8, 0.01).onChange(upd);
t.add(chain.tuning, 'grain', 0, 0.08, 0.001).onChange(upd);
t.add(chain.tuning, 'chromatic', 0, 0.004, 0.0001).onChange(upd);
gui.add({ export2x: () => exportStill(ctx, () => renderFrame(0), 2, { resize }) }, 'export2x');
gui.close();

addEventListener('keydown', (e) => { if (e.key === 'l' || e.key === 'L') { state.preset = nextPreset(state.preset); setPreset(state.preset); gui.controllersRecursive().forEach((c) => c.updateDisplay()); } });

// ── render loop ─────────────────────────────────────────────────────────────────────────────
const sizeV = new THREE.Vector2();
function resize(w: number, h: number, pr: number): void {
  renderer.setPixelRatio(pr);
  composer.setSize(w / pr, h / pr, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
function renderFrame(dt: number): void {
  renderer.getDrawingBufferSize(sizeV);
  if (plumeRT.width !== sizeV.x || plumeRT.height !== sizeV.y) plumeRT.setSize(sizeV.x, sizeV.y);
  globals.uResolution.value.copy(sizeV);
  camera.updateMatrixWorld();
  renderer.setRenderTarget(plumeRT); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(plumeScene, camera);
  renderer.setRenderTarget(null);
  composer.render(dt);
}
let lastW = 0, lastH = 0;
sb.start((dt) => {
  if (state.camRoll) camera.rotateZ(-state.camRoll * Math.PI / 180);   // same convention as applyPhotoCamera; OrbitControls resets it each frame
  if (innerWidth !== lastW || innerHeight !== lastH) { lastW = innerWidth; lastH = innerHeight; composer.setSize(lastW, lastH, false); }
  renderFrame(dt);
});

(window as any).app.post = {
  chain, composer, gridTest, renderFrame, resize, setPreset, setQuality, measure, invert, skyU, lens: (o: Partial<typeof state>) => { Object.assign(state, o); lens(); },
  debug: (m: string) => chain.setDebug(m as any),
  async exportTest(scale = 2) {
    const r = await exportStill(ctx, () => renderFrame(0), scale, { resize, frames: 3, download: false });
    return r ? { w: r.width, h: r.height, bytes: r.blob.size, name: r.filename } : null;
  },
};
