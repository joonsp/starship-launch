// Typed access to specs/starship.json — the single source of truth shared with the Blender builds.
import raw from '../specs/starship.json';

export interface SpecValue {
  v: unknown;
  unit?: string;
  src?: string;
  est?: string;
}

const spec = raw as unknown as { values: Record<string, SpecValue> };

export const VALUES: Record<string, SpecValue> = spec.values;

/** Numeric spec value. Throws if missing or not a number. */
export function val(key: string): number {
  const e = spec.values[key];
  if (!e) throw new Error(`spec value missing: ${key}`);
  if (typeof e.v !== 'number') throw new Error(`spec value not numeric: ${key}`);
  return e.v;
}

/** Any spec value (arrays, strings, objects). */
export function raw_(key: string): unknown {
  const e = spec.values[key];
  if (!e) throw new Error(`spec value missing: ${key}`);
  return e.v;
}

export function vec3(key: string): [number, number, number] {
  const v = raw_(key);
  if (!Array.isArray(v) || v.length < 3) throw new Error(`spec value not a vec3: ${key}`);
  return [Number(v[0]), Number(v[1]), Number(v[2])];
}

export function isEstimate(key: string): boolean {
  const e = spec.values[key];
  return !!e && !e.src;
}

export function provenance(key: string): { kind: 'src' | 'est'; text: string } | null {
  const e = spec.values[key];
  if (!e) return null;
  return e.src ? { kind: 'src', text: e.src } : { kind: 'est', text: e.est ?? '' };
}
