// Tunable parameters of the launch-cloud volume. OWNER: volume module.
// Everything here is art-directable at runtime (lil-gui in the sandbox, or the integrator's debug UI).
// Values marked (rebake) require VolumeModule.requestRebake('light') to take effect, since they are
// baked into the light volume; everything else is a live uniform.
//
// Radiance scale follows src/contracts.ts: sun-lit white diffuse ~1-3, fireball ~5-20.

export interface VolumeParams {
  /** Extinction coefficient (1/m) at normalised density 1. Dense launch steam reads opaque over ~10-20 m. (rebake) */
  sigma: number;
  /** Single-scattering albedo of the steam (water droplets: ~0.99). */
  albedo: number;
  /** Dual-lobe Henyey-Greenstein: forward g, backward g, forward weight. */
  hgForward: number;
  hgBack: number;
  hgMix: number;
  /** Wrenninge multiple-scattering octaves: a (energy), b (extinction), c (phase eccentricity), count. */
  msA: number;
  msB: number;
  msC: number;
  /** Beer-powder strength (0 = off). Darkens thin sun-facing rims when looking away from the sun. */
  powder: number;
  /** Gains on the light terms (artistic calibration against the reference photo). */
  sunGain: number;
  ambientGain: number;
  plumeGain: number;
  /** Fireball: gain on the blackbody emission and on its light (the baked fire-irradiance term). */
  emissionGain: number;
  fireLightGain: number;
  /** Fire light colour temperature (K) used for the fire-irradiance term. */
  fireLightKelvin: number;
  /**
   * Similarity-reduced extinction (van de Hulst: sigma' ~ sigma (1 - g)) for the LIGHT transport:
   * steam droplets scatter strongly forward, so diffuse light penetrates far deeper than the view-ray
   * mean free path. Applied to the sun optical depth (live) and to the fire/plume light (rebake).
   */
  sunTauScale: number;
  fireTauScale: number;
  /** Shape-noise erosion strength (0..1) and world scale (m per tile). */
  shapeAmount: number;
  shapeScale: number;
  /** Detail (Worley) erosion strength and scale (m per tile). */
  detailAmount: number;
  detailScale: number;
  /** Density contrast after erosion (1 = soft; 3-5 = crisp billow outlines, as dense steam). */
  crisp: number;
  /** Near-camera density fade distance (m): so a walking camera never clips into a wall of steam. */
  nearFade: number;
  /** Accumulated frames after which the march stops (still camera). */
  maxFrames: number;
  /** Drift mode: wind (m/s, x/z), billow rise speed (m/s) and growth rate (fraction per 100 s, capped). */
  windX: number;
  windZ: number;
  riseSpeed: number;
  growth: number;
}

export const DEFAULT_PARAMS: VolumeParams = {
  sigma: 0.6,
  albedo: 0.985,
  hgForward: 0.72,
  hgBack: -0.28,
  hgMix: 0.72,
  msA: 0.35,
  msB: 0.35,
  msC: 0.55,
  powder: 0.5,
  sunGain: 8,
  ambientGain: 0.9,
  plumeGain: 18,
  emissionGain: 1.2,
  fireLightGain: 14,
  fireLightKelvin: 1650,
  sunTauScale: 0.6,
  fireTauScale: 0.5,
  shapeAmount: 0.3,
  shapeScale: 300,
  detailAmount: 0.7,
  detailScale: 30,
  crisp: 3.5,
  nearFade: 6,
  maxFrames: 128,
  windX: 1.6,
  windZ: -0.6,
  riseSpeed: 1.2,
  growth: 0.06,
};

/** Normalised temperature channel (G) -> kelvin. G = 0 is ambient steam; G = 1 is the fireball core. */
export const TEMP_KELVIN_MIN = 330;
export const TEMP_KELVIN_MAX = 2500;
