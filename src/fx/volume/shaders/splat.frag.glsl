// Density bake, pass 1 (fragment): one puff's contribution at this voxel.
// The radius is warped per direction with fBm read from the shape noise at the puff's surface point,
// scaled to the puff size, so every puff (at every hierarchy level) gets self-similar lumps.
uniform highp sampler3D uShape;
in vec3 vWorld;
flat in vec4 vA;
flat in vec4 vB;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 v = vWorld - vA.xyz;
  float dist = length(v);
  vec3 dir = dist > 1e-3 ? v / dist : vec3(0.0, 1.0, 0.0);
  float r = vA.w;
  vec3 q = (vA.xyz + dir * r) / (r * 2.4) + vB.w * 17.0;
  vec4 n = texture(uShape, q);
  vec4 n2 = texture(uShape, q * 2.03 + 0.37);
  float f = n.r * 0.5 + n.g * 0.2 + n2.r * 0.2 + n2.b * 0.1;    // fBm-ish in 0..1
  float rr = r * (1.0 + vB.z * (f * 2.0 - 1.0));
  if (dist >= rr) discard;
  float x = dist / max(rr, 1e-3);
  // wide edge ramp (in metres): room for the render-time cauliflower erosion to carve deep billows
  float w = clamp(0.5 * r, 4.0, 18.0);
  float d = (1.0 - smoothstep(rr - w, rr, dist)) * vB.y;
  // hot puffs keep their temperature out to the rim (a glowing ball, not a cold shell round a hot core)
  float t = vB.x * (1.0 - smoothstep(mix(0.15, 0.55, vB.x), 1.0, x));
  outColor = vec4(d, d, d, t);
}
