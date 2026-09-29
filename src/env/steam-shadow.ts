// Ground shadow of the launch-cloud banks.
//
// The sun stands at 5.7 deg (photo), so a 200 m bank throws a ~2 km shadow: the ground west of the pad, the road corridor and
// the lagoon lie in the shade of the steam and are lit by the sky alone (cool, dark), while only the ground beyond the shadow
// edges keeps the warm low-sun key. The terrain / road shaders multiply their DIRECT light by this map (sky ambient and the
// warm bounce from the steam are untouched).
//
// It is a small CPU bake: every level-0 steam mass of the volume module (read-only import of its authored layout) is treated
// as a soft sphere, and the sun-ray optical depth through it is splatted onto a ground grid, which is cheap because a sphere's
// shadow is a thin ellipse. Recomputed on a preset change (the sun moves); the volume's own light stays with the volume module.
import * as THREE from 'three';
import { L0_SPECS, photoFrameFrom, worldFromPhoto, type Vec3 } from '../fx/volume/puffs.ts';
import { ANCHORS } from '../scene-config.ts';

/** Half extent (m) and resolution of the shadow map; 16 m/texel, plenty for penumbrae hundreds of metres wide. */
export const STEAM_SHADOW_HALF = 4096;
export const STEAM_SHADOW_N = 512;

interface Mass { x: number; y: number; z: number; r: number; k: number }

let cachedMasses: Mass[] | null = null;
function masses(): Mass[] {
  if (cachedMasses) return cachedMasses;
  const pc = ANCHORS.photoCamera;
  const fr = photoFrameFrom(pc.pos.toArray() as Vec3, pc.target.toArray() as Vec3, pc.fovDeg, pc.rollDeg);
  // the puff children ('cauliflower' billows) bulge past the parent by ~30 %
  cachedMasses = L0_SPECS.map((s) => {
    const c = worldFromPhoto(fr, s.u, s.d, s.h);
    return { x: c[0], y: c[1], z: c[2], r: s.r * 1.3, k: s.k ?? 1 };
  });
  return cachedMasses;
}

export class SteamShadow {
  readonly texture: THREE.DataTexture;
  private readonly data = new Uint8Array(STEAM_SHADOW_N * STEAM_SHADOW_N);
  private readonly tau = new Float32Array(STEAM_SHADOW_N * STEAM_SHADOW_N);
  /** Sun-ray optical length (m of dense steam) over which the direct sun falls to 1/e. */
  private readonly L0 = 34;
  /** Diffuse sun that still gets through the thick banks (multiple scattering), fraction of the unshadowed key. */
  private readonly floor = 0.24;

  constructor() {
    this.data.fill(255);
    this.texture = new THREE.DataTexture(this.data, STEAM_SHADOW_N, STEAM_SHADOW_N, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  /** Recompute for a unit vector towards the sun. */
  update(sun: THREE.Vector3): void {
    const N = STEAM_SHADOW_N, H = STEAM_SHADOW_HALF, cell = (2 * H) / N;
    const tau = this.tau; tau.fill(0);
    const sx = sun.x, sy = sun.y, sz = sun.z;
    if (sy > 0.02) {
      const inv = 1 / sy;
      const hx = sx * inv, hz = sz * inv;          // ground displacement per metre of height, towards the sun
      for (const m of masses()) {
        const R = m.r;
        // shadow footprint: the sphere's shadow cylinder cut by the ground plane. Its centre lies at c - (hx, hz) * c.y
        // (away from the sun); its extent along the sun azimuth is R / sin(alt), across is R.
        const cx = m.x - hx * m.y, cz = m.z - hz * m.y;
        const ext = R * Math.hypot(1, inv) + R;
        const i0 = Math.max(0, Math.floor((cx - ext + H) / cell)), i1 = Math.min(N - 1, Math.ceil((cx + ext + H) / cell));
        const j0 = Math.max(0, Math.floor((cz - ext + H) / cell)), j1 = Math.min(N - 1, Math.ceil((cz + ext + H) / cell));
        for (let j = j0; j <= j1; j++) {
          const pz = -H + (j + 0.5) * cell;
          for (let i = i0; i <= i1; i++) {
            const px = -H + (i + 0.5) * cell;
            const dx = m.x - px, dy = m.y, dz = m.z - pz;
            const along = dx * sx + dy * sy + dz * sz;
            const d2 = dx * dx + dy * dy + dz * dz - along * along;
            if (d2 >= R * R || along < -R) continue;
            // chord through a soft (quadratic falloff) ball: 2 sqrt(R^2 - d^2), weighted to soften the shadow edges
            const q = 1 - d2 / (R * R);
            tau[j * N + i] += 2 * R * Math.sqrt(q) * q * m.k * 1.1;
          }
        }
      }
    }
    const floor = this.floor, L0 = 1 / this.L0;
    for (let n = 0; n < N * N; n++) {
      const t = floor + (1 - floor) * Math.exp(-tau[n] * L0);
      this.data[n] = Math.round(Math.min(1, t) * 255);
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void { this.texture.dispose(); }
}
