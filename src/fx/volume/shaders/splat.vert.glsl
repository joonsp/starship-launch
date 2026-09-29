// Density bake, pass 1: instanced puff splatting into one z-layer of the 3D target.
// Each instance is a quad covering the puff's cross-section with the current layer plane; puffs that
// miss the layer are culled by emitting a degenerate position. Blending (set on the material):
//   RGB: dst *= (1 - src)   -> R accumulates prod(1 - d_i)   (probabilistic union)
//   A  : max(dst, src)      -> temperature
in vec4 aPuffA;   // centre.xyz (world m), radius (m)
in vec4 aPuffB;   // temperature 0..1, density multiplier, radius warp amplitude, seed
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform float uLayerZ;     // world z of the layer centre
uniform float uVoxel;      // max voxel size (m): pads the quad so thin puffs still hit a texel
out vec3 vWorld;
flat out vec4 vA;
flat out vec4 vB;
void main() {
  float rw = aPuffA.w * (1.0 + aPuffB.z) + uVoxel;
  float dz = uLayerZ - aPuffA.z;
  vA = aPuffA; vB = aPuffB;
  if (abs(dz) >= rw) { vWorld = vec3(0.0); gl_Position = vec4(4.0, 4.0, 4.0, 1.0); return; }
  float rho = sqrt(rw * rw - dz * dz) + uVoxel;
  vec2 xy = aPuffA.xy + position.xy * rho;
  vWorld = vec3(xy, uLayerZ);
  vec2 ndc = (xy - uBoxMin.xy) / uBoxSize.xy * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
}
