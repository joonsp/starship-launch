// Sandbox for the physics + educational module: a placeholder stack, tower and mount from the anchors,
// fake hotspots for every id, the edu module enabled, and a language toggle. Drive it from steps.json via window.app.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import '../src/styles/tokens.css';
import { createSandbox } from './harness.ts';
import { ANCHORS } from '../src/scene-config.ts';
import { applyGlobals } from '../src/core/material-hooks.ts';
import { setLang, getLang, missingTranslations } from '../src/i18n.ts';
import type { CameraModeId, Hotspot } from '../src/contracts.ts';
import { EduModule } from '../src/edu/index.ts';
import { HOTSPOT_DEFS } from '../src/edu/catalog.ts';

const sb = await createSandbox({ title: 'Physics + educational mode', ground: false, background: 0x6d9ccc });
const { ctx } = sb;
const g = ctx.globals;
g.uPlumeLight.value.setRGB(1.0, 0.6, 0.35).multiplyScalar(0.5);

// metal reflections (preview only)
const pmrem = new THREE.PMREMGenerator(ctx.renderer);
ctx.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const mat = (c: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => applyGlobals(new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o }), g);
const base = ANCHORS.vehicleBase;

// ground, mud flats and a strip of water
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), mat(0x6a5b4e, { roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ctx.scene.add(ground);
const sea = new THREE.Mesh(new THREE.PlaneGeometry(40000, 16000), mat(0x486a7a, { roughness: 0.25 }));
sea.rotation.x = -Math.PI / 2; sea.position.set(15000, 0.3, -6000); ctx.scene.add(sea);

// placeholder stack: booster (frost bright below, dark above), ship (black), nose
const boosterLo = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 44, 40), mat(0xd9dde2, { metalness: 0.7, roughness: 0.35 }));
boosterLo.position.set(0, base.y + 22, 0);
const boosterHi = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 28.3, 40), mat(0x8c96a4, { metalness: 0.85, roughness: 0.3 }));
boosterHi.position.set(0, base.y + 44 + 14.15, 0);
const ship = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 42.5, 40), mat(0x121114, { metalness: 0.2, roughness: 0.55 }));
ship.position.set(0, base.y + 72.3 + 21.25, 0);
const nose = new THREE.Mesh(new THREE.ConeGeometry(4.5, 9.6, 40), mat(0x121114, { metalness: 0.2, roughness: 0.5 }));
nose.position.set(0, base.y + 72.3 + 42.5 + 4.8, 0);
ctx.scene.add(boosterLo, boosterHi, ship, nose);

// tower (open lattice look via a tall box + arms), OLM deck, plume column
const tower = new THREE.Mesh(new THREE.BoxGeometry(12.5, ANCHORS.towerHeight, 12.5), mat(0x7a4a44));
tower.position.set(ANCHORS.towerBase.x, ANCHORS.towerHeight / 2, ANCHORS.towerBase.z); ctx.scene.add(tower);
const arms = new THREE.Mesh(new THREE.BoxGeometry(44, 3, 3), mat(0x7a4a44));
arms.position.set(ANCHORS.towerBase.x, 124, ANCHORS.towerBase.z + 8); ctx.scene.add(arms);
const olm = new THREE.Mesh(new THREE.BoxGeometry(34, 20, 34), mat(0x4a4744, { roughness: 0.8 }));
olm.position.set(0, 10, 0); ctx.scene.add(olm);
const plume = new THREE.Mesh(new THREE.CylinderGeometry(6, 9, base.y + 4, 24, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(4.2, 3.0, 3.4), transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
plume.position.set(0, (base.y - 4) / 2, 0); ctx.scene.add(plume);
// two steam puffs to give the clouds something to sit in front of
for (const [x, z, r] of [[-230, 10, 130], [240, 20, 150], [-90, -40, 90]]) {
  const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 1.35) }));
  puff.position.set(x, r * 0.7, z); ctx.scene.add(puff);
}

// fake hotspots for every id (positions are placeholders for the real modules' anchors)
const B = base.y, F = 4.6; // F: pin offset toward the camera-facing side
const at: Record<string, [number, number, number]> = {
  booster: [0, B + 36, F], ship: [0, B + 72.3 + 26, F], raptors: [0, B + 1.2, F], gridfins: [F, B + 62.5, 0],
  hotstage: [-F, B + 68, 0], flaps: [F + 1.5, B + 76.8, 0], tiles: [0, B + 72.3 + 34, F], frost: [-F, B + 24, 0],
  tower: [ANCHORS.towerBase.x + 6.5, 95, ANCHORS.towerBase.z + 6.5], chopsticks: [ANCHORS.towerBase.x - 20, 124, ANCHORS.towerBase.z + 8],
  olm: [14, 14, 14], trench: [0, -3, 24], tankfarm: [196, 6, -85], plume: [2, B - 58, 6], machdiamonds: [3, B - 24, 5],
  steam: [235, 105, 26], fireball: [-16, 14, 18],
};
const cats = new Map(HOTSPOT_DEFS.map((d) => [d.id, d.category]));
const prio: Record<string, number> = { booster: 9, ship: 9, tower: 8, plume: 8, steam: 7, raptors: 6, hotstage: 6, chopsticks: 6, olm: 5, gridfins: 5, machdiamonds: 5, flaps: 4, tiles: 4, frost: 4, trench: 3, fireball: 5, tankfarm: 2 };
for (const [id, p] of Object.entries(at)) {
  ctx.hotspots.push({ id, position: new THREE.Vector3(...p), contentKey: `edu.hotspot.${id}`, category: cats.get(id) ?? 'vehicle', priority: prio[id] ?? 3 } as Hotspot);
}

const edu = new EduModule({
  onFocus(point, distance) {
    const dir = new THREE.Vector3(0.35, 0.18, 1).normalize();
    sb.setOrbit([point.x + dir.x * distance, point.y + dir.y * distance, point.z + dir.z * distance], [point.x, point.y, point.z]);
  },
});
await edu.init(ctx);
sb.add(edu);
edu.setEnabled(true);

// language toggle
const lang = document.createElement('button');
lang.textContent = 'EN / FI';
lang.style.cssText = 'position:fixed;left:8px;top:30px;z-index:60;padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.3);background:rgba(10,12,16,.75);color:#fff;font:600 12px system-ui;cursor:pointer';
lang.dataset.testid = 'lang';
lang.onclick = () => setLang(getLang() === 'en' ? 'fi' : 'en');
document.body.append(lang);

sb.start();

(window as any).app.edu = edu;
(window as any).app.setLang = setLang;
(window as any).app.missing = missingTranslations;
(window as any).app.mode = (m: CameraModeId) => ctx.events.emit({ type: 'camera-mode', mode: m });
(window as any).app.THREE = THREE;
