// Full-resolution composite (owned by the volume module, contracts frame-graph step 3):
//   out = opaque.rgb * T_total + L_inscatter + plume.rgb * T(plume.a)
// Sources, per pixel:
//   1. the full-resolution accumulation (uAcc*), once this pixel has been traced at least once
//      since the last reset: exact, per-pixel depth-correct, converges to a clean still image;
//   2. otherwise a depth-aware (joint bilateral) upsample of the current low-res frame: every tap
//      is weighted by its distance to this pixel and by the similarity of its opaque depth to this
//      pixel's depth, so samples that stopped at the tower/vehicle never bleed onto the sky or the
//      clouds behind (no halos).
// With REFLECTION defined (the planar-reflection view, see VolumePass.renderView) uColor is a copy of the
// mirror target: rgb = opaque colour, a = linear view depth (the target's own depth texture is attached to the
// framebuffer this pass writes, so it cannot be sampled here); no plume, alpha 1.
uniform highp sampler2D uColor;
uniform highp sampler2D uDepth;
uniform highp sampler2D uPlume;
uniform highp sampler2D uAcc0;
uniform highp sampler2D uAcc1;
uniform highp sampler2D uVol0;
uniform highp sampler2D uVol1;
uniform vec2 uLowRes;
uniform vec2 uFullRes;
uniform vec2 uJitter;         // sub-pixel offset of the current low-res frame (0..1)
uniform float uNear;
uniform float uFar;
uniform int uUseAcc;
uniform int uHasDepth;
uniform int uHasPlume;
uniform int uDebug;           // 0 off, 1 = volume only, 2 = transmittance, 3 = coverage
in vec2 vUv;
layout(location = 0) out vec4 outColor;

float linDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
#ifdef REFLECTION
  vec4 opaque = texelFetch(uColor, q, 0);
  float z = opaque.a;
  opaque.a = 1.0;
#else
  vec4 opaque = texture(uColor, vUv);
  float z = uHasDepth == 1 ? linDepth(texelFetch(uDepth, q, 0).r) : uFar;
#endif

  vec4 vol = vec4(0.0, 0.0, 0.0, 1.0);
  float tp = 1.0;
  vec4 a1 = uUseAcc == 1 ? texelFetch(uAcc1, q, 0) : vec4(0.0);
  bool covered = a1.y > 0.5;
  if (covered) {
    vol = texelFetch(uAcc0, q, 0);
    tp = a1.x;
  } else {
    vec2 s = uFullRes / uLowRes;
    ivec2 c = ivec2(floor((vec2(q) + 0.5) / s));
    ivec2 hi = ivec2(uLowRes) - 1;
    vec4 acc0 = vec4(0.0);
    float acc1 = 0.0, wsum = 0.0, bestD = 1e30;
    vec4 best0 = vol;
    float best1 = 1.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        ivec2 lp = clamp(c + ivec2(i, j), ivec2(0), hi);
        vec2 pos = floor((vec2(lp) + uJitter) * s) + 0.5;      // where this sample was traced
        vec2 dp = (pos - (vec2(q) + 0.5)) / s;
        vec4 v0 = texelFetch(uVol0, lp, 0);
        vec4 v1 = texelFetch(uVol1, lp, 0);
        float dd = abs(v1.y - z);
        if (dd < bestD) { bestD = dd; best0 = v0; best1 = v1.x; }
        float k = dd / (0.025 * min(v1.y, z) + 0.5);
        float w = exp(-dot(dp, dp) * 1.5) * (exp(-k * k) + 1e-7);
        acc0 += v0 * w; acc1 += v1.x * w; wsum += w;
      }
    }
    if (wsum < 1e-4) { vol = best0; tp = best1; }
    else { vol = acc0 / wsum; tp = acc1 / wsum; }
  }

  vec3 col = opaque.rgb * vol.a + vol.rgb;
  if (uHasPlume == 1) {
    vec4 pl = texture(uPlume, vUv);
    if (pl.a > 0.0) col += pl.rgb * clamp(tp, 0.0, 1.0);
  }
  if (uDebug == 1) col = vol.rgb;
  else if (uDebug == 2) col = vec3(vol.a);
  else if (uDebug == 3) col = covered ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  outColor = vec4(col, opaque.a);
}
