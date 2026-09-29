// Temperature field of the launch cloud for the THERMAL view. OWNER: volume module.
// JS twin of steamKelvin() in shaders/march.frag.glsl (keep the two in step; thermal-field.test.ts pins the ranges).
//
// What a LWIR camera sees of the optically thick droplet cloud is its surface temperature, so the march integrates
// sl_thermalRamp(K) of this field as an emission-only medium (src/post/thermal.ts maps the ramp colour back to K).
//  - Steam that has mixed with the ~298 K morning air: ~334 K low down, cooling to ~310 K at the tops.
//  - The hot exhaust / flashed-steam mixture leaves both flame-trench ends (|s| ~ 38 m along the axis) as a wall jet.
//    Its centreline excess temperature falls ~1/(1 + x/x0) as it entrains air (x = distance past the exit), it spreads
//    sideways and upward, and the gas that rose into the banks has mixed the more the higher it got.
//  - Round the mount the flame bucket feeds hot gas up the plume foot.
//  - The baked fireball / outflow puffs (the density bake's temperature channel) are the flame itself: 700-2500 K.
//  - Mixing: pockets of hotter and cooler gas (the render's turbulent noise, 0..1) and cooler, air-diluted thin edges.

export interface ThermalSample {
  /** Along the trench axis (m, + = ESE), across it (m) and height above ground (m). */
  s: number; l: number; h: number;
  /** Horizontal distance from the mount (m); default = hypot(s, l). */
  r?: number;
  /** Normalised steam density (0..1), turbulent mixing variable (0..1, mean 0.5), baked temperature channel (0..1). */
  dens?: number; mix?: number; tempG?: number;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Kelvin of the launch cloud at a sample (see the header). */
export function steamKelvin(q: ThermalSample): number {
  const h = Math.max(q.h, 0);
  const dens = q.dens ?? 1, mixN = q.mix ?? 0.5, tempG = q.tempG ?? 0;
  const x = Math.max(Math.abs(q.s) - 38, 0);
  const bw = 16 + 0.3 * x, bh = 14 + 0.2 * x;
  const jet = Math.exp(-(q.l * q.l) / (bw * bw)) * Math.exp(-h / bh) / (1 + x / 40);
  const r = q.r ?? Math.hypot(q.s, q.l);
  const foot = Math.exp(-(r * r) / (45 * 45)) * Math.exp(-h / 55);
  const bank = Math.exp(-h / 75) / (1 + x / 90);
  let excess = 1150 * Math.max(jet, 0.8 * foot) + 110 * bank;
  excess *= (0.55 + 0.9 * mixN) * (0.6 + 0.4 * smooth(0.03, 0.5, dens));
  const kSteam = 308 + 26 * Math.exp(-h / 110) + excess;
  const kFire = (700 + 1800 * smooth(0.1, 1, tempG)) * (0.9 + 0.18 * mixN);
  const f = smooth(0.06, 0.2, tempG);
  return Math.max(kSteam, kSteam + (kFire - kSteam) * f);
}
