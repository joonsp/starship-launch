// Vehicle shader helpers. Pasted after `#include <common>` and after src/shaders/common.glsl, so
// sl_hash13(), uViewMode and the VIEW_* defines are available. Everything works on VEHICLE-FRAME
// object-space position (vSlObjPos): y = height above the booster engine plane, azimuth from x/z.
//
// Fixed-footprint anti-aliasing: `vhFoot` is the pixel footprint in metres (fwidth of the object-space
// position). Every detail layer fades to its mean value when a pixel covers more than ~1/3 of its
// wavelength, so the 200 px vehicle in the photo view carries no shimmer and close-ups keep all detail.

float vhFoot = 0.0;   // set once per fragment by vhInitFootprint()

void vhInitFootprint(vec3 p) {
  vec3 fw = fwidth(p);
  float f = max(max(fw.x, fw.y), fw.z);
  // derivatives can be NaN/inf on degenerate triangles or at helper-invocation edges: clamp to "very coarse"
  vhFoot = (isnan(f) || isinf(f)) ? 1.0 : clamp(f, 1e-5, 2.0);
}

// weight of a detail of wavelength `wl` (metres) at the current footprint: 1 = fully resolved, 0 = averaged out
float vhDetail(float wl) { return 1.0 - smoothstep(0.55, 1.35, vhFoot / max(wl, 1e-5)); }

// stricter fade for bump layers: derivative-based normals are constant per 2x2 pixel quad, so only
// features spanning several pixels may perturb the normal
float vhDetailB(float wl) { return 1.0 - smoothstep(0.10, 0.42, vhFoot / max(wl, 1e-5)); }

float vhNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = sl_hash13(i);
  float n100 = sl_hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = sl_hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = sl_hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = sl_hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = sl_hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = sl_hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = sl_hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

// fbm of `pn` (noise units). `wl` = wavelength in metres of the first octave along the finest axis; octaves
// that the pixel footprint cannot resolve fade to the mean (0.5). VH_OCT (define) caps the octave count.
float vhFbm(vec3 pn, float wl) {
  float sum = 0.0, norm = 0.0, amp = 0.5;
  for (int o = 0; o < VH_OCT; o++) {
    float w = vhDetail(wl);
    sum += amp * mix(0.5, vhNoise(pn), w);
    norm += amp;
    pn = pn * 2.03 + vec3(17.1, 5.3, 11.7);
    wl *= 0.4926;
    amp *= 0.5;
  }
  return sum / norm;
}

float vhSmoothBand(float d, float w) { return exp(-(d * d) / (w * w)); }

// Surface normal perturbation from a scalar height H (metres) via screen-space derivatives (Mikkelsen).
// surfPos = -vViewPosition. Returns the input normal when the derivatives are degenerate.
vec3 vhPerturb(vec3 surfPos, vec3 N, float H, float faceDir) {
  vec3 sx = dFdx(surfPos);
  vec3 sy = dFdy(surfPos);
  vec3 R1 = cross(sy, N);
  vec3 R2 = cross(N, sx);
  float det = dot(sx, R1);
  float dHx = dFdx(H);
  float dHy = dFdy(H);
  if (!(abs(det) > 1e-14) || isnan(dHx) || isnan(dHy)) return N;
  vec3 grad = sign(det) * (dHx * R1 + dHy * R2);
  vec3 n = abs(det) * N - grad * faceDir;
  float l = length(n);
  return l > 1e-12 ? n / l : N;
}

// ---- hexagonal tiling (pointy-top hexagons, tile width across the flats = 1 in tile units)
// returns gv (position inside the cell) and id (cell centre in tile units)
void vhHex(vec2 p, out vec2 gv, out vec2 id) {
  const vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  gv = dot(a, a) < dot(b, b) ? a : b;
  id = p - gv;
}
// distance from the hexagon edge inward (0 on the edge, 0.5 at the centre), tile units
float vhHexEdge(vec2 gv) {
  vec2 q = abs(gv);
  float c = max(dot(q, vec2(0.5, 0.8660254)), q.x);
  return 0.5 - c;
}
float vhHash21(vec2 p) { return sl_hash12(p); }

// azimuth (rad) from +x toward -z, the convention of engine-layout.ts
float vhAzimuth(vec3 p) { return dot(p.xz, p.xz) < 1e-8 ? 0.0 : atan(-p.z, p.x); }
