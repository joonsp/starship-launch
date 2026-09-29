// Density bake, pass 2: splat accumulation -> final RG16F density volume.
//   R = normalised density 0..1 (1 - prod(1 - d_i)), softly faded near the side/top faces of the box
//       so no flat cut can ever appear; the floor (ground) is kept.
//   G = normalised temperature 0..1 (emission / thermal view).
// Rising steam mixes with ambient air, so the density falls off with height (uDilution): the tall
// sunlit tops of the photo glow translucent orange while the bases stay dense.
uniform highp sampler3D uSplat;
uniform float uLayer;
uniform vec3 uRes;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform float uFaceFade;
uniform vec3 uDilution;      // (y0, y1, density factor at y1): rising steam dilutes with height
layout(location = 0) out vec4 outColor;
void main() {
  ivec3 c = ivec3(ivec2(gl_FragCoord.xy), int(uLayer));
  vec4 s = texelFetch(uSplat, c, 0);
  float d = clamp(1.0 - s.r, 0.0, 1.0);
  vec3 p = uBoxMin + (vec3(c) + 0.5) / uRes * uBoxSize;
  vec3 lo = p - uBoxMin, hi = uBoxMin + uBoxSize - p;
  float e = min(min(min(lo.x, hi.x), min(lo.z, hi.z)), hi.y);
  d *= smoothstep(0.0, uFaceFade, e);
  d *= mix(1.0, uDilution.z, smoothstep(uDilution.x, uDilution.y, p.y));
  outColor = vec4(d, clamp(s.a, 0.0, 1.0), 0.0, 1.0);
}
