// PAD module: Launch Pad 2 structures. OWNER: pad builder.
//
// Loads public/models/pad.glb (built by blender/build_pad.py: tower 2 with the chopsticks and boom, the orbital
// launch mount, flame trench with diverter, concrete apron, tank farm, GSE piping, Pad 1's tower and mount) and
// public/data/colliders.json, assigns the procedural materials of materials.ts by GLB material name, turns the
// linked duplicates (tower bays, tanks) into InstancedMeshes, and registers hotspots and colliders.
//
//   const pad = new PadModule();
//   await pad.init(ctx);        // adds pad.root to ctx.scene; pushes ctx.colliders and ctx.hotspots
//   pad.update(dt, t)           // per frame: only the tower LOD switch (frozen scene, no other work)
//   pad.onQuality(q)            // shader octaves + LOD distances
//
// The GLB is in the world frame (origin = vehicle axis at ground), so root has an identity transform. The tower
// lattice exists twice: 'hi' bays (bolted joints, stairs, platforms) and 'lo' bays (thickened members); the LOD is
// switched by main-camera distance (hysteresis) because sub-pixel braces alias. Pad 1's tower always uses 'lo'.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AppContext, Collider, Hotspot, Module, QualitySettings } from '../contracts.ts';
import { PAD_YAW, TRENCH_CUTOUT } from '../scene-config.ts';
import { val, vec3 } from '../specs.ts';
import { PadMaterials } from './materials.ts';

/** Distance (m) from the tower under which the detailed bays are used, per quality tier. */
const TOWER_HI_DIST: Record<QualitySettings['id'], number> = { low: 140, medium: 220, high: 320, ultra: 500 };

/** Parts that must not throw shadows (thin grating, fences, mesh) or receive nothing useful. */
const NO_SHADOW_MATS = new Set(['grating', 'fence_mesh', 'beacon']);

export class PadModule implements Module {
  readonly name = 'pad';
  /** Everything of the pad. Child of ctx.scene after init(). */
  readonly root = new THREE.Group();
  model: THREE.Group | null = null;
  materials: PadMaterials | null = null;
  /** Parsed colliders (also pushed to ctx.colliders). */
  colliders: Collider[] = [];

  private ctx: AppContext | null = null;
  private instanced: THREE.InstancedMesh[] = [];
  private merged: THREE.Mesh[] = [];
  private mergeStatic = new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('merge') !== '0';
  private towerHi: THREE.Object3D[] = [];
  private towerLo: THREE.Object3D[] = [];
  private hiDist = TOWER_HI_DIST.high;
  private showingHi = true;
  private beaconBlinking = false;
  private towerCentre = new THREE.Vector3(...vec3('pad.tower2_centre'));
  private tmp = new THREE.Vector3();

  constructor() {
    this.root.name = 'pad';
  }

  async init(ctx: AppContext): Promise<void> {
    this.ctx = ctx;
    this.materials = new PadMaterials(ctx.globals, ctx.quality);
    const base = import.meta.env.BASE_URL;
    const [gltf, cols] = await Promise.all([
      new GLTFLoader().loadAsync(base + 'models/pad.glb'),
      fetch(base + 'data/colliders.json').then((r) => (r.ok ? (r.json() as Promise<Collider[]>) : [])).catch(() => [] as Collider[]),
    ]);
    const model = gltf.scene;
    model.name = 'pad_model';
    this.model = model;
    model.updateMatrixWorld(true);

    // -- materials by GLB material name, shadows
    const mats = this.materials;
    const meshes: THREE.Mesh[] = [];
    model.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    for (const mesh of meshes) {
      const src = mesh.material as THREE.Material;
      const role = src.name;
      mesh.material = mats.forGlb(role);
      mesh.userData.padRole = role;
      mesh.castShadow = !NO_SHADOW_MATS.has(role);
      mesh.receiveShadow = true;
    }

    // -- draw-call diet: instanced tower bays + baked static cells; remember the tower LOD sets
    this.optimise(model, meshes);
    this.root.add(model);
    ctx.scene.add(this.root);
    this.root.updateMatrixWorld(true);
    this.root.traverse((o) => { o.matrixAutoUpdate = false; });

    // -- colliders + hotspots
    this.colliders = cols;
    for (const c of cols) ctx.colliders.push(c);
    this.pushHotspots(ctx);
    this.onQuality(ctx.quality);
    this.applyLod(true);
  }

  update(_dt: number, t: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // Frozen (uDrift = 0): everything is static. In slow-drift mode the obstruction lights flash (FAA L-864: 30 flashes/min).
    if (ctx.globals.uDrift.value > 0 || this.beaconBlinking) {
      this.beaconBlinking = ctx.globals.uDrift.value > 0;
      const on = !this.beaconBlinking || ((t * 0.5) % 1) < 0.35;
      this.materials?.setBeacon(on ? 6 : 0.4);
    }
    const d = ctx.camera.position.distanceTo(this.tmp.copy(this.towerCentre).setY(60));
    // hysteresis: switch to lo above 1.08x, back to hi below 0.92x of the threshold
    if (this.showingHi && d > this.hiDist * 1.08) this.applyLod(false);
    else if (!this.showingHi && d < this.hiDist * 0.92) this.applyLod(true);
  }

  onQuality(q: QualitySettings): void {
    this.materials?.setQuality(q);
    this.hiDist = TOWER_HI_DIST[q.id];
  }

  dispose(): void {
    this.ctx?.scene.remove(this.root);
    this.materials?.dispose();
    const geos = new Set<THREE.BufferGeometry>();
    this.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) geos.add(m.geometry); });
    geos.forEach((g) => g.dispose());
  }

  // ---------------------------------------------------------------------------------------------

  private applyLod(hi: boolean): void {
    this.showingHi = hi;
    for (const o of this.towerHi) o.visible = hi;
    for (const o of this.towerLo) o.visible = !hi;
  }

  /**
   * Draw-call diet. The Blender build links repeated parts as duplicates of one mesh (one glTF mesh, many nodes);
   * GLTFLoader clones the Mesh per node but shares geometry and material.
   *  - the tower bays (22 x hi/lo, Pad 1 x lo) become InstancedMeshes, because the LOD switch hides whole sets;
   *  - everything else is baked into one static mesh per (material, shadow flag, 150 m cell): ~100 nodes become
   *    ~40 draws, and cells still frustum-cull (the tank farm is 200-450 m from the mount).
   */
  private optimise(model: THREE.Group, meshes: THREE.Mesh[]): void {
    const inst = new Map<string, THREE.Mesh[]>();
    const rest: THREE.Mesh[] = [];
    for (const m of meshes) {
      const nm = this.nodeName(m);
      if (/^(tower_lattice_|tower1_lattice)/.test(nm)) {
        const key = `${m.geometry.uuid}|${(m.material as THREE.Material).uuid}|${nm.startsWith('tower1') ? 1 : 0}`;
        let g = inst.get(key);
        if (!g) inst.set(key, (g = []));
        g.push(m);
      } else rest.push(m);
    }
    for (const list of inst.values()) {
      const first = list[0];
      const nm = this.nodeName(first);
      const im = new THREE.InstancedMesh(first.geometry, first.material, list.length);
      im.name = `${nm}_x${list.length}`;
      im.userData.padRole = first.userData.padRole;
      im.castShadow = first.castShadow;
      im.receiveShadow = true;
      list.forEach((m, i) => im.setMatrixAt(i, m.matrixWorld));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.computeBoundingBox();
      for (const m of list) m.removeFromParent();
      this.root.add(im);
      if (/^tower_lattice_[ab]/.test(nm)) this.towerHi.push(im);
      if (/^tower_lattice_lo/.test(nm)) this.towerLo.push(im);
      this.instanced.push(im);
    }
    if (this.mergeStatic) this.mergeMeshes(rest);
  }

  private mergeMeshes(list: THREE.Mesh[]): void {
    const cells = new Map<string, THREE.Mesh[]>();
    const p = new THREE.Vector3();
    for (const m of list) {
      m.geometry.computeBoundingBox();
      m.geometry.boundingBox!.getCenter(p).applyMatrix4(m.matrixWorld);
      const key = `${(m.material as THREE.Material).uuid}|${m.castShadow ? 1 : 0}|${Math.floor(p.x / 150)},${Math.floor(p.z / 150)}`;
      let g = cells.get(key);
      if (!g) cells.set(key, (g = []));
      g.push(m);
    }
    for (const [key, group] of cells) {
      const geos = group.map((m) => {
        const g = m.geometry.clone();
        g.applyMatrix4(m.matrixWorld);
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
        return g;
      });
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const first = group[0];
      const mesh = new THREE.Mesh(merged, first.material);
      mesh.name = `${first.userData.padRole}_${key.split('|')[2]}`;
      mesh.userData.padRole = first.userData.padRole;
      mesh.castShadow = first.castShadow;
      mesh.receiveShadow = true;
      for (const m of group) m.removeFromParent();
      this.root.add(mesh);
      this.merged.push(mesh);
    }
  }

  /** Name of the glTF node a mesh came from (multi-material nodes become Groups with child Meshes): the first
   *  ancestor (or the mesh itself) whose name starts with one of the build's object prefixes. */
  private nodeName(m: THREE.Object3D): string {
    for (let o: THREE.Object3D | null = m; o && o !== this.model; o = o.parent) {
      if (/^(tower|tanks_|chopsticks|olm_|trench|diverter|apron|fence|lights|gse_|pipes)/.test(o.name)) return o.name;
    }
    return m.name;
  }

  private pushHotspots(ctx: AppContext): void {
    const T = this.towerCentre;
    const H = (id: string, p: THREE.Vector3, priority: number): Hotspot => ({
      id, position: p, contentKey: `edu.hotspot.${id}`, category: 'pad', priority,
    });
    const carriageY = val('pad.chopstick_carriage_height_in_photo');
    /** Pad-local point (x along the trench axis) to world: rotation.y = PAD_YAW about the vehicle axis. */
    const L = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyAxisAngle(THREE.Object3D.DEFAULT_UP, PAD_YAW);
    const list: Hotspot[] = [
      H('tower', new THREE.Vector3(T.x, 92, T.z), 8),
      H('chopsticks', new THREE.Vector3(0, carriageY + 2.5, -8), 8),
      H('olm', L(17.5, val('scene.olm_deck_height') + 1.5, 0), 8),
      H('trench', L(TRENCH_CUTOUT.halfX - 6, -3.5, 0), 7),
      H('tankfarm', new THREE.Vector3(196, 6, -85), 6),
    ];
    for (const h of list) ctx.hotspots.push(h);
  }
}
