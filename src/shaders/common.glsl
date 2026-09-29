// Shared GLSL helpers. OWNER: orchestrator. Import with:  import common from '../shaders/common.glsl?raw'
// Paste `common` near the top of a shader (after precision / uniform declarations).
// Expects no uniforms of its own. Pass globals in explicitly.

#ifndef SL_COMMON
#define SL_COMMON

#define VIEW_PHOTO 0
#define VIEW_THERMAL 1
#define VIEW_CLAY 2

const float SL_PI = 3.14159265359;

float sl_saturate(float x) { return clamp(x, 0.0, 1.0); }

// ---------------------------------------------------------------- hashing / noise
float sl_hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float sl_hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
// Interleaved gradient noise (Jimenez 2014): cheap per-pixel jitter, animated by frame index.
float sl_ign(vec2 pixel, float frame) {
  pixel += 5.588238 * mod(frame, 64.0);
  return fract(52.9829189 * fract(0.06711056 * pixel.x + 0.00583715 * pixel.y));
}

// ---------------------------------------------------------------- colour
// Approximate linear-sRGB chromaticity of a blackbody at temperature T (kelvin), normalised so max = 1.
// Tanner Helland fit, converted to linear. Valid ~1000..40000 K.
vec3 sl_blackbody(float T) {
  T = clamp(T, 1000.0, 40000.0) / 100.0;
  float r = T <= 66.0 ? 1.0 : clamp(1.29293618606 * pow(T - 60.0, -0.1332047592), 0.0, 1.0);
  float g = T <= 66.0 ? clamp(0.39008157876 * log(T) - 0.63184144378, 0.0, 1.0)
                      : clamp(1.12989086089 * pow(T - 60.0, -0.0755148492), 0.0, 1.0);
  float b = T >= 66.0 ? 1.0 : (T <= 19.0 ? 0.0 : clamp(0.54320678911 * log(T - 10.0) - 1.19625408914, 0.0, 1.0));
  vec3 c = pow(vec3(r, g, b), vec3(2.2));
  return c / max(max(c.r, c.g), max(c.b, 1e-4));
}

// Thermal-camera false colour (ironbow-like). Maps kelvin -> linear HDR colour.
// 250 K (cold frost) -> black/indigo, ~300 K ambient -> purple, ~600 K -> orange, >=2000 K -> white-hot.
vec3 sl_thermalRamp(float kelvin) {
  float x = clamp(log(max(kelvin, 200.0) / 240.0) / log(3500.0 / 240.0), 0.0, 1.0);
  vec3 c0 = vec3(0.00, 0.00, 0.02);
  vec3 c1 = vec3(0.12, 0.00, 0.35);
  vec3 c2 = vec3(0.60, 0.02, 0.45);
  vec3 c3 = vec3(1.00, 0.30, 0.02);
  vec3 c4 = vec3(1.00, 0.85, 0.20);
  vec3 c5 = vec3(1.00, 1.00, 1.00);
  vec3 c;
  if (x < 0.2) c = mix(c0, c1, x / 0.2);
  else if (x < 0.4) c = mix(c1, c2, (x - 0.2) / 0.2);
  else if (x < 0.6) c = mix(c2, c3, (x - 0.4) / 0.2);
  else if (x < 0.8) c = mix(c3, c4, (x - 0.6) / 0.2);
  else c = mix(c4, c5, (x - 0.8) / 0.2);
  return c * (0.6 + 1.4 * x); // hotter = brighter so bloom still reads
}

float sl_luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// ---------------------------------------------------------------- phase functions
float sl_hg(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * SL_PI * pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4), 1.5));
}

// ---------------------------------------------------------------- plume light
// Irradiance-like falloff from the plume modelled as a line segment A->B (uniform emitter).
// Returns an unnormalised factor ~ 1/d^2-ish, softened near the segment. Multiply by uPlumeLight.
float sl_plumeLineFalloff(vec3 p, vec3 a, vec3 b, float softRadius) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
  vec3 q = a + ab * t;
  float d2 = dot(p - q, p - q) + softRadius * softRadius;
  // brighter near the base (fireball) than the top
  float along = mix(1.6, 0.8, t);
  return along * 1e4 / d2;
}

// ---------------------------------------------------------------- aerial perspective
vec3 sl_applyFog(vec3 col, float dist, vec3 fogColor, float density) {
  float f = 1.0 - exp(-pow(dist * density, 2.0));
  return mix(col, fogColor, clamp(f, 0.0, 1.0));
}

#endif
