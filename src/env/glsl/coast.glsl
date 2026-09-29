// Coastline helper shared by the terrain and ocean shaders. The Gulf is everything east of x = coastX(z).
uniform sampler2D uCoast;        // R32F, COAST_N x 1: coastline x(z), z in [-COAST_R, COAST_R]
#define COAST_N 1024.0
#define COAST_R 16000.0

float slCoastX(float z) {
  float f = clamp((z + COAST_R) / (2.0 * COAST_R), 0.0, 1.0) * (COAST_N - 1.0);
  float i0 = floor(f);
  float a = texelFetch(uCoast, ivec2(int(i0), 0), 0).r;
  float b = texelFetch(uCoast, ivec2(int(min(i0 + 1.0, COAST_N - 1.0)), 0), 0).r;
  return mix(a, b, f - i0);
}
// signed distance (m) to the coastline: > 0 in the Gulf, < 0 on land
float slSeaDist(vec2 xz) {
  float xc = slCoastX(xz.y);
  float slope = (slCoastX(xz.y + 40.0) - slCoastX(xz.y - 40.0)) / 80.0;
  return (xz.x - xc) / sqrt(1.0 + slope * slope);
}

