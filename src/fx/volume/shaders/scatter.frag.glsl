// Scatter: writes this frame's low-res samples into the full-resolution accumulation at the exact
// pixels they were traced through (see march.frag.glsl). Pixels not traced this frame discard.
// Blending (set on the material): dst = src * a + dst * (1 - a) with a = blendAlpha = 1 / (m + 1),
// m = previous visits of this sub-pixel offset: an exact running mean per pixel (EMA in drift mode).
//   out0 = (L.rgb, T)      out1 = (T_plume, coverage = 1, depthRef, tFront)
uniform highp sampler2D uCur0;
uniform highp sampler2D uCur1;
uniform vec2 uLowRes;
uniform vec2 uFullRes;
uniform vec2 uJitter;
layout(location = 0) out vec4 out0;
layout(location = 1) out vec4 out1;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  vec2 s = uFullRes / uLowRes;
  ivec2 lp = min(ivec2(floor((vec2(q) + 0.5) / s)), ivec2(uLowRes) - 1);
  ivec2 q2 = min(ivec2(floor((vec2(lp) + uJitter) * s)), ivec2(uFullRes) - 1);
  if (q2 != q) discard;
  vec4 c0 = texelFetch(uCur0, lp, 0);
  vec4 c1 = texelFetch(uCur1, lp, 0);
  out0 = c0;
  out1 = vec4(c1.x, 1.0, c1.y, c1.z);
}
