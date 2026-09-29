// Terrain surface model (chunk injected into MeshStandardMaterial after <common>; see terrain.ts).
// Everything is a function of the world position, the splat masks (OSM) and a tileable noise texture, so the
// terrain mesh itself is just a flat quad: tidal-flat pools are shaded, not modelled (they are 0.1-0.5 m deep).
uniform sampler2D uMaskIA;
uniform sampler2D uMaskIB;
uniform sampler2D uMaskOA;
uniform sampler2D uMaskOB;
uniform sampler2D uNoise;
uniform sampler2D uWave;         // tileable slope map (RG = slopes, BA = slopes one octave up)
uniform sampler2D uCell;         // tileable cellular noise for near-field cracks / pebbles / tufts
uniform sampler2D uReflect;      // planar reflection of the world at y = 0
uniform mat4      uReflMat;
uniform samplerCube uSkyCube;    // full sky (clouds included): fallback reflection when no planar reflection exists
uniform vec4      uPool;         // x threshold, y bias strength, z channel amount, w vegetation patches
uniform vec4      uBounce;       // rgb = warm bounce light from the orange steam banks / fireball, w = falloff radius (m)
uniform vec4      uReflParams;   // x reflection available, y reflection strength for wet mud, z ripple, w -

#define INNER_HALF 2560.0
#define OUTER_HALF 16000.0

vec4 slNz(vec2 p, float period) { return texture(uNoise, p / period); }
vec4 slNzL(vec2 p, float period) { return textureLod(uNoise, p / period, 1.0); }   // for non-uniform control flow (no implicit derivatives)

// Warm fill from the launch clouds: the huge sunlit/fire-lit steam banks flood the surrounding ground with orange.
vec3 slBounce(vec3 wp) {
  float d = length(wp.xz - vec2(0.0, 20.0));
  return uBounce.rgb * exp(-d / max(uBounce.w, 1.0));
}

// Authored pools (photo foreground): tapered capsules (segment A-B, end radii ra, rb), smooth-unioned. The
// constants are generated in terrain.ts.
//@POOLS@
float slPoolSdf(vec2 p, vec2 A, vec2 B, vec2 r) {           // ~metres, negative inside
  vec2 ba = B - A, pa = p - A;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(r.x, r.y, h);
}
float slSmin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
// signed distance (m) to the authored pools (negative inside), warped by the caller
float slAuthoredPools(vec2 xz) {
  float d = 1e4;
  for (int i = 0; i < SL_NPOOL; i++) {
    vec2 rel = xz - SL_POOL_M[i].xy;
    if (dot(rel, rel) > SL_POOL_M[i].z) continue;     // far outside the bounding circle
    d = slSmin(d, slPoolSdf(xz, SL_POOL_A[i], SL_POOL_B[i], SL_POOL_R[i]), 30.0);
  }
  return d;
}

// Boca Chica Boulevard (OSM polyline, simplified): west of the pad the ground beside it is a wide, dark, wet corridor of
// compacted soil and asphalt with long shallow sheets of standing water (the pale streaks in the photo's left third).
// x = signed across distance (m, +south of the road), y = distance along the road (m)
vec2 slRoadFrame(vec2 p) {
  vec2 P[4] = vec2[4](vec2(-926.0, 207.0), vec2(-373.0, 2.0), vec2(-158.0, -123.0), vec2(-77.0, -152.0));
  float best = 1e9; vec2 res = vec2(1e4, 0.0); float base = 0.0;
  for (int i = 0; i < 3; i++) {
    vec2 a = P[i], b = P[i + 1], ba = b - a, pa = p - a;
    float len = length(ba);
    float h = clamp(dot(pa, ba) / (len * len), 0.0, 1.0);
    vec2 q = pa - ba * h;
    float d = length(q);
    if (d < best) { best = d; res = vec2(sign(ba.x * pa.y - ba.y * pa.x) * d, base + h * len); }
    base += len;
  }
  return res;
}

struct SlSurface {
  vec3  albedo;
  float rough;
  float water;     // 0..1 open water coverage (pool / channel / OSM water)
  float depth;     // water depth (m)
  float wet;       // 0..1 wet ground (glossy)
  vec3  nW;        // world normal
  float kelvin;
};

// hard-ish threshold with a width that follows the screen-space derivative (anti-aliased, resolution independent)
float slEdge(float v, float soft) {
  float w = max(fwidth(v) * 1.2, 1e-4) + soft;
  return smoothstep(-w, w, v);
}

SlSurface slTerrain(vec3 wp, float camDist) {
  SlSurface s;
  vec2 xz = wp.xz;

  // ------------------------------------------------------------ OSM splat masks (inner 1.25 m/px, outer ring 16 m/px)
  vec2 uvI = (xz + INNER_HALF) / (2.0 * INNER_HALF);
  vec2 uvO = (xz + OUTER_HALF) / (2.0 * OUTER_HALF);
  float wIn = 1.0 - smoothstep(0.80, 0.97, max(abs(xz.x), abs(xz.y)) / INNER_HALF);
  vec4 A = mix(texture(uMaskOA, uvO), texture(uMaskIA, uvI), wIn);
  vec4 B = mix(texture(uMaskOB, uvO), texture(uMaskIB, uvI), wIn);
  float flatM = A.r, scrubM = A.g, waterM = A.b, sandM = B.r, gravelM = B.g, dampM = B.b;

  // ------------------------------------------------------------ noise at several scales (all tileable fbm)
  vec4 n1 = slNz(xz, 1900.0);
  vec4 n2 = slNz(xz, 430.0);
  vec4 n3 = slNz(xz, 83.0);
  vec4 n4 = slNz(xz, 13.0);
  // two rotated, incommensurate taps hide the tile period of the finest detail
  vec4 n5 = mix(slNz(mat2(0.8, -0.6, 0.6, 0.8) * xz, 3.7), slNz(xz * 1.0 + 11.7, 9.1), 0.5);
  // near-field fades: tiny detail averages to 0.5 anyway through the mip chain, but keep it cheap and stable
  float nearF = 1.0 - smoothstep(60.0, 420.0, camDist);
  // cellular detail for walking-height views: 0.5 m crust plates / cracks and 0.12 m pebbles or grass tufts
  // warped so plates and cracks come out irregular rather than as a regular hexagonal tiling
  vec2 cq = xz + (n4.rg - 0.5) * 0.55 + (n5.gb - 0.5) * 0.18;
  // (blend the *results* of two fixed scales: dividing the absolute position by a varying scale destroys the derivatives)
  vec4 c1 = mix(texture(uCell, cq / 4.1), texture(uCell, cq / 6.7 + 0.5), n3.a);
  vec4 c2 = texture(uCell, cq / 1.37 + 0.31);
  float nearC = 1.0 - smoothstep(8.0, 70.0, camDist);

  // ------------------------------------------------------------ moisture: drives pools, wet mud and vegetation
  vec2 warp = (n2.rg - 0.5) * 120.0 + (n3.gb - 0.5) * 22.0;
  vec4 m1 = slNz(xz + warp, 520.0);
  vec4 m2 = slNz(xz + warp * 0.6, 150.0);
  float moist = m1.a * 0.66 + m2.r * 0.27 + n4.g * 0.07;
  float flatMask = smoothstep(0.25, 0.75, flatM + (n4.r - 0.5) * 0.45) * (1.0 - smoothstep(0.35, 0.65, scrubM + (n4.b - 0.5) * 0.3));
  // The photo's foreground (and everything within ~250 m of the pad) is dry-ish mud: the procedural pools only start
  // further out, so the pad, its apron and the mud in front of it never mirror the tower. Water in the foreground is authored.
  float procFar = smoothstep(280.0, 700.0, length(xz - vec2(-40.0, 230.0)));
  float pf = moist + dampM * 0.12 - uPool.x;
  float pool = slEdge(pf + (n4.g - 0.5) * 0.02 * nearF, 0.0035) * flatMask * procFar;
  // thin sinuous tidal channels (ridged noise), most common where it is already damp
  float ridge = 1.0 - abs(2.0 * m2.g - 1.0);
  float chan = smoothstep(0.955 - 0.015 * uPool.z, 0.985, ridge) * flatMask * smoothstep(0.38, 0.55, moist) * uPool.z * procFar;
  float osmKeep = smoothstep(150.0, 260.0, length(xz));       // no OSM ponds / runoff basins right at the pad
  float osmW = smoothstep(0.42, 0.58, waterM + (n4.g - 0.5) * 0.18 * nearF) * osmKeep;
  // authored pools with smooth, curvy shores: warp the distance field at 40 m and 10 m scales
  float dPool = slAuthoredPools(xz + (n2.rg - 0.5) * 46.0 + (n3.gb - 0.5) * 11.0 + (n4.ra - 0.5) * 2.5 * nearF);
  float authW = slEdge(-dPool, 0.0);
  // road corridor: dark wet ground with long shallow water sheets parallel to the road
  // (only evaluated in the strip west of the pad that the corridor can reach)
  vec2 rf = vec2(1e4, 0.0);
  float corr = 0.0, rAcross = 1e4, lanes = 0.0;
  if (xz.x < -80.0 && xz.x > -1000.0 && xz.y > -420.0 && xz.y < 320.0) {
    rf = slRoadFrame(xz);
    rAcross = rf.x + (n3.r - 0.5) * 8.0 + (n2.b - 0.5) * 22.0;
    // ragged, streaky envelope (patches elongated along the road) so the edges are never a straight line from above
    float streak = slNzL(vec2(rf.y * 0.16, rAcross * 1.1), 64.0).g;
    float env = (1.0 - smoothstep(58.0, 86.0, rAcross + (n1.g - 0.5) * 40.0)) * smoothstep(-215.0, -150.0, rAcross + (n1.b - 0.5) * 90.0 + (streak - 0.5) * 50.0);
    corr = env * (0.30 + 0.70 * smoothstep(0.30, 0.58, streak + (n2.g - 0.5) * 0.3)) * (1.0 - smoothstep(-170.0, -80.0, xz.x)) * smoothstep(-1000.0, -820.0, xz.x);
    if (corr > 0.002) {
      float lc[5] = float[5](42.0, -12.0, -70.0, -128.0, -172.0);
      float lw[5] = float[5](6.5, 5.0, 7.0, 5.5, 4.5);
      for (int k = 0; k < 5; k++) {
        float wob = (slNzL(vec2(rf.y, 91.0 * float(k)), 700.0).r - 0.5) * 16.0;
        float inLane = 1.0 - smoothstep(lw[k] * 0.7, lw[k], abs(rAcross - lc[k] - wob));
        float gap = smoothstep(0.30, 0.46, slNzL(vec2(rf.y * 0.7 + 37.0 * float(k), 53.0 * float(k) + 11.0), 1300.0).g);
        lanes = max(lanes, inLane * gap);
      }
    }
  }
  float corrW = lanes * corr;
  s.water = max(max(max(pool, chan), osmW), max(authW, corrW));
  s.depth = 0.03 + 0.55 * clamp(pf * 3.0, 0.0, 1.0) * pool + 0.6 * osmW;
  s.depth = mix(s.depth, 0.03 + 0.3 * chan, step(pool, chan) * step(osmW, chan));
  s.depth = mix(s.depth, 0.03 + 0.75 * smoothstep(0.0, 16.0, -dPool), authW);
  s.depth = mix(s.depth, 0.02, corrW * (1.0 - authW));
  // damp / pale-sand shore bands around authored pools and around the scrub islands (blurred masks)
  float scrubB = textureLod(uMaskIA, uvI, 1.6).g * wIn + textureLod(uMaskOA, uvO, 1.0).g * (1.0 - wIn);
  float dampBand = 1.0 - smoothstep(0.0, 9.0, dPool);
  float rimPool = smoothstep(-2.0, 1.0, dPool) * (1.0 - smoothstep(4.0, 13.0, dPool + (n4.b - 0.5) * 6.0));

  // ------------------------------------------------------------ ground materials (linear albedo, measured off the photo)
  float grain = n5.r * 0.5 + n4.r * 0.35 + n3.r * 0.15;          // 0..1
  // tidal flat (photo): warm brown mud, darker where wet, with large tan / pale-sand patches on the higher ground
  vec3 mudDry = mix(vec3(0.026, 0.016, 0.012), vec3(0.050, 0.032, 0.023), smoothstep(0.30, 0.75, n3.r * 0.5 + n2.b * 0.5));
  vec3 tanSand = mix(vec3(0.150, 0.105, 0.075), vec3(0.230, 0.165, 0.118), n4.a * 0.6 + n3.a * 0.4);
  vec3 algal = mix(vec3(0.032, 0.026, 0.012), vec3(0.056, 0.042, 0.018), n4.a * 0.6 + n3.a * 0.4);
  vec3 wetMud = vec3(0.015, 0.0100, 0.0078);
  float wetness = smoothstep(0.56, 0.72, moist + dampM * 0.25);
  float algalK = smoothstep(0.42, 0.62, n2.g * 0.62 + n3.b * 0.18 + (moist - 0.5) * 0.7) * (1.0 - smoothstep(0.60, 0.78, moist));
  // wet margin: darkening in a band around procedural water (distance-like proxy from pf) and around authored pools
  float margin = 1.0 - smoothstep(0.0, 0.03, abs(pf) + (n4.r - 0.5) * 0.015);
  wetness = max(wetness, margin * 0.85 * procFar);
  wetness = max(wetness, dampBand * 0.9);
  // big soft tan patches (drier, sandier crust), sharp-edged where the wet mud begins
  float tanPatch = smoothstep(0.46, 0.60, n1.g * 0.45 + n2.a * 0.35 + n3.g * 0.2);
  // meandering pale sand channels and bars (thin ridges of a warped low-frequency field), as between the islands in the photo
  float tanChan = (1.0 - smoothstep(0.0, 0.05, abs(m1.b - 0.52 + (n3.r - 0.5) * 0.06))) * smoothstep(0.30, 0.5, n2.b);
  float tanK = max(tanPatch, tanChan) * (1.0 - wetness * 0.8) * (1.0 - algalK);
  vec3 flatCol = mix(mudDry, tanSand, tanK * 0.8);
  flatCol = mix(flatCol, algal, algalK * 0.8);
  flatCol = mix(flatCol, wetMud, wetness * 0.9);
  flatCol *= 0.94 + 0.12 * grain;
  // dry salt-crust plates: per-plate tone, dark crack lines, a slight pebbled grain
  float dryK = (1.0 - wetness) * (1.0 - algalK * 0.5) * nearC;
  float crackLine = (1.0 - smoothstep(0.0, 0.055, c1.g)) * (0.5 + 0.5 * (1.0 - smoothstep(0.0, 0.08, c2.g))) * smoothstep(0.22, 0.55, n4.a + n3.b * 0.4);
  flatCol *= 1.0 - 0.45 * crackLine * dryK;
  flatCol *= 1.0 + (c1.b - 0.5) * 0.16 * dryK + (c2.r - 0.5) * 0.14 * nearC;
  // salt-marsh grass / scrub: OSM scrub + procedural vegetation patches on the flats
  float vegProc = slEdge(n3.b * 0.55 + n4.a * 0.25 + m1.r * 0.2 - (0.60 - uPool.w * 0.08), 0.02) * flatMask * (1.0 - pool) * (1.0 - wetness * 0.6);
  float veg = max(smoothstep(0.35, 0.65, scrubM + (n4.b - 0.5) * 0.3), vegProc * 0.85);
  // dark olive-brown salt-marsh mats with a fine tufty grain (photo: #483b24 .. #2a2a1c); a greener / straw patch here and there
  vec3 vegCol = mix(vec3(0.028, 0.020, 0.006), vec3(0.056, 0.038, 0.010), smoothstep(0.3, 0.7, n2.g * 0.5 + n3.g * 0.5));
  vegCol = mix(vegCol, vec3(0.036, 0.040, 0.012), smoothstep(0.55, 0.8, n2.a) * 0.45);          // greener patches
  vegCol = mix(vegCol, vec3(0.115, 0.088, 0.048), smoothstep(0.68, 0.86, n2.b * 0.6 + n3.r * 0.4) * 0.45);   // dry straw
  vegCol *= 0.62 + 0.80 * (n3.g * 0.35 + n5.g * 0.30 + n4.g * 0.35);
  vegCol *= mix(vec3(0.80, 0.86, 0.78), vec3(1.30, 1.16, 1.12), smoothstep(0.25, 0.75, n1.b * 0.5 + n2.g * 0.5));   // broad lighter / darker marsh zones (kilometre and 300 m scale)
  vegCol = mix(vegCol, vec3(0.020, 0.018, 0.010), 0.55 * smoothstep(0.62, 0.8, n2.r * 0.6 + n3.a * 0.4));   // dark drainage hollows
  vegCol *= 1.0 + (c2.a - 0.5) * 0.45 * nearC + (c1.b - 0.5) * 0.30 * nearC;       // grass-tuft mottling near the camera
  vegCol *= 1.0 - 0.45 * (1.0 - smoothstep(0.55, 0.85, scrubM));                                // dark wet rim
  // dry, unmapped land: scruffy grass and soil
  vec3 dryLand = mix(vec3(0.034, 0.028, 0.0155), vec3(0.070, 0.054, 0.032), smoothstep(0.25, 0.75, n3.g * 0.5 + n2.r * 0.3 + n4.r * 0.2));
  vec3 sandCol = mix(vec3(0.36, 0.30, 0.21), vec3(0.45, 0.39, 0.29), n4.r);
  vec3 gravCol = mix(vec3(0.12, 0.11, 0.095), vec3(0.20, 0.185, 0.165), n4.g * 0.55 + n3.r * 0.3 + n5.r * 0.15);

  float landFlat = flatMask;
  vec3 col = mix(dryLand, flatCol, landFlat);
  // pale sandy halo around every scrub island and pool: the classic salt-flat rim (photo foreground)
  float rimVeg = smoothstep(0.03, 0.32, scrubB) * (1.0 - smoothstep(0.55, 0.9, veg)) * landFlat * (1.0 - authW);
  float rimK = clamp(max(rimVeg, rimPool), 0.0, 1.0) * (1.0 - authW);
  col = mix(col, tanSand * (0.95 + 0.3 * n4.g), rimK * (0.75 + 0.25 * n3.b));
  col = mix(col, vegCol, veg);
  float vegOnly = veg;
  col = mix(col, sandCol, smoothstep(0.4, 0.6, sandM + (n4.r - 0.5) * 0.25));
  col = mix(col, gravCol, smoothstep(0.35, 0.6, gravelM));
  col = mix(col, tanSand * 0.4, authW);                       // the bed of the authored pools is pale sand / silt (dark through the water column)
  col = mix(col, vec3(0.008, 0.0085, 0.009) * (0.7 + 0.6 * n4.r), corr * 0.92);
  float rough = mix(0.9, 0.42, wetness * landFlat * (1.0 - veg));
  rough = mix(rough, 0.95, veg);
  rough = mix(rough, 0.38, corr);
  s.wet = wetness * landFlat * (1.0 - veg) * (1.0 - rimK * 0.6);

  // ------------------------------------------------------------ beach: sand darkens/glosses toward the swash zone
  float sd = slSeaDist(xz);
  float swash = 1.0 - smoothstep(-16.0, 1.0, sd + (n3.r - 0.5) * 12.0 + (n4.g - 0.5) * 3.0);
  col = mix(col, col * vec3(0.52, 0.5, 0.47), swash * step(0.25, sandM + swash * 0.2));
  s.wet = max(s.wet, swash * 0.9 * step(0.25, sandM + swash * 0.2));
  rough = mix(rough, 0.32, swash * 0.85);

  s.albedo = col;
  s.rough = rough;

  // ------------------------------------------------------------ micro relief normal
  // Slopes come straight from a tileable slope map (see makeWaveSlopes) at three scales. They are mip-filtered by the
  // hardware and each scale fades out well before its wavelength drops under ~2 pixels, so there is no aliasing. (An
  // earlier version derived the normal from screen-space derivatives of a height field; that is fragile: a single
  // bad derivative at grazing angles turns the ground into white sparkle.)
  float fA = 1.0 - smoothstep(4.0, 26.0, camDist);
  float fB = 1.0 - smoothstep(22.0, 110.0, camDist);
  float fC = 1.0 - smoothstep(120.0, 600.0, camDist);
  vec2 g = ((texture(uWave, xz / 1.7 + 0.13).rg - 0.5) * 0.05 * fA * (1.0 - wetness * 0.6)
         + (texture(uWave, xz / 8.3 + 0.41).rg - 0.5) * 0.07 * fB
         + (texture(uWave, xz / 41.0 + 0.77).ba - 0.5) * 0.10 * fC) * (2.0 / 1.6);
  // dry crust plates: tilt each plate a little (cell id -> direction) and roll the cracks' edges
  g += (vec2(c1.b, fract(c1.b * 7.31)) - 0.5) * 0.10 * dryK * fA;
  g *= (1.0 - s.water);
  // frozen micro-ripples on water (very flat: the pools in the photo are nearly mirrors)
  vec2 rip = ((slNz(xz, 4.1).rg - 0.5) * 0.030 + (slNz(xz + 17.3, 0.93).rg - 0.5) * 0.010) * uReflParams.z * (0.4 + 0.6 * nearF);
  vec2 slope = mix(-g, rip, s.water);
  s.nW = normalize(vec3(slope.x, 1.0, slope.y));
  s.kelvin = mix(mix(296.0, 286.0, wetness), 291.0, s.water);
  s.kelvin = mix(s.kelvin, 312.0, smoothstep(0.35, 0.6, gravelM));
  return s;
}
