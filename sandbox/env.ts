// Sandbox for the ENVIRONMENT module. URL params: ?bake=512 (sky cube face size), ?parts=sky,terrain,ocean,osm
import * as THREE from 'three';
import { createSandbox } from './harness.ts';
import { EnvironmentModule, SKY_TUNE } from '../src/env/EnvironmentModule.ts';
import { PHOTO_PRESET, QUALITY } from '../src/scene-config.ts';
import { PRESETS, applyPresetToGlobals } from '../src/post/presets.ts';

const q = new URLSearchParams(location.search);
const sb = await createSandbox({ title: 'Environment', lights: false, background: 0x000000 });
const ctx = sb.ctx;
ctx.renderer.toneMapping = THREE.AgXToneMapping;      // same operator as the real post chain (no grading here)
ctx.renderer.toneMappingExposure = Number(q.get('exp') ?? 1.0);
ctx.quality = QUALITY[(q.get('quality') as keyof typeof QUALITY) ?? 'medium'];

for (const k of Object.keys(SKY_TUNE)) if (q.has(k)) (SKY_TUNE as any)[k] = Number(q.get(k));
const preset = PRESETS[(q.get('preset') as keyof typeof PRESETS) ?? 'photo'];
applyPresetToGlobals(ctx, preset);
ctx.renderer.toneMapping = preset.viewMode === 1 ? THREE.NoToneMapping : THREE.AgXToneMapping;
ctx.renderer.toneMappingExposure = preset.exposure * Number(q.get('exp') ?? 1.0);
const env = new EnvironmentModule({
  sandboxReflection: true,
  bakeRes: Number(q.get('bake') ?? 512),
  parts: q.get('parts')?.split(','),
  debugSky: Number(q.get('dbg') ?? 0),
});
await env.init(ctx);
sb.add(env);

// Emulate core: sun light + PMREM environment from the env module's environment scene.
const sun = new THREE.DirectionalLight(preset.sun.color, preset.sun.intensity);
sun.position.copy(preset.sun.dir).multiplyScalar(2000);
ctx.scene.add(sun);
void PHOTO_PRESET;
const hemi = new THREE.HemisphereLight(preset.ambient.sky, preset.ambient.ground, preset.ambient.intensity * 0.5);
ctx.scene.add(hemi);
const pmrem = new THREE.PMREMGenerator(ctx.renderer);
const applyEnvMap = () => {
  ctx.scene.environment?.dispose();
  ctx.scene.environment = pmrem.fromScene(env.environmentScene(), 0, 0.1, 100).texture;
};
applyEnvMap();

// live tuning from the URL: ?pool=0.7&bias=0.1&chan=1&veg=1&rip=0.15&sheen=0.5
if (env.terrain) {
  const t = { ...env.terrain.tuning };
  const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
  t.poolThreshold = num('pool', t.poolThreshold); t.poolBias = num('bias', t.poolBias); t.channels = num('chan', t.channels);
  t.vegetation = num('veg', t.vegetation); t.ripple = num('rip', t.ripple); t.sheen = num('sheen', t.sheen);
  env.terrain.setTuning(t);
}
// crude stand-in for the plume module: a warm line light (?plume=8 scales it) so the ground gets its orange bounce
ctx.globals.uPlumeLight.value.setRGB(1.0, 0.55, 0.22).multiplyScalar(Number(q.get('plume') ?? 0));
// sandbox-only stand-ins so the planar reflection has something to mirror: orange steam banks, fireball, tower, rocket
if (q.get('props') !== '0') {
  const props = new THREE.Group();
  const bank = (x: number, y: number, z: number, r: number, c: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(...c) }));
    m.position.set(x, y, z); m.scale.y = 0.8; props.add(m);
  };
  bank(-360, 120, -20, 170, [1.6, 1.05, 0.7]); bank(-250, 200, -60, 120, [1.9, 1.5, 1.2]);
  bank(420, 160, -30, 200, [1.7, 1.1, 0.7]); bank(360, 260, -80, 150, [1.5, 1.2, 1.0]);
  bank(0, 14, 0, 26, [12, 9, 3]);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(12, 144, 12), new THREE.MeshStandardMaterial({ color: 0x8a5a55, roughness: 0.7 }));
  tower.position.set(-3, 72, -27); props.add(tower);
  const rocket = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 124, 20), new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.9, roughness: 0.3 }));
  rocket.position.set(0, 158 + 62, 0); props.add(rocket);
  ctx.scene.add(props);
}
// switch preset at runtime from scripted screenshots: app.setPreset('noon')
(window as any).app.setPreset = (id: keyof typeof PRESETS) => {
  const p = PRESETS[id];
  applyPresetToGlobals(ctx, p);
  ctx.renderer.toneMapping = p.viewMode === 1 ? THREE.NoToneMapping : THREE.AgXToneMapping;
  ctx.renderer.toneMappingExposure = p.exposure;
  hemi.color.copy(p.ambient.sky); hemi.groundColor.copy(p.ambient.ground); hemi.intensity = p.ambient.intensity * 0.5;
  sun.color.copy(p.sun.color); sun.intensity = p.sun.intensity; sun.position.copy(p.sun.dir).multiplyScalar(2000);
  env.onPreset(p);
  applyEnvMap();
};
if (env.terrain && q.has('dbgt')) env.terrain.setDebug(Number(q.get('dbgt')));
(window as any).app.env = env;
(window as any).app.applyEnvMap = applyEnvMap;
if (q.get('dbg') === 'refl') {
  // show the planar reflection target instead of the scene (debug)
  const quadScene = new THREE.Scene();
  const quadMat = new THREE.ShaderMaterial({
    uniforms: { t: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'varying vec2 vUv; uniform sampler2D t; void main(){ vec3 c = texture2D(t, vUv).rgb; c = c / (1.0 + c); gl_FragColor = vec4(pow(c, vec3(1.0/2.2)), 1.0); }',
  });
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat));
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  sb.start(() => {
    ctx.renderer.render(ctx.scene, ctx.camera);
    quadMat.uniforms.t.value = (env as any).refl.target.texture;
    ctx.renderer.render(quadScene, orthoCam);
  });
} else sb.start();
