// VEHICLE module: Super Heavy B21 + Starship S41 (Block 3). OWNER: vehicle builder.
//
// Loads public/models/starship.glb (built by blender/build_vehicle.py), replaces the placeholder
// glTF materials by the procedural ones of materials.ts (frost, tiles, brushed steel, Raptor 3 bells),
// places the stack at anchors.vehicleBase with the calibrated yaw / tilt, and registers the hotspots.
//
//   const vehicle = new VehicleModule();
//   await vehicle.init(ctx);                    // adds vehicle.root to ctx.scene
//   vehicle.getNozzleExitsWorld()               // 33 world-space nozzle exit centres (engine-layout.ts order)
//
// The vehicle is frozen: no per-frame work unless globals.uDrift > 0 (slow-drift mode adds a faint engine rumble). Engines are LOD nodes (52k-triangle hero engines within
// `LOD_HIGH[quality]` metres of the camera, 1k-triangle single-material stand-ins beyond). THREE.LOD switches on the main
// camera distance, so the shadow pass draws whichever level is currently visible.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AppContext, Hotspot, Module, QualitySettings } from '../contracts.ts';
import { boosterEngines, NOZZLE_EXIT_BELOW_PLANE } from '../core/engine-layout.ts';
import { val } from '../specs.ts';
import { VehicleMaterials } from './materials.ts';

const DEG = Math.PI / 180;
const R = val('vehicle.common.diameter') / 2;
const SHIP_Y0 = val('vehicle.booster.length');
/** Photo-measured grid fin height and clocking (spec estimates 62.5 m and 0/120/240 deg; see blender/build_vehicle.py). */
const FIN_Y = 66.8;
const FIN_AZ0_DEG = 30;

/** Distance (m) under which the detailed engine meshes are used, per quality tier. */
const LOD_HIGH: Record<QualitySettings['id'], number> = { low: 25, medium: 45, high: 70, ultra: 110 };

export class VehicleModule implements Module {
  readonly name = 'vehicle';
  /** Group placed at anchors.vehicleBase (yaw + tilt applied). Child of ctx.scene after init(). */
  readonly root = new THREE.Group();
  /** The loaded GLB scene (vehicle frame: origin at the booster engine plane). */
  model: THREE.Group | null = null;
  materials: VehicleMaterials | null = null;

  private ctx: AppContext | null = null;
  private lods: THREE.LOD[] = [];
  private nozzleLocal: THREE.Vector3[] = [];
  private partNames = new Map<string, THREE.Object3D>();
  private shaking = false;

  constructor() {
    this.root.name = 'vehicle';
  }

  async init(ctx: AppContext): Promise<void> {
    this.ctx = ctx;
    this.materials = new VehicleMaterials(ctx.globals, ctx.quality);

    const gltf = await new GLTFLoader().loadAsync(import.meta.env.BASE_URL + 'models/starship.glb');
    const model = gltf.scene;
    model.name = 'starship';
    this.model = model;

    // -- materials, shadows, LOD nodes
    const mats = this.materials;
    model.traverse((o) => {
      this.partNames.set(o.name, o);
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      let isRvac = false;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name.includes('rvac')) { isRvac = true; break; }
      const src = mesh.material as THREE.Material;
      mesh.material = mats.forGlb(src.name, isRvac);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    this.buildEngineLods(model);

    // -- placement: yaw about the stack axis, then the lean about the (world) tilt axis
    const a = ctx.anchors;
    this.root.add(model);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a.vehicleYawDeg * DEG);
    const qTilt = new THREE.Quaternion().setFromAxisAngle(a.vehicleTiltAxis.clone().normalize(), a.vehicleTiltDeg * DEG);
    this.root.quaternion.copy(qTilt).multiply(qYaw);
    this.root.position.copy(a.vehicleBase);
    ctx.scene.add(this.root);
    this.root.updateMatrixWorld(true);
    // the model is static: freeze the matrices of everything below the root
    model.traverse((o) => { o.matrixAutoUpdate = false; });

    // -- nozzle exits from the engine layout formulas (not from the mesh)
    this.nozzleLocal = boosterEngines().map((e) => new THREE.Vector3(e.x, -NOZZLE_EXIT_BELOW_PLANE, e.z));

    this.pushHotspots(ctx);
    this.onQuality(ctx.quality);
  }

  /** The 33 booster nozzle exit centres in world space, in src/core/engine-layout.ts order. */
  getNozzleExitsWorld(): THREE.Vector3[] {
    this.root.updateMatrixWorld(true);
    return this.nozzleLocal.map((v) => this.root.localToWorld(v.clone()));
  }

  /** A named part of the model (booster_hull, gridfin_0, flap_aft_L, raptor_07, ...). */
  getPart(name: string): THREE.Object3D | undefined {
    return this.partNames.get(name);
  }

  /** Frozen by default (uDrift = 0). In slow-drift mode the stack gets a millimetre-scale rumble from 33 engines. */
  update(_dt: number, t: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const d = ctx.globals.uDrift.value;
    if (d <= 0) {
      if (this.shaking) { this.root.position.copy(ctx.anchors.vehicleBase); this.shaking = false; }
      return;
    }
    this.shaking = true;
    const a = 0.008 * d;   // metres
    const b = ctx.anchors.vehicleBase;
    this.root.position.set(
      b.x + a * (Math.sin(t * 61.0) * 0.6 + Math.sin(t * 23.0 + 1.3) * 0.4),
      b.y + a * 0.7 * Math.sin(t * 47.0 + 0.4),
      b.z + a * (Math.sin(t * 53.0 + 2.1) * 0.6 + Math.sin(t * 19.0) * 0.4),
    );
  }

  onQuality(q: QualitySettings): void {
    this.materials?.setQuality(q);
    for (const l of this.lods) if (l.levels.length > 1) l.levels[1].distance = LOD_HIGH[q.id];
  }

  dispose(): void {
    this.ctx?.scene.remove(this.root);
    this.materials?.dispose();
    const geos = new Set<THREE.BufferGeometry>();
    this.model?.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) geos.add(m.geometry); });
    geos.forEach((g) => g.dispose());
  }

  // ---------------------------------------------------------------------------------------------

  /** Wrap each raptor_XX/{_hi,_lo} pair into a THREE.LOD (level switch by main-camera distance). */
  private buildEngineLods(model: THREE.Object3D): void {
    const parents: THREE.Object3D[] = [];
    model.traverse((o) => { if (/^raptor_(\d\d|rvac_\d|rsl_\d)$/.test(o.name)) parents.push(o); });
    for (const p of parents) {
      const hi = p.children.find((c) => c.name === `${p.name}_hi`);
      const lo = p.children.find((c) => c.name === `${p.name}_lo`);
      if (!hi || !lo) continue;
      const lod = new THREE.LOD();
      lod.name = `${p.name}_lod`;
      p.add(lod);
      lod.addLevel(hi, 0);
      lod.addLevel(lo, LOD_HIGH.high);
      this.lods.push(lod);
    }
  }

  private pushHotspots(ctx: AppContext): void {
    const L = (x: number, y: number, z: number) => this.root.localToWorld(new THREE.Vector3(x, y, z));
    // anchors sit on the side that faces the photo camera (vehicle -z = the ship's belly)
    const H = (id: string, p: THREE.Vector3, priority: number): Hotspot => ({
      id, position: p, contentKey: `edu.hotspot.${id}`, category: 'vehicle', priority,
    });
    const flapR = R + 3.3;
    const list: Hotspot[] = [
      H('raptors', L(1.4, -0.4, -2.2), 8),
      H('gridfins', L((R + 2.2) * Math.cos(FIN_AZ0_DEG * DEG), FIN_Y + 0.4, -(R + 2.2) * Math.sin(FIN_AZ0_DEG * DEG)), 7),
      H('hotstage', L(0, 67.7, -R), 7),
      H('flaps', L(flapR * 0.95, SHIP_Y0 + 8.0, -0.6), 6),
      H('tiles', L(0.0, SHIP_Y0 + 24.0, -R), 8),
      H('frost', L(0.0, 22.0, -R), 8),
      H('ship', L(0.0, SHIP_Y0 + 47.5, -1.4), 9),
      H('booster', L(0.0, 52.0, -R), 9),
    ];
    for (const h of list) ctx.hotspots.push(h);
  }
}
