// Empty-space-skipping volume: max density over an N^3 block of the density volume (plus a one-voxel
// border for the trilinear footprint). R8, sampled with texelFetch by the marcher.
uniform highp sampler3D uDensity;
uniform float uLayer;
uniform float uBlock;
layout(location = 0) out vec4 outColor;
void main() {
  ivec3 res = textureSize(uDensity, 0);
  int B = int(uBlock);
  ivec3 c0 = ivec3(ivec2(gl_FragCoord.xy), int(uLayer)) * B - 1;
  float m = 0.0;
  for (int z = 0; z < 18; z++) {
    if (z >= B + 2) break;
    for (int y = 0; y < 18; y++) {
      if (y >= B + 2) break;
      for (int x = 0; x < 18; x++) {
        if (x >= B + 2) break;
        ivec3 q = clamp(c0 + ivec3(x, y, z), ivec3(0), res - 1);
        m = max(m, texelFetch(uDensity, q, 0).r);
      }
    }
  }
  outColor = vec4(m, 0.0, 0.0, 1.0);
}
