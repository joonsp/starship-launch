// Sky + cirrus + background cumulus baked into one cubemap face (see sky.ts).
// The scene is frozen, so all of this runs once per lighting preset (and once per ~1 km of camera travel).
// Prepend: common.glsl, atmosphere.glsl.
precision highp float;
precision highp sampler3D;

varying vec2 vUv;

uniform int   uFace;
uniform vec3  uBakePos;        // camera position at bake time (world, m)
uniform vec3  uSunDir;         // toward the sun
uniform vec3  uCloudSunDir;    // light direction for the clouds (sky.ts blends the true and the preset's lifted sun)
uniform vec3  uE0;             // extraterrestrial sun irradiance for the atmosphere (scene units)
uniform float uMsGain;         // multiple-scattering gain
uniform vec3  uSunLight;       // sun light (colour * intensity) that lights the clouds
uniform vec3  uAmbTop;         // cloud ambient radiance from the sky (top)
uniform vec3  uAmbBottom;      // cloud ambient radiance from the ground (bottom)
uniform vec4  uCloud;          // x base, y top (absolute m), z max in-cloud samples, w enable
uniform vec4  uCirrus;         // x strength, y altitude (m), z streak heading (rad), w angular size of a cube texel (rad)
uniform vec4  uCirrusLit;      // x sun gain, y sky gain, z forward peak, w coverage of the broad random patches
uniform vec4  uCirrusPatch[6]; // authored patches: xy centre (km), z radius (km), w strength
uniform vec4  uContrail;       // xy centre (km), z heading (rad), w half length (km); w = 0 disables it
uniform vec4  uWeather;        // x cloud density scale, y unused, z haze per metre, w night (stars) strength
uniform vec3  uHorizonTint;    // multiplies the sky near the horizon
uniform vec4  uLook;           // x = chroma gain aloft, y/z = rd.y range over which it ramps in, w = horizon-tint falloff
uniform vec3  uSkyFloor;       // night-sky glow added to the sky (0 by day)
uniform vec3  uGround;         // radiance of the ground hemisphere (env cube only)
uniform float uBelow;          // 1 = paint the lower hemisphere with uGround (env cube), 0 = clamp to horizon sky
uniform float uDebug;
uniform sampler2D uCover;      // cloud-layout.ts: R top of the cells (debug), G inside distance, A outside distance
uniform sampler3D uEnv;        // cloud-layout.ts: signed distance to the smooth union of the cells (0.5 = surface)
uniform vec4  uVolInfo;        // x half extent (m), y bottom altitude (m), z height (m), w signed-distance range (m)
uniform sampler3D uNoiseS;     // R Perlin-Worley, GBA inverted Worley (4/8/16 cells per tile)
uniform sampler3D uNoiseD;     // RGB inverted Worley (3/6/12 cells per tile)
uniform vec4  uCoverInfo;      // x map half extent (m), y inside-distance range (m), z outside-distance range (m), w texel (m)
uniform vec4  uShape;          // x billow amplitude (m), y fine-billow amplitude (m), z edge scale (small cubes), w extinction (1/m)
uniform vec4  uEdge;           // edge width (m) of a crisp / a ragged cell, erosion depth (m) of a crisp / a ragged cell
uniform vec4  uBaseShape;      // x soft-base height (m) crisp, y ragged, z deepest density below the base (m), w flank billow strength
uniform vec4  uCloudX;         // x density of a fully ragged cell, y far-shadow strength, z far-shadow reach (m), w breakup depth (m)
uniform vec4  uCloudX2;        // x shadow fill (fraction of the sun re-scattered into cloud shadows), yzw unused
uniform vec4  uGlow;           // launch glow (night): xyz position (world, m), w intensity (radiance x m^2); 0 = off
uniform vec3  uGlowColor;
uniform vec4  uShapeScale;     // x shape-noise tile (m), y detail-noise tile (m), z base wander (m), w first light step (m)
uniform vec3  uShapeW;         // weights of the three billow octaves (sum 1)
uniform vec4  uStep;           // x in-cloud step per metre of range, y min step (m), z max step (m), w max light steps
uniform vec4  uCloudLit;       // x sun gain, y sky-ambient gain, z ground-ambient gain, w ambient diffusion length (m)
uniform vec4  uCloudPhase;     // x forward g, y backward g, z backward weight, w bounce (sunlight re-scattered by lit neighbours)
uniform vec4  uCloudMs;        // Wrenninge octaves: x extinction factor, y contribution factor, z eccentricity factor, w octaves

vec3 faceDir(int f, float sc, float tc) {
  if (f == 0) return vec3(1.0, -tc, -sc);
  if (f == 1) return vec3(-1.0, -tc, sc);
  if (f == 2) return vec3(sc, 1.0, tc);
  if (f == 3) return vec3(sc, -1.0, -tc);
  if (f == 4) return vec3(sc, -tc, 1.0);
  return vec3(-sc, -tc, -1.0);
}

// ------------------------------------------------------------------ 2D value-noise fbm (cirrus)
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sl_hash12(i), sl_hash12(i + vec2(1, 0)), f.x), mix(sl_hash12(i + vec2(0, 1)), sl_hash12(i + vec2(1, 1)), f.x), f.y);
}
float fbm2(vec2 p, int oct) {
  float a = 0.5, s = 0.0, nrm = 0.0;
  for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * vn(p); nrm += a; p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; }
  return s / nrm;
}

// ------------------------------------------------------------------ cirrus: fibrous mares' tails on a high deck
// Streaks run along uCirrus.z (heading) with a slow wander and bent heads (hooks); fine fibres are faded out where one
// cube texel covers them (no aliasing toward the horizon). Coverage is patchy (broad noise) plus art-directed patches
// (cloud-layout.ts CIRRUS_PATCHES) and one contrail. Returns premultiplied colour in rgb and opacity in a.
vec4 cirrus(vec3 ro, vec3 rd, vec3 amb) {
  if (uCirrus.x <= 0.0 || rd.y < 0.01) return vec4(0.0);
  float t = (uCirrus.y - ro.y) / rd.y;
  if (t <= 0.0) return vec4(0.0);
  vec2 xz = (ro.xz + rd.xz * t) * 1.0e-3;                 // km on the cirrus deck
  float fp = t * 1.0e-3 * uCirrus.w / max(rd.y, 0.05);    // footprint of one cube texel on the deck (km, foreshortened)
  // coverage: broad patches plus the authored ones
  float cov = smoothstep(0.56, 0.8, fbm2(xz * 0.02 + vec2(3.7, 1.3), 4)) * uCirrusLit.w;
  for (int i = 0; i < 6; i++) {
    vec4 P = uCirrusPatch[i];
    if (P.w <= 0.0) continue;
    cov = max(cov, P.w * (1.0 - smoothstep(0.3, 1.0, length(xz - P.xy) / P.z)));
  }
  // contrail: a straight, slowly spreading line segment
  float trail = 0.0;
  if (uContrail.w > 0.0) {
    vec2 cd = vec2(sin(uContrail.z), -cos(uContrail.z));
    vec2 rel = xz - uContrail.xy;
    float along = dot(rel, cd), across = dot(rel, vec2(-cd.y, cd.x));
    float w = 0.035 + 0.045 * clamp(along / uContrail.w * 0.5 + 0.5, 0.0, 1.0) + 0.5 * fp;
    trail = exp(-(across * across) / (w * w)) * (0.07 / w) * (1.0 - smoothstep(0.75, 1.0, abs(along) / uContrail.w));
    trail *= 0.75 + 0.25 * fbm2(vec2(along * 3.0, 0.5), 2);
  }
  if (cov < 0.004 && trail < 0.004) return vec4(0.0);
  // streak frame: along / across the local heading
  float ang = uCirrus.z + 0.7 * (fbm2(xz * 0.03 + 9.1, 3) - 0.5);
  vec2 dir = vec2(sin(ang), -cos(ang));
  vec2 q = vec2(dot(xz, dir), dot(xz, vec2(-dir.y, dir.x)));
  // hooks and wavy tails: bend the streak lines (the bend grows along each streak, so the tails curl)
  q.y += 1.4 * (fbm2(q * vec2(0.04, 0.22) + 5.3, 4) - 0.5);
  float band = fbm2(vec2(q.x * 0.06, q.y * 1.9), 4);
  // streaks are broken into tails of a few km, thick at the head and fraying out
  float seg = fbm2(vec2(q.x * 0.22, q.y * 0.9) + 31.0, 3);
  float streak = smoothstep(0.5, 0.74, band) * smoothstep(0.35, 0.65, seg);
  float fibAA = 1.0 - smoothstep(0.04, 0.16, fp);
  float fib = mix(0.5, fbm2(vec2(q.x * 0.35, q.y * 9.0) + 17.0, 4), fibAA);
  fib = smoothstep(0.3, 0.8, fib);
  // streaks, plus a thin milky veil where the deck is dense (the photo's upper right)
  float a = streak * (0.15 + 0.85 * fib) * cov * 0.42 + cov * cov * 0.15 + trail * 0.28;
  a = clamp(a, 0.0, 0.8) * uCirrus.x * smoothstep(0.01, 0.12, rd.y);
  // ice crystals: a strong forward peak toward the sun, lit by a slightly whiter sun than at the ground, plus skylight
  float mu = dot(rd, uSunDir);
  float ph = 1.0 + 0.4 * mu + uCirrusLit.z * pow(max(mu, 0.0), 8.0);
  vec3 sun = mix(vec3(sl_luma(uSunLight)), uSunLight, 0.75);
  vec3 lit = sun * (uCirrusLit.x / 3.14159265) * ph + amb * uCirrusLit.y;
  return vec4(lit * a, a);
}

// ------------------------------------------------------------------ cumulus
// Each column of the coverage map holds the union of dome-topped towers standing on the common base. The density is
// the signed distance to that envelope, displaced by round Worley billows (cauliflower) and a finer billow octave,
// eroded at the fringe by the small detail cells and ramped in over an edge width: solid cores, crisp crowns on dense
// towers, soft wispy edges on ragged fragments. The base is flat on average but soft and a little ragged (the density
// fades in over tens of metres above the condensation level; fractus hangs below ragged cells).

vec4 coverAt(vec2 xz) {
  vec2 uv = xz / (2.0 * uCoverInfo.x) + 0.5;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
  return textureLod(uCover, uv, 0.0);
}

// The condensation level is nearly flat: a slow wander of a few tens of metres.
float baseAt(vec2 xz) { return uCloud.x + (textureLod(uNoiseS, vec3(xz * (1.0 / 9000.0), 0.31), 0.0).g - 0.48) * uShapeScale.z; }

// Round billow profile from inverted Worley (w = 1 - F1): a hemispherical bulge per Worley cell with creases between
// cells, i.e. cauliflower rather than the cones of raw F1. Mean ~0.64, sd ~0.27 per octave.
float bulge(float w) { float f = (1.0 - w) * (1.0 / 0.75); return sqrt(max(1.0 - f * f, 0.0)); }

// Signed distance (m, positive inside) to the undisplaced cell envelope.
float envelopeAt(vec3 p) {
  vec3 uvw = vec3((p.x + uVolInfo.x) / (2.0 * uVolInfo.x), (p.z + uVolInfo.x) / (2.0 * uVolInfo.x), (p.y - uVolInfo.y) / uVolInfo.z);
  if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return -uVolInfo.w;
  return (textureLod(uEnv, uvw, 0.0).r - 0.5) * 2.0 * uVolInfo.w;
}

// Density (0..1) at p (m = coverAt(p.xz)). fine = add the small billow octave and the fringe erosion. `skip` receives a
// distance the caller may advance when the envelope is far; `geo` receives (depth below the crown, depth inside the
// envelope, height above the base, depth inside the displaced surface), used for the ambient term.
float cloudDensity(vec3 p, vec4 m, bool fine, out float skip, out vec4 geo) {
  float h = p.y - baseAt(p.xz);
  float amp = uShape.x;
  float reach = 1.5 * amp + 0.6 * uShape.y + 6.0;           // how far the billows may push the surface outwards
  skip = 0.0;
  geo = vec4(0.0);
  float dOut = m.a * uCoverInfo.z - m.g * uCoverInfo.y;     // signed 2D distance outside the footprints
  if (dOut > reach) { skip = dOut - reach; return 0.0; }
  float rag = m.b;                                          // 0 = dense crisp tower, 1 = thin ragged fragment
  float below = uBaseShape.z;                               // nothing hangs deeper below the base than this
  if (h < -below) { skip = -h - below; return 0.0; }
  float env = envelopeAt(p);
  if (env < -reach) { skip = 0.85 * (-env - reach); return 0.0; }
  // crown depth: how far below the local top of the column the sample is (the column top is in the coverage map)
  float H = max(m.r * (uCloud.y - uCloud.x), 1.0);
  geo = vec4(max(H - h, 0.0), max(env, 0.0), h, 0.0);
  vec4 ns = textureLod(uNoiseS, p / uShapeScale.x, 0.0);
  float bil = uShapeW.x * bulge(ns.g) + uShapeW.y * bulge(ns.b) + uShapeW.z * bulge(ns.a);
  // slow lumps (1 km cells) break the symmetry of the ellipsoids
  float lump = textureLod(uNoiseS, p * (1.0 / 5200.0) + vec3(0.37, 0.11, 0.73), 0.0).g;
  // the billows keep much of their strength down the flanks (lumpy skirts, no smooth rim above the base): the soft
  // base below provides the flatness
  float up = smoothstep(0.0, 260.0, h);
  // small cells (thin columns) get proportionally smaller billows; decaying ragged fragments have weak billows
  float size = clamp(H / 600.0, 0.35, 1.0) * mix(1.0, 0.5, rag);
  float s = env + (amp * 2.8 * (bil - 0.64) + amp * 0.9 * (lump - 0.48)) * size * mix(uBaseShape.w, 1.0, up);
  // ragged fragments are torn apart at the ~0.5 km scale (holes, detached pieces)
  s += rag * rag * uCloudX.w * (ns.r - 0.55);
  float ero = 0.35 * mix(uEdge.z, uEdge.w, rag);            // mean erosion (coarse light samples)
  // the base undulates gently at the scale of the big billows (tens of metres), so it is no perfect flat disc
  float hbOff = (ns.b - 0.6) * mix(50.0, 80.0, rag);
  if (fine) {
    if (rag > 0.3) {
      // decaying fragments are torn into horizontal shreds (fractus): detail cells stretched ~2x sideways
      vec3 tn = textureLod(uNoiseD, p * vec3(1.0 / 1100.0, 1.0 / 480.0, 1.0 / 1100.0) + 0.37, 0.0).rgb;
      s += (rag - 0.3) * (1.0 / 0.7) * uCloudX.w * 1.2 * (0.6 * tn.r + 0.4 * tn.g - 0.6);
    }
    vec3 nd = textureLod(uNoiseD, p / uShapeScale.y, 0.0).rgb;
    s += uShape.y * 2.0 * (0.6 * bulge(nd.r) + 0.4 * bulge(nd.g) - 0.64) * mix(0.5, 1.0, up);
    // fringe erosion in the creases between the smallest detail cells: torn, wispy edges (ragged cells much more)
    float wisp = clamp(1.0 - (0.55 * nd.b + 0.45 * nd.g), 0.0, 1.0);   // ~0 in the small cells' cores, high in creases
    ero = smoothstep(0.12, 0.7, wisp) * mix(uEdge.z, uEdge.w, rag);
    // a ragged base: the condensation level wobbles by a few metres on dense cells, by tens of metres on fragments
    hbOff += (nd.r - 0.55) * mix(40.0, 110.0, rag);
  }
  // edge width: crisp crowns, softer flanks and bases, much softer on ragged cells
  float W = mix(uEdge.x, uEdge.y, rag) * mix(1.5, 0.75, smoothstep(0.4, 0.9, h / H)) * uShape.z;
  float d = clamp((s - ero) / W, 0.0, 1.0);
  // soft base: flat on average (the ramp is centred on the condensation level), fading in over tens of metres, torn
  // by the fringe erosion into ragged fractus on decaying cells
  float soft = mix(uBaseShape.x, uBaseShape.y, rag);
  float hb = h + clamp(hbOff, -60.0, 60.0) - 0.5 * ero;
  d *= smoothstep(-0.5 * soft, 0.5 * soft, hb);
  geo.w = s - ero;
  return d * mix(1.0, uCloudX.x, rag);
}

// Optical depth toward the sun: geometric steps starting small, so billow-scale self-shadowing is resolved.
float lightTau(vec3 p) {
  float tau = 0.0, s = uShapeScale.w, acc = 0.0, sk;
  vec4 g;
  int n = int(uStep.w);
  for (int i = 0; i < 9; i++) {
    if (i >= n) break;
    vec3 q = p + uCloudSunDir * (acc + 0.5 * s);
    vec4 m = coverAt(q.xz);
    if (m.a < 0.999) tau += cloudDensity(q, m, i < 3, sk, g) * s;
    acc += s; s *= 1.9;
  }
  return tau * uShape.w * uWeather.x;
}

// Optical depth from p toward the launch glow below (3 short steps: it lights the underside and the low flanks).
float glowTau(vec3 p, vec3 dir) {
  float tau = 0.0, s = 40.0, acc = 0.0, sk;
  vec4 g;
  for (int i = 0; i < 3; i++) {
    vec3 q = p + dir * (acc + 0.5 * s);
    vec4 m = coverAt(q.xz);
    if (m.a < 0.999) tau += cloudDensity(q, m, false, sk, g) * s;
    acc += s; s *= 2.5;
  }
  return tau * uShape.w * uWeather.x;
}

// Long-range shadow: optical depth toward the TRUE sun through OTHER clouds, out to uCloudX.z, sampled coarsely in the
// undisplaced envelope. A low sun casts cloud shadows many kilometres long, so at sunrise whole cells sit in the shadow
// of their neighbours. Only the path after the ray has left the sample's own cloud counts: inside one cloud, lightTau
// and its multiple-scattering octaves already model how light diffuses around the towers. The result joins lightTau in
// the octaves. Evaluated once per cloud a view ray enters.
float farShadowTau(vec3 p) {
  if (uCloudX.y <= 0.0 || uSunDir.y <= 0.0) return 0.0;
  float tau = 0.0, s = 300.0, acc = 300.0;
  float top = uCloud.y + 300.0;
  bool left = false;
  for (int i = 0; i < 16; i++) {
    vec3 q = p + uSunDir * (acc + 0.5 * s);
    if (q.y > top || acc > uCloudX.z) break;
    float e = envelopeAt(q);
    if (e < -60.0) left = true;
    // neighbours within ~2 km are part of the same cluster (its towers are lit by the lifted local light)
    if (left) tau += clamp((e + 80.0) / 240.0, 0.0, 1.0) * smoothstep(-40.0, 60.0, q.y - uCloud.x) * smoothstep(1500.0, 3500.0, acc) * s;
    acc += s; s = min(s * 1.22, 1600.0);
  }
  return tau * uShape.w * uWeather.x * uCloudX.y;
}

// The cumulus slab [lo, hi] in altitude: the soft base may reach CLOUD_BELOW under the base, billows rise above the
// tallest top (never cut off flat).
vec2 cloudSlab() { return vec2(uCloud.x - uBaseShape.z - 10.0, uCloud.y + 1.5 * uShape.x + 0.6 * uShape.y + 10.0); }

// Returns rgb = radiance (already attenuated), a = transmittance; tHit = transmittance-weighted distance. Marches the
// true direction, up or down (below the horizon there is cumulus only when the bake point is inside or above the slab).
// With SKY_DEPTH defined only the transmittance and the distance are computed (no lighting): the depth pass.
vec4 marchClouds(vec3 ro, vec3 rd, vec3 skyHaze, float jitter, out float tHit) {
  tHit = 0.0;
  if (uCloud.w < 0.5) return vec4(0.0, 0.0, 0.0, 1.0);
  vec2 slab = cloudSlab();
  float lo = slab.x, hi = slab.y;
  float t0, t1;
  if (abs(rd.y) < 1.0e-4) {
    if (ro.y < lo || ro.y > hi) return vec4(0.0, 0.0, 0.0, 1.0);
    t0 = 0.0; t1 = 1.0e9;
  } else {
    float tA = (lo - ro.y) / rd.y, tB = (hi - ro.y) / rd.y;
    t0 = max(0.0, min(tA, tB)); t1 = max(tA, tB);
  }
  t1 = min(t1, 60000.0);
  if (t0 >= t1) return vec4(0.0, 0.0, 0.0, 1.0);
  float mu = dot(rd, uCloudSunDir);
  // dual-lobe HG (forward silver lining + a weak back lobe), normalised so an isotropic phase is 1
  float pF = uCloudPhase.x, pB = uCloudPhase.y, wB = uCloudPhase.z;
  vec3 sunE = uSunLight * uCloudLit.x / 3.14159265;
  vec3 L = vec3(0.0);
  float T = 1.0, wsum = 0.0;
  float t = t0;
  int maxIt = int(uCloud.z), octaves = int(uCloudMs.w);
  int fineN = 0;
  bool first = true;
  float farTau = 0.0;
  bool needFar = true;
  for (int i = 0; i < 600; i++) {
    if (t > t1 || T < 0.008 || fineN >= maxIt) break;
    vec3 p = ro + rd * t;
    vec4 m = coverAt(p.xz);
    float dt = clamp(t * uStep.x, uStep.y, uStep.z);
    float skip;
    vec4 geo;
    float d = cloudDensity(p, m, true, skip, geo);
    if (skip > 0.0) { t += max(skip, dt); needFar = true; continue; }
    if (first) { t += jitter * dt; first = false; continue; }   // decorrelate the first in-cloud sample per pixel
    // the budget counts LIT samples only: a grazing ray through the soft base or a thin fringe must not run out of
    // samples before it reaches the cloud behind (that cut clouds off along straight lines)
    // thin fringes and the soft base are crossed in longer steps (little light is lost there)
    float stepL = dt * mix(2.0, 1.0, smoothstep(0.0, 0.25, d));
    if (d > 0.002) {
      fineN++;
      float sigma = d * uShape.w * uWeather.x;
      float Ts = exp(-sigma * stepL);
      float wgt = T * (1.0 - Ts);
#ifndef SKY_DEPTH
      if (needFar) { farTau = farShadowTau(p); needFar = false; }
      float tauL = lightTau(p);
      float ms = 0.0, a = 1.0, b = 1.0, c = 1.0;
      for (int o = 0; o < 5; o++) {
        if (o >= octaves) break;
        float ph = 4.0 * 3.14159265 * mix(sl_hg(mu, pF * c), sl_hg(mu, pB * c), wB);
        ms += b * exp(-(tauL + farTau) * a) * ph;
        a *= uCloudMs.x; b *= uCloudMs.y; c *= uCloudMs.z;
      }
      // ambient: near the crown the sample sees the whole sky, on the flanks half sky and half ground, near the flat
      // base mostly the ground; samples deep inside receive less (skylight diffuses in over uCloudLit.w metres)
      float up = clamp(geo.z / max(geo.z + geo.x, 1.0), 0.0, 1.0);           // 0 at the base, 1 at the crown
      float skyVis = mix(0.12, 1.0, smoothstep(0.0, 0.9, up));
      float gndVis = mix(1.0, 0.1, smoothstep(0.0, 0.6, up));
      float diff = exp(-max(geo.w, 0.0) / uCloudLit.w);
      // bounce: sunlight re-scattered onto shaded flanks by sunlit neighbours; in the shadow of another cloud, the fill
      // from the sunlit cloud field and haze around it (so a shadowed cell is grey, not skylight blue)
      float fill = uCloudX2.x * (1.0 - exp(-farTau)) * mix(0.5, 1.0, up);
      vec3 amb = (uAmbTop * uCloudLit.y * skyVis + uAmbBottom * uCloudLit.z * gndVis + sunE * (uCloudPhase.w * mix(0.25, 1.0, up))
                  + mix(vec3(sl_luma(sunE)), sunE, 0.5) * fill) * mix(0.3, 1.0, diff);
      vec3 S = sunE * ms + amb;
      if (uGlow.w > 0.0) {
        // the launch lights the cloud bases from below (a point source at the pad, 1/d^2), diffused into the cloud
        vec3 gv = uGlow.xyz - p;
        float d2 = dot(gv, gv);
        float tg = glowTau(p, gv * inversesqrt(d2));
        S += uGlowColor * (uGlow.w / d2) * (exp(-tg) + 0.5 * exp(-0.25 * tg));
      }
      L += wgt * S;
#endif
      wsum += wgt; tHit += wgt * t;
      T *= Ts;
#ifdef SKY_DEPTH
      // the depth pass only needs where the cloud becomes half opaque: the reprojection's surface
      if (T < 0.5) { tHit = t; return vec4(0.0, 0.0, 0.0, T); }
#endif
    }
    t += stepL;
  }
  // the march stops once the cloud is nearly opaque: treat it as opaque, or bright stars would shine through at night
  if (T < 0.01) T = 0.0;
  if (wsum > 0.0) {
    tHit /= wsum;
    // aerial perspective between the camera and the cloud: fade toward the sky behind it
    float hz = 1.0 - exp(-tHit * uWeather.z);
    L = mix(L, skyHaze * (1.0 - T), hz);
  }
  return vec4(L, T);
}

// ------------------------------------------------------------------ sky look
// The reference is a graded photograph: its clear sky is a deep, nearly red-free cerulean above ~15 deg and a pale
// teal-grey haze band below ~10 deg, a steeper split than any stratified single-scatter atmosphere produces. The
// in-scattered light keeps its physical luminance (so noon, dusk and night still scale correctly); only its chroma is
// deepened aloft, in log space so no channel goes negative.
vec3 skyLook(vec3 c, float y) {
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  if (lum < 1.0e-6 || uLook.x <= 0.0) return c;
  float k = uLook.x * smoothstep(uLook.y, uLook.z, y);
  vec3 r = pow(max(c / lum, vec3(1.0e-4)), vec3(1.0 + k));
  return r * (lum / max(dot(r, vec3(0.2126, 0.7152, 0.0722)), 1.0e-6));
}

// ------------------------------------------------------------------ stars (night)
vec3 stars(vec3 rd) {
  if (uWeather.w <= 0.0 || rd.y < 0.0) return vec3(0.0);
  vec3 p = rd * 190.0;
  vec3 ip = floor(p), fp = fract(p);
  float h = sl_hash13(ip);
  if (h < 0.965) return vec3(0.0);
  vec3 jc = vec3(sl_hash13(ip + 3.1), sl_hash13(ip + 7.7), sl_hash13(ip + 11.3));
  float d = length(fp - (0.2 + 0.6 * jc));
  float mag = pow((h - 0.965) / 0.035, 3.0);
  float s = smoothstep(0.16, 0.0, d) * (0.15 + 3.0 * mag);
  vec3 tint = mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.85, 1.0), sl_hash13(ip + 19.9));
  // faint milky-way-like band
  float band = exp(-pow(dot(rd, normalize(vec3(0.35, 0.72, -0.6))) * 4.0, 2.0));
  return tint * s * uWeather.w * (1.0 + band * 1.5) * smoothstep(0.0, 0.08, rd.y);
}

void main() {
  float sc = vUv.x * 2.0 - 1.0, tc = vUv.y * 2.0 - 1.0;
  vec3 rd = normalize(faceDir(uFace, sc, tc));
  vec3 ro = uBakePos;
  float camAlt = max(ro.y, 1.0);
  float jitter = sl_ign(gl_FragCoord.xy + vec2(float(uFace) * 37.0, 0.0), 0.0);
#ifdef SKY_DEPTH
  // depth pass: distance (km) from the bake point to the cumulus seen in this direction, 0 = none (sky.ts SkyDome
  // reprojects the cube with it when the camera moves away from the bake point)
  float dist = 0.0;
  if (rd.y >= 0.0 || uBelow < 0.5) {
    float tHit;
    vec4 cu = marchClouds(ro, rd, vec3(0.0), jitter, tHit);
    if (cu.a < 0.98 && tHit > 0.0) dist = tHit * 1.0e-3;   // half-opaque depth, or the mean depth of a thin cloud
  }
  gl_FragColor = vec4(dist, 0.0, 0.0, 1.0);
#else
  vec3 viewT;
  vec3 col;
  float cloudAlpha = 0.0;
  if (rd.y >= 0.0 || uBelow < 0.5) {
    // the sky itself below the horizon is the horizon's (the dome samples the horizon row there); cumulus below the
    // horizon (a bake point inside or above the slab) is marched along the true direction and composited over it
    vec3 rdA = rd.y >= 0.0 ? rd : normalize(vec3(rd.x, 0.0, rd.z) + vec3(0.0, 1.0e-3, 0.0));
    col = atm_inscatter(camAlt, rdA, uSunDir, uE0, uMsGain, rd.y >= 0.0 ? 36 : 12, viewT);
    col = skyLook(col, rdA.y);
    col *= mix(vec3(1.0), uHorizonTint, exp(-max(rdA.y, 0.0) * uLook.w));
    col += uSkyFloor * (0.25 + 0.75 * exp(-max(rdA.y, 0.0) * 3.0));
    col += stars(rdA) * viewT;
    vec4 ci = cirrus(ro, rdA, uAmbTop);
    col = col * (1.0 - ci.a) + ci.rgb;
    float tHit;
    vec4 cu = marchClouds(ro, rd, col, jitter, tHit);
    col = col * cu.a + cu.rgb;
    cloudAlpha = 1.0 - cu.a;                              // cumulus opacity only (the dome's parallax and thermal)
  } else {
    vec3 rdH = normalize(vec3(rd.x, 0.0, rd.z) + vec3(0.0, 1.0e-3, 0.0));
    vec3 hor = atm_inscatter(camAlt, rdH, uSunDir, uE0, uMsGain, 12, viewT);
    hor = skyLook(hor, rdH.y) * mix(vec3(1.0), uHorizonTint, exp(-max(rdH.y, 0.0) * uLook.w));
    col = mix(hor, uGround, smoothstep(0.0, -0.12, rd.y));
  }
  if (uDebug > 0.5 && rd.y > 0.01) {
    float tt = (uCloud.x + 300.0 - ro.y) / rd.y;
    vec3 pp = ro + rd * tt;
    vec4 cc = coverAt(pp.xz);
    float sk; vec4 g;
    if (uDebug < 1.5) col = vec3(textureLod(uNoiseS, pp / uShapeScale.x, 0.0).gba);
    else if (uDebug < 2.5) col = vec3(cc.r * 4.0, cc.g, cc.a);
    else if (uDebug < 3.5) col = vec3(cloudDensity(pp, cc, true, sk, g));
    else col = vec3(envelopeAt(pp) / uVolInfo.w * 0.5 + 0.5);
  }
  gl_FragColor = vec4(col, cloudAlpha);
#endif
}
