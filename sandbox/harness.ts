// Shared sandbox harness: builds a stub AppContext so each module can be developed and
// screenshotted in isolation (no post chain; simple ACES tone mapping for preview).
// OWNER: orchestrator. Usage in sandbox/<module>.ts:
//   const sb = await createSandbox({ title: 'Vehicle', view: 'photo' });
//   const mod = new VehicleModule(); await mod.init(sb.ctx); sb.add(mod); sb.start();
// Exposes window.app = { ctx, controls, sb } for scripted screenshots (scripts/shoot.mjs).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AppContext, Module } from '../src/contracts.ts';
import { createEmitter, createGlobals } from '../src/core/context.ts';
import { ANCHORS, PHOTO_PRESET, QUALITY, applyPhotoCamera } from '../src/scene-config.ts';

export interface SandboxOptions {
  title: string;
  view?: 'photo' | 'orbit';
  orbitTarget?: [number, number, number];
  orbitPos?: [number, number, number];
  lights?: boolean;          // add a sun DirectionalLight + HemisphereLight (default true)
  background?: number;       // clear colour (default sky-ish blue)
  ground?: boolean;          // add a flat grey ground plane (default false)
}

export interface Sandbox {
  ctx: AppContext;
  controls: OrbitControls;
  add(m: Module): void;
  start(render?: (dt: number, t: number) => void): void;
  setPhotoView(): void;
  setOrbit(pos: [number, number, number], target: [number, number, number]): void;
  /** Frames rendered so far; scripted screenshots can wait on this. */
  frames: number;
}

export async function createSandbox(o: SandboxOptions): Promise<Sandbox> {
  document.title = `Sandbox · ${o.title}`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
  document.body.style.margin = '0';
  document.body.style.background = '#000';
  document.body.appendChild(canvas);
  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:13px system-ui;color:#fff';
  document.body.appendChild(ui);
  const label = document.createElement('div');
  label.textContent = `sandbox: ${o.title}`;
  label.style.cssText = 'position:absolute;left:8px;top:6px;opacity:.6';
  ui.appendChild(label);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(o.background ?? 0x5c8fbf);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 60000);

  const globals = createGlobals();
  const preset = PHOTO_PRESET;
  globals.uSunDir.value.copy(preset.sun.dir);
  globals.uSunColor.value.copy(preset.sun.color).multiplyScalar(preset.sun.intensity);
  globals.uSkyAmbient.value.copy(preset.ambient.sky).multiplyScalar(preset.ambient.intensity);
  globals.uGroundAmbient.value.copy(preset.ambient.ground).multiplyScalar(preset.ambient.intensity);
  globals.uFogColor.value.copy(preset.fog.color);
  globals.uFogDensity.value = preset.fog.density;
  globals.uPlumeAxisA.value.copy(ANCHORS.vehicleBase);
  globals.uPlumeAxisB.value.copy(ANCHORS.plumeImpact);

  const ctx: AppContext = {
    renderer, scene, camera, canvas, uiRoot: ui, globals, anchors: ANCHORS,
    quality: QUALITY.medium, preset, lang: 'en', events: createEmitter(),
    targets: { sceneDepth: null, plume: null }, colliders: [], hotspots: [],
    renderView: () => {},
  };

  if (o.lights !== false) {
    const sun = new THREE.DirectionalLight(preset.sun.color, preset.sun.intensity);
    sun.position.copy(preset.sun.dir).multiplyScalar(2000);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(preset.ambient.sky, preset.ambient.ground, preset.ambient.intensity));
  }
  if (o.ground) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshStandardMaterial({ color: 0x5a524a, roughness: 1 }));
    g.rotation.x = -Math.PI / 2;
    scene.add(g);
  }

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.addEventListener('change', () => ctx.events.emit({ type: 'camera-moved' }));

  const modules: Module[] = [];
  const sb: Sandbox = {
    ctx, controls, frames: 0,
    add: (m) => modules.push(m),
    setPhotoView() {
      applyPhotoCamera(camera);
      controls.target.copy(ANCHORS.photoCamera.target);
      controls.update();
      applyPhotoCamera(camera);
      ctx.events.emit({ type: 'camera-moved' });
    },
    setOrbit(pos, target) {
      camera.position.set(...pos);
      controls.target.set(...target);
      camera.fov = 45; camera.updateProjectionMatrix();
      controls.update();
      ctx.events.emit({ type: 'camera-moved' });
    },
    start(render) {
      const timer = new THREE.Timer();
      const resize = () => {
        const w = innerWidth, h = innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
        const b = renderer.getDrawingBufferSize(new THREE.Vector2());
        globals.uResolution.value.copy(b);
        ctx.events.emit({ type: 'camera-moved' });
      };
      addEventListener('resize', resize); resize();
      if (o.view === 'orbit' || o.orbitPos) sb.setOrbit(o.orbitPos ?? [300, 150, 500], o.orbitTarget ?? [0, 80, 0]);
      else sb.setPhotoView();
      renderer.setAnimationLoop((now) => {
        timer.update(now);
        const dt = Math.min(timer.getDelta(), 0.1);
        const t = timer.getElapsed();
        globals.uTime.value = t;
        globals.uCameraPos.value.copy(camera.position);
        if (o.view !== 'photo' || sb.frames > 0) controls.update();
        for (const m of modules) m.update?.(dt, t);
        if (render) render(dt, t); else renderer.render(scene, camera);
        globals.uFrame.value++;
        sb.frames++;
      });
    },
  };
  (window as any).app = { ctx, controls, sb };
  return sb;
}
