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
  /** Diffusion decay of the fire/plume light per optical depth, ~sqrt(3 (1 - albedo)(1 - g)). (rebake) */
  fireTauScale: number;
  /**
   * Fine-aerosol reddening (dust, soot, salt from the pad; Angstrom-like): extra extinction per unit
   * sun optical depth for R, G, B. Sunlight that diffused deep into the cloud leaves it amber.
   */
  reddenR: number;
  reddenG: number;
  reddenB: number;
  /**
   * Vertical optical depth (in the same units) of that aerosol in the boundary-layer haze at the ground
   * (scale height 250 m). The sun's slant path through it is ~1/sin(elevation): amber at sunrise, nothing at noon.
   */
  reddenHaze: number;
  /** Share (0..1) of that aerosol mixed into the cloud itself (reddens deep, multiply scattered light at any sun height). */
  reddenCloud: number;
  /** Albedo tint of the ground-hugging, dust-laden steam (rgb) and the height (m) over which it fades out. */
  dustR: number;
  dustG: number;
  dustB: number;
  dustHeight: number;
  /** Weight (0..1) of the near-field sky occlusion on the detailed density (billow undersides). */
  skyOcclusion: number;
  /**
   * Diffuse sun transmission through the thick banks, ~1/(1 + 0.75 (1 - g) tau) x exp(-sunAbsorb tau):
   * strength (0 = off) and absorption per optical depth (~sqrt(3 (1 - albedo)(1 - g)) for pure droplets).
   */
  sunDiffuse: number;
  sunAbsorb: number;
  /** 0..1: how strongly the steam's density-gradient normal splits the ambient between sky (up) and ground (down). */
  normalAmbient: number;
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
  sunGain: 9,
  ambientGain: 1.2,
  plumeGain: 26,
  emissionGain: 0.6,
  fireLightGain: 30,
  fireLightKelvin: 2300,
  sunTauScale: 0.7,
  fireTauScale: 0.08,
  reddenR: 0.0,
  reddenG: 0.2,
  reddenB: 0.55,
  reddenHaze: 0.36,
  reddenCloud: 0.45,
  dustR: 0.5,
  dustG: 0.46,
  dustB: 0.43,
  dustHeight: 55,
  skyOcclusion: 0.8,
  normalAmbient: 0.6,
  sunDiffuse: 0.8,
  sunAbsorb: 0.035,
  shapeAmount: 0.3,
  shapeScale: 300,
  detailAmount: 0.85,
  detailScale: 18,
  crisp: 12,
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
