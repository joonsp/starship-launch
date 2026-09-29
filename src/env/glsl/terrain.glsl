// Terrain surface model (chunk injected into MeshStandardMaterial after <common>; see terrain.ts).
// Everything is a function of the world position, the splat masks (OSM) and a tileable noise texture, so the
// terrain mesh itself is just a flat quad: tidal-flat pools are shaded, not modelled (they are 0.1-0.5 m deep).
uniform sampler2D uMaskIA;
uniform sampler2D uMaskIB;
uniform sampler2D uMaskOA;
uniform sampler2D uMaskOB;
uniform sampler2D uNoise;
uniform sampler2D uWave;         // tileable slope map (RG = slopes, BA = slopes one octave up)
uniform sampler2D uCell;         // tileable cellular noise for near-field cracks / pebbles / tufts
uniform sampler2D uReflect;      // planar reflection of the world at y = 0
uniform mat4      uReflMat;
uniform samplerCube uSkyCube;    // full sky (clouds included): fallback reflection when no planar reflection exists
uniform vec4      uPool;         // x threshold, y bias strength, z channel amount, w vegetation patches
uniform vec4      uBounce;       // rgb = warm bounce light from the orange steam banks / fireball, w = falloff radius (m)
uniform vec4      uReflParams;   // x reflection available, y reflection strength for wet mud, z ripple, w -

#define INNER_HALF 2560.0
#define OUTER_HALF 16000.0

vec4 slNz(vec2 p, float period) { return texture(uNoise, p / period); }

// Warm fill from the launch clouds: the huge sunlit/fire-lit steam banks flood the surrounding ground with orange.
vec3 slBounce(vec3 wp) {
  float d = length(wp.xz - vec2(0.0, 20.0));
  return uBounce.rgb * exp(-d / max(uBounce.w, 1.0));
}

struct SlSurface {
  vec3  albedo;
  float rough;
  float water;     // 0..1 open water coverage (pool / channel / OSM water)
  float depth;     // water depth (m)
  float wet;       // 0..1 wet ground (glossy)
  vec3  nW;        // world normal
  float kelvin;
};

// hard-ish threshold with a width that follows the screen-space derivative (anti-aliased, resolution independent)
float slEdge(float v, float soft) {
  float w = max(fwidth(v) * 1.2, 1e-4) + soft;
  return smoothstep(-w, w, v);
}

SlSurface slTerrain(vec3 wp, float camDist) {
  SlSurface s;
  vec2 xz = wp.xz;

  // ------------------------------------------------------------ OSM splat masks (inner 1.25 m/px, outer ring 16 m/px)
  vec2 uvI = (xz + INNER_HALF) / (2.0 * INNER_HALF);
  vec2 uvO = (xz + OUTER_HALF) / (2.0 * OUTER_HALF);
  float wIn = 1.0 - smoothstep(0.80, 0.97, max(abs(xz.x), abs(xz.y)) / INNER_HALF);
  vec4 A = mix(texture(uMaskOA, uvO), texture(uMaskIA, uvI), wIn);
  vec4 B = mix(texture(uMaskOB, uvO), texture(uMaskIB, uvI), wIn);
  float flatM = A.r, scrubM = A.g, waterM = A.b, sandM = B.r, gravelM = B.g, dampM = B.b;

  // ------------------------------------------------------------ noise at several scales (all tileable fbm)
  vec4 n1 = slNz(xz, 1900.0);
  vec4 n2 = slNz(xz, 430.0);
  vec4 n3 = slNz(xz, 83.0);
  vec4 n4 = slNz(xz, 13.0);
  // two rotated, incommensurate taps hide the tile period of the finest detail
  vec4 n5 = mix(slNz(mat2(0.8, -0.6, 0.6, 0.8) * xz, 3.7), slNz(xz * 1.0 + 11.7, 9.1), 0.5);
  // near-field fades: tiny detail averages to 0.5 anyway through the mip chain, but keep it cheap and stable
  float nearF = 1.0 - smoothstep(60.0, 420.0, camDist);
  // cellular detail for walking-height views: 0.5 m crust plates / cracks and 0.12 m pebbles or grass tufts
  // warped so plates and cracks come out irregular rather than as a regular hexagonal tiling
  vec2 cq = xz + (n4.rg - 0.5) * 0.55 + (n5.gb - 0.5) * 0.18;
  // (blend the *results* of two fixed scales: dividing the absolute position by a varying scale destroys the derivatives)
  vec4 c1 = mix(texture(uCell, cq / 4.1), texture(uCell, cq / 6.7 + 0.5), n3.a);
  vec4 c2 = texture(uCell, cq / 1.37 + 0.31);
  float nearC = 1.0 - smoothstep(8.0, 70.0, camDist);

  // ------------------------------------------------------------ moisture: drives pools, wet mud and vegetation
  vec2 warp = (n2.rg - 0.5) * 120.0 + (n3.gb - 0.5) * 22.0;
  vec4 m1 = slNz(xz + warp, 290.0);
  vec4 m2 = slNz(xz + warp * 0.6, 84.0);
  float moist = m1.a * 0.62 + m2.r * 0.31 + n4.g * 0.07;
  // pools like the lower, foreground flats south of the pad (photo): stronger bias there
  float bias = uPool.y * exp(-length(xz - vec2(-120.0, 330.0)) / 700.0);
  float flatMask = smoothstep(0.25, 0.75, flatM + (n4.r - 0.5) * 0.45) * (1.0 - smoothstep(0.35, 0.65, scrubM + (n4.b - 0.5) * 0.3));
  // no pools right at the pad: the ground there is graded and compacted
  float padCalm = 0.14 * exp(-length(xz - vec2(0.0, 10.0)) / 190.0);
  float pf = moist + bias + dampM * 0.12 - uPool.x - padCalm;
  float pool = slEdge(pf + (n4.g - 0.5) * 0.02 * nearF, 0.0035) * flatMask;
  // thin sinuous tidal channels (ridged noise), most common where it is already damp
  float ridge = 1.0 - abs(2.0 * m2.g - 1.0);
  float chan = smoothstep(0.955 - 0.015 * uPool.z, 0.985, ridge) * flatMask * smoothstep(0.38, 0.55, moist) * uPool.z;
  float osmW = smoothstep(0.42, 0.58, waterM + (n4.g - 0.5) * 0.18 * nearF);
  s.water = max(max(pool, chan), osmW);
  s.depth = 0.03 + 0.55 * clamp(pf * 3.0, 0.0, 1.0) * pool + 0.6 * osmW;
  s.depth = mix(s.depth, 0.03 + 0.3 * chan, step(pool, chan) * step(osmW, chan));

  // ------------------------------------------------------------ ground materials (linear albedo, measured off the photo)
  float grain = n5.r * 0.5 + n4.r * 0.35 + n3.r * 0.15;          // 0..1
  // tidal flat: pale salt crust on the highest ground, olive algal mats in the mid tones, dark glossy mud where wet
  vec3 dryCrust = mix(vec3(0.075, 0.051, 0.034), vec3(0.135, 0.095, 0.064), smoothstep(0.35, 0.7, n3.r * 0.6 + n2.b * 0.4));
  vec3 algal = mix(vec3(0.040, 0.034, 0.019), vec3(0.075, 0.060, 0.032), n4.a * 0.6 + n3.a * 0.4);
  vec3 wetMud = vec3(0.026, 0.018, 0.013);
  float wetness = smoothstep(0.46, 0.62, moist + dampM * 0.25);
  float algalK = smoothstep(0.42, 0.62, n2.g * 0.62 + n3.b * 0.18 + (moist - 0.5) * 0.7) * (1.0 - smoothstep(0.60, 0.78, moist));
  // wet margin: darkening in a band around water (distance-like proxy from pf)
  float margin = 1.0 - smoothstep(0.0, 0.03, abs(pf) + (n4.r - 0.5) * 0.015);
  wetness = max(wetness, margin * 0.85);
  vec3 flatCol = mix(dryCrust, algal, algalK * 0.8);
  flatCol = mix(flatCol, wetMud, wetness * 0.9);
  flatCol *= 0.94 + 0.12 * grain;
  // dry salt-crust plates: per-plate tone, dark crack lines, a slight pebbled grain
  float dryK = (1.0 - wetness) * (1.0 - algalK * 0.5) * nearC;
  float crackLine = (1.0 - smoothstep(0.0, 0.055, c1.g)) * (0.5 + 0.5 * (1.0 - smoothstep(0.0, 0.08, c2.g))) * smoothstep(0.22, 0.55, n4.a + n3.b * 0.4);
  flatCol *= 1.0 - 0.45 * crackLine * dryK;
  flatCol *= 1.0 + (c1.b - 0.5) * 0.16 * dryK + (c2.r - 0.5) * 0.14 * nearC;
  // salt-marsh grass / scrub: OSM scrub + procedural vegetation patches on the flats
  float vegProc = slEdge(n3.b * 0.55 + n4.a * 0.25 + m1.r * 0.2 - (0.60 - uPool.w * 0.08), 0.02) * flatMask * (1.0 - pool) * (1.0 - wetness * 0.6);
  float scrubEdge = smoothstep(0.30, 0.55, scrubM + (n4.b - 0.5) * 0.3);
  float veg = max(smoothstep(0.35, 0.65, scrubM + (n4.b - 0.5) * 0.3), vegProc * 0.85);
  // olive / green / straw patches with a fine tufty grain; a darker wet rim where the marsh meets the flat
  vec3 vegCol = mix(vec3(0.050, 0.046, 0.021), vec3(0.098, 0.080, 0.038), smoothstep(0.3, 0.7, n2.g * 0.5 + n3.g * 0.5));
  vegCol = mix(vegCol, vec3(0.056, 0.070, 0.026), smoothstep(0.55, 0.8, n2.a) * 0.55);          // greener patches
  vegCol = mix(vegCol, vec3(0.19, 0.15, 0.085), smoothstep(0.66, 0.85, n2.b * 0.6 + n3.r * 0.4) * 0.5);   // dry straw
  vegCol *= 0.62 + 0.80 * (n3.g * 0.35 + n5.g * 0.30 + n4.g * 0.35);
  vegCol *= 1.0 + (c2.a - 0.5) * 0.45 * nearC + (c1.b - 0.5) * 0.30 * nearC;       // grass-tuft mottling near the camera
  vegCol *= 1.0 - 0.45 * (1.0 - smoothstep(0.55, 0.85, scrubM));                                // dark wet rim
  // dry, unmapped land: scruffy grass and soil
  vec3 dryLand = mix(vec3(0.052, 0.043, 0.024), vec3(0.105, 0.082, 0.05), smoothstep(0.25, 0.75, n3.g * 0.5 + n2.r * 0.3 + n4.r * 0.2));
  vec3 sandCol = mix(vec3(0.36, 0.30, 0.21), vec3(0.45, 0.39, 0.29), n4.r);
  vec3 gravCol = mix(vec3(0.15, 0.14, 0.12), vec3(0.24, 0.225, 0.20), n4.g * 0.55 + n3.r * 0.3 + n5.r * 0.15);

  float landFlat = flatMask;
  vec3 col = mix(dryLand, flatCol, landFlat);
  col = mix(col, vegCol, veg);
  float vegOnly = veg;
  col = mix(col, sandCol, smoothstep(0.4, 0.6, sandM + (n4.r - 0.5) * 0.25));
  col = mix(col, gravCol, smoothstep(0.35, 0.6, gravelM));
  float rough = mix(0.9, 0.42, wetness * landFlat * (1.0 - veg));
  rough = mix(rough, 0.95, veg);
  s.wet = wetness * landFlat * (1.0 - veg);

  // ------------------------------------------------------------ beach: sand darkens/glosses toward the swash zone
  float sd = slSeaDist(xz);
  float swash = 1.0 - smoothstep(-16.0, 1.0, sd + (n3.r - 0.5) * 12.0 + (n4.g - 0.5) * 3.0);
  col = mix(col, col * vec3(0.52, 0.5, 0.47), swash * step(0.25, sandM + swash * 0.2));
  s.wet = max(s.wet, swash * 0.9 * step(0.25, sandM + swash * 0.2));
  rough = mix(rough, 0.32, swash * 0.85);

  s.albedo = col;
  s.rough = rough;

  // ------------------------------------------------------------ micro relief normal
  // Slopes come straight from a tileable slope map (see makeWaveSlopes) at three scales. They are mip-filtered by the
  // hardware and each scale fades out well before its wavelength drops under ~2 pixels, so there is no aliasing. (An
  // earlier version derived the normal from screen-space derivatives of a height field; that is fragile: a single
  // bad derivative at grazing angles turns the ground into white sparkle.)
  float fA = 1.0 - smoothstep(4.0, 26.0, camDist);
  float fB = 1.0 - smoothstep(22.0, 110.0, camDist);
  float fC = 1.0 - smoothstep(120.0, 600.0, camDist);
  vec2 g = ((texture(uWave, xz / 1.7 + 0.13).rg - 0.5) * 0.05 * fA * (1.0 - wetness * 0.6)
         + (texture(uWave, xz / 8.3 + 0.41).rg - 0.5) * 0.07 * fB
         + (texture(uWave, xz / 41.0 + 0.77).ba - 0.5) * 0.10 * fC) * (2.0 / 1.6);
  // dry crust plates: tilt each plate a little (cell id -> direction) and roll the cracks' edges
  g += (vec2(c1.b, fract(c1.b * 7.31)) - 0.5) * 0.10 * dryK * fA;
  g *= (1.0 - s.water);
  // frozen micro-ripples on water (very flat: the pools in the photo are nearly mirrors)
  vec2 rip = ((slNz(xz, 4.1).rg - 0.5) * 0.030 + (slNz(xz + 17.3, 0.93).rg - 0.5) * 0.010) * uReflParams.z * (0.4 + 0.6 * nearF);
  vec2 slope = mix(-g, rip, s.water);
  s.nW = normalize(vec3(slope.x, 1.0, slope.y));
  s.kelvin = mix(mix(296.0, 286.0, wetness), 291.0, s.water);
  s.kelvin = mix(s.kelvin, 312.0, smoothstep(0.35, 0.6, gravelM));
  return s;
}
