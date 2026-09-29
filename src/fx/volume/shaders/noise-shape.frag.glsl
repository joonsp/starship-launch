// Bake: 128^3 RGBA8 shape noise (tileable).
//   R = Perlin-Worley (Schneider 2015): Perlin fBm dilated by billowy Worley fBm -> round, connected billows
//   G, B, A = billowy Worley fBm at 8, 16, 32 cells per tile (increasing frequency)
uniform float uZ;     // layer centre in 0..1
in vec2 vUv;
layout(location = 0) out vec4 outColor;
#include <vn_noise>
void main() {
  vec3 uvw = vec3(vUv, uZ);
  float pf = 0.0, amp = 0.5, tot = 0.0;
  for (int i = 0; i < 4; i++) {
    float per = 4.0 * exp2(float(i));
    pf += amp * vn_perlin(uvw * per, per, float(i) * 3.0);
    tot += amp; amp *= 0.5;
  }
  pf /= tot;
  float wf = vn_worleyFbm(uvw, 4.0, 11.0);
  float pw = vn_remap(pf, 0.0, 1.0, wf, 1.0);
  pw = clamp((pw - 0.35) / 0.65, 0.0, 1.0);
  outColor = vec4(pw, vn_worleyFbm(uvw, 8.0, 21.0), vn_worleyFbm(uvw, 16.0, 31.0), vn_worleyFbm(uvw, 32.0, 41.0));
}
