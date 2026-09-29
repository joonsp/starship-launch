// Booster (33 Raptor 3) and ship (3 RSL + 3 RVac) engine layout from the spec. OWNER: orchestrator.
// Positions are in the VEHICLE frame: origin on the axis at the engine plane (booster aft-skirt
// bottom), y up; x/z in the plane. Angles are measured from +x toward -z (counter-clockwise from above).
// The vehicle builder (Blender) must use the same formulas; the plume module uses these for the jets.
import { val, raw_ } from '../specs.ts';

export interface EngineSlot { ring: 'centre' | 'mid' | 'outer'; x: number; z: number; angleDeg: number; gimbaled: boolean }

const DEG = Math.PI / 180;

export function boosterEngines(): EngineSlot[] {
  const out: EngineSlot[] = [];
  const rc = val('vehicle.booster.engine_ring_centre.radius');
  const clock = raw_('vehicle.booster.engine_ring_centre.clocking') as number[]; // e.g. [108,108,144] gaps
  let a = 90; // first centre engine points +z-ward-ish; arbitrary but fixed
  for (let i = 0; i < 3; i++) { out.push(slot('centre', rc, a, true)); a += clock[i] ?? 120; }
  const rm = val('vehicle.booster.engine_ring_mid.radius');
  const mOff = val('vehicle.booster.engine_ring_mid.clock_offset');
  for (let i = 0; i < 10; i++) out.push(slot('mid', rm, mOff + i * 36, true));
  const ro = val('vehicle.booster.engine_ring_outer.radius');
  for (let i = 0; i < 20; i++) out.push(slot('outer', ro, i * 18, false));
  return out;
}

function slot(ring: EngineSlot['ring'], r: number, angleDeg: number, gimbaled: boolean): EngineSlot {
  return { ring, x: r * Math.cos(angleDeg * DEG), z: -r * Math.sin(angleDeg * DEG), angleDeg, gimbaled };
}

/** Sea-level nozzle exit diameter (m) and approximate engine length (m). */
export const NOZZLE_EXIT_D = val('vehicle.raptor3.nozzle_exit_diameter_sl');
export const ENGINE_LENGTH = val('vehicle.raptor3.length_sl');
/** How far the nozzle exits hang below the engine plane (the aft skirt bottom edge). Estimate. */
export const NOZZLE_EXIT_BELOW_PLANE = 0.6;
