// Bake: 64^3 RGBA8 detail/erosion noise (tileable).
//   R, G, B = billowy Worley at 2, 4, 8 cells per tile; A = Perlin (4 cells) for rim wisps.
uniform float uZ;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
#include <vn_noise>
void main() {
  vec3 uvw = vec3(vUv, uZ);
  float w1 = 1.0 - vn_worley(uvw * 2.0, 2.0, 51.0);
  float w2 = 1.0 - vn_worley(uvw * 4.0, 4.0, 52.0);
  float w3 = 1.0 - vn_worley(uvw * 8.0, 8.0, 53.0);
  outColor = vec4(w1, w2, w3, vn_perlin(uvw * 4.0, 4.0, 54.0));
}
