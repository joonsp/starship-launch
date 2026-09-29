// Tileable 3D gradient (Perlin) and cellular (Worley) noise for the GPU noise bakes. GLSL ES 3.0.
// `per` = number of cells per tile (integer). Hash: pcg3d (Jarzynski & Olano 2020, "Hash Functions
// for GPU Rendering"), integer-exact, so the tiles wrap seamlessly.

uvec3 vn_pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 vn_hash33(vec3 cell, float seed) {
  uvec3 h = vn_pcg3d(uvec3(ivec3(cell) + ivec3(4096)) + uvec3(uint(seed) * 7919u));
  return vec3(h) * (1.0 / 4294967295.0);
}

// Worley F1 distance (0 at feature points, ~1 far away), tileable with period `per`.
float vn_worley(vec3 p, float per, float seed) {
  vec3 ip = floor(p), fp = fract(p);
  float d = 1e9;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 cell = mod(ip + o, per);
    vec3 r = o + vn_hash33(cell, seed) - fp;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}

// Tileable gradient noise in [0, 1].
float vn_perlin(vec3 p, float per, float seed) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n[8];
  for (int k = 0; k < 8; k++) {
    vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 g = normalize(vn_hash33(mod(i + o, per), seed) * 2.0 - 1.0 + 1e-4);
    n[k] = dot(g, f - o);
  }
  float v = mix(mix(mix(n[0], n[1], u.x), mix(n[2], n[3], u.x), u.y),
                mix(mix(n[4], n[5], u.x), mix(n[6], n[7], u.x), u.y), u.z);
  return clamp(v * 0.85 + 0.5, 0.0, 1.0);
}

// Billowy Worley fBm (1 - F1), 3 octaves, tileable (base period `per`).
float vn_worleyFbm(vec3 uvw, float per, float seed) {
  float a = 1.0 - vn_worley(uvw * per, per, seed);
  float b = 1.0 - vn_worley(uvw * per * 2.0, per * 2.0, seed + 1.0);
  float c = 1.0 - vn_worley(uvw * per * 4.0, per * 4.0, seed + 2.0);
  return a * 0.625 + b * 0.25 + c * 0.125;
}

float vn_remap(float v, float a, float b, float c, float d) {
  return c + (clamp(v, a, b) - a) / max(b - a, 1e-5) * (d - c);
}
