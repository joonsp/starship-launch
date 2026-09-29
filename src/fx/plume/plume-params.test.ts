// Sanity checks for the plume's physically derived numbers (vitest: npx vitest run src/fx/plume).
import { describe, expect, it } from 'vitest';
import {
  BOUND_SPREAD, BOUND_TOP_R, COLUMN_R0, COLUMN_SPREAD, EXIT_D, EXIT_PRESSURE_RATIO, JET_NECK,
  LIGHT_COLOUR, SHOCK_CELL_LENGTH, blackbody, engineRings,
} from './plume-params.ts';

describe('plume params', () => {
  it('shock-cell spacing ≈ 5.2 exit diameters ≈ 6.2 m (M_e 4.1, D_e 1.2 m)', () => {
    expect(SHOCK_CELL_LENGTH / EXIT_D).toBeGreaterThan(5.0);
    expect(SHOCK_CELL_LENGTH / EXIT_D).toBeLessThan(5.4);
    expect(SHOCK_CELL_LENGTH).toBeCloseTo(6.2, 1);
  });

  it('the nozzle is slightly over-expanded at sea level', () => {
    expect(EXIT_PRESSURE_RATIO).toBeLessThan(1);
    expect(EXIT_PRESSURE_RATIO).toBeGreaterThan(0.6);
    expect(JET_NECK).toBeGreaterThan(0.03);
    expect(JET_NECK).toBeLessThan(0.12);
  });

  it('engine rings come from engine-layout: 3 + 10 + 20 = 33', () => {
    const r = engineRings();
    expect(r.centre.length).toBe(3);
    expect(r.mid.count).toBe(10);
    expect(r.outer.count).toBe(20);
    expect(r.outer.radius).toBeGreaterThan(r.mid.radius);
    // outer nozzle edges fit inside the analytic bound at the engine plane
    expect(r.outer.radius + EXIT_D / 2).toBeLessThan(BOUND_TOP_R);
  });

  it('the bound encloses the merged column down to the deflector', () => {
    const s = 162;
    const column = (COLUMN_R0 + COLUMN_SPREAD * s) * 1.16 * 1.1 + 0.2 + 0.012 * s; // flare, skin, warp
    expect(BOUND_TOP_R + BOUND_SPREAD * s).toBeGreaterThan(column);
  });

  it('blackbody chromaticity: orange at 2000-2500 K, max component 1', () => {
    const c = blackbody(2300);
    expect(c.r).toBe(1);
    expect(c.g).toBeLessThan(0.45);
    expect(c.b).toBeLessThan(0.1);
    expect(Math.max(LIGHT_COLOUR.r, LIGHT_COLOUR.g, LIGHT_COLOUR.b)).toBeCloseTo(1, 5);
  });
});
