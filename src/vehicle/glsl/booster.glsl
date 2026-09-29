// Super Heavy B21: stainless tank skin with cryogenic frost.
//   y  < VH_SKIRT_TOP : aft skirt, bare steel with soot and heat tint, no frost
//   y  < VH_FROST_Y   : LOX tank, thick bright frost, cauliflower clumps with dark gaps
//   y  < VH_TANK_TOP  : CH4 tank, darker steel with patchy thinner frost
//   y >= VH_TANK_TOP  : hot-stage ring / truss, bare heat-stained steel
// Outputs are everything the PBR chunks need; kelvin feeds the thermal view.
//
// Frost = three layers of cylinder-wrapped (seamless) cellular clumps at 1.1 m, 0.45 m and 0.13 m plus fbm
// patches and vertical runoff streaks; each layer fades out by pixel footprint. The clumps double as the
// bump height, so sun grazing the frost picks out the crust.

// F1 distance (cell units) and cell hash of a cylinder-periodic cellular pattern; nu = cells around (integer)
vec2 vhWorleyCyl(vec2 uv, float nu) {
  vec2 c = floor(uv);
  vec2 f = fract(uv);
  float d1 = 8.0;
  float h = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 id = vec2(mod(c.x + g.x, nu), c.y + g.y);
      vec2 o = vec2(sl_hash12(id), sl_hash12(id + 37.31));
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d1 = d; h = sl_hash12(id + 11.7); }
    }
  }
  return vec2(sqrt(d1), h);
}

// clump height 0..1 (1 = crest) of one layer: wl = horizontal wavelength (m), stretch = vertical/horizontal
float vhClumps(float az, float y, float wl, float stretch, vec3 pw, out float cellHash) {
  float nu = max(floor(28.274 / wl + 0.5), 4.0);
  // domain warp breaks the regular cell lattice into irregular, braided clumps
  float wa = vhNoise(pw * (1.0 / wl) * 0.9) - 0.5;
  float wy = vhNoise(pw * (1.0 / wl) * 0.9 + 19.3) - 0.5;
  vec2 w = vhWorleyCyl(vec2((az * 0.15915494 + 0.5) * nu + wa * 1.1, y / (wl * stretch) + wy * 0.9), nu);
  cellHash = w.y;
  return 1.0 - smoothstep(0.05, 0.85, w.x);
}

void vhBooster(vec3 p, vec3 nObj,
               out vec3 alb, out float rough, out float metal, out float H, out float kelvin, out float frost) {
  float y = p.y;
  float az = vhAzimuth(p);

  // ---- large scale variation
  float wob = vhFbm(vec3(p.x * 0.30, 3.1, p.z * 0.30), 3.3);               // boundary wobble, ~3 m
  float macro = vhFbm(vec3(p.x * 0.42, p.y * 0.105, p.z * 0.42), 2.4);    // patches, vertically stretched 4x
  float streak = vhFbm(vec3(p.x * 5.0, p.y * 0.42, p.z * 5.0), 0.2);      // runoff streaks
  float dseam = abs(fract((y - VH_SKIRT_TOP) / 1.83 + 0.5) - 0.5) * 1.83;
  float band = vhSmoothBand(dseam, 0.32);                                  // frost thickens at ring welds

  // ---- clump layers (fade by footprint)
  float hA, hB = 0.0, hC = 0.0;
  float c1 = vhClumps(az, y, 1.10, 2.0, p, hA);
  float c2 = 0.5, c3 = 0.5;      // low quality (uVhOct < 4): only the 1.1 m clumps
  if (uVhOct >= 4.0) {
    float w2 = vhDetail(0.45);
    c2 = w2 > 0.01 ? mix(0.5, vhClumps(az, y + 3.7, 0.45, 2.0, p + 7.7, hB), w2) : 0.5;
    float w3 = vhDetail(0.13);
    c3 = w3 > 0.01 ? mix(0.5, vhClumps(az, y + 9.1, 0.13, 1.6, p + 13.1, hC), w3) : 0.5;
  }
  float crust = c1 * 0.5 + c2 * 0.32 + c3 * 0.18;                          // 0..1, 1 = crest
  float relief = 0.10 * (c1 - 0.4) * vhDetailB(1.1) + 0.045 * (c2 - 0.4) * vhDetailB(0.45) + 0.014 * (c3 - 0.4) * vhDetailB(0.13);   // metres: slope ~0.1-0.2 at every scale

  // ---- frost coverage profile along the vehicle
  float yb = VH_FROST_Y + 2.6 * (wob - 0.5);
  float lower = 1.0 - smoothstep(yb - 1.3, yb + 1.7, y);
  float cov = mix(0.74, 0.96, lower);
  cov *= smoothstep(VH_SKIRT_TOP + 0.4, VH_SKIRT_TOP + 3.5, y);            // little frost near the warm engine bay
  cov *= 1.0 - smoothstep(VH_TANK_TOP - 3.0, VH_TANK_TOP + 0.3, y);        // and near the hot-stage ring
  float t = cov + (macro - 0.5) * (0.80 + 0.5 * (1.0 - lower)) + (crust - 0.42) * 0.22 + (streak - 0.5) * 0.30
          + band * 0.08 * lower;
  float m = smoothstep(0.30, 0.48, t);
  frost = m;

  // ---- micro detail (crystals) only when resolved
  float crystal = mix(0.5, vhNoise(p * 36.0), vhDetail(0.06));
  float crystal2 = mix(0.5, vhNoise(p * 130.0 + 3.7), vhDetail(0.017));

  // ---- albedo: bright crests, darker troughs between the clumps
  // Frost is spectrally flat (ice crystals scatter all wavelengths alike); its colour in the photo is the light's:
  // warm cream in the low sun, blue-grey in skylight. A faint warm cast from the pad dust and soot the deluge
  // steam deposits on it; the thin, patchy frost of the CH4 tank lets the grey steel through.
  vec3 frostCol = vec3(0.86, 0.85, 0.82) * (0.62 + 0.42 * smoothstep(0.10, 0.85, crust) + 0.10 * (macro - 0.5) + 0.10 * (crystal - 0.5));
  frostCol = mix(frostCol, vec3(0.74, 0.75, 0.76), (1.0 - lower) * 0.35);
  float wear = vhFbm(vec3(p.x * 1.7, p.y * 0.30, p.z * 1.7), 0.6);
  vec3 steelCol = vec3(0.50, 0.52, 0.56) * (0.72 + 0.5 * wear);
  // hot-stage heat stain: dark, gold/blue tinted
  float hs = smoothstep(VH_TANK_TOP - 0.2, VH_TANK_TOP + 1.2, y);
  steelCol = mix(steelCol, vec3(0.30, 0.28, 0.27) * (0.7 + 0.6 * wear), hs * 0.85);
  // weld seams on bare steel: ring welds + staggered vertical welds (4 per ring), heat tinted
  float ringIdx = floor((y - VH_SKIRT_TOP) / 1.83);
  float qArc = az * 4.5;
  float qLen = 0.5 * 3.14159265 * 4.5;
  float dvert = abs(fract((qArc + vhHash21(vec2(ringIdx, 1.0)) * qLen) / qLen + 0.5) - 0.5) * qLen;
  float weld = max(vhSmoothBand(dseam, 0.03), vhSmoothBand(dvert, 0.025) * 0.8) * vhDetail(0.08);
  steelCol = mix(steelCol, steelCol * vec3(0.92, 0.80, 0.58), weld * 0.7);

  // soot on the aft skirt, streaking up the tank
  float ny = vhNoise(vec3(p.x * 0.8, 0.0, p.z * 0.8));
  float soot = (1.0 - smoothstep(VH_SKIRT_TOP - 1.4 + 1.2 * ny, VH_SKIRT_TOP + 0.6 + 2.0 * ny, y)) * 0.75;
  float sootStreak = (1.0 - smoothstep(VH_SKIRT_TOP, VH_SKIRT_TOP + 5.0 + 6.0 * streak, y)) * 0.38;
  soot = max(soot * 0.95, sootStreak);
  // interior of the engine bay (skirt inner wall: normal points toward the axis)
  float inward = step(dot(normalize(nObj.xz + 1e-6), normalize(p.xz + 1e-6)), -0.3) * (1.0 - smoothstep(3.2, 3.5, y));
  soot = max(soot, inward);

  vec3 steel = steelCol * (1.0 - 0.70 * soot);
  float lip = 1.0 - smoothstep(0.0, 0.35, y);                              // heat tint on the very lip of the skirt
  steel = mix(steel, vec3(0.32, 0.26, 0.20), lip * 0.5);
  alb = mix(steel, frostCol, m);

  // ---- roughness / metalness
  float brush = mix(0.5, vhNoise(vec3(p.x * 2.0, p.y * 40.0, p.z * 2.0)), vhDetail(0.03));
  float rSteel = 0.38 + 0.12 * (wear - 0.5) + 0.05 * (brush - 0.5) + 0.35 * soot;
  rough = clamp(mix(rSteel, 0.80 - 0.10 * crystal - 0.35 * smoothstep(0.78, 0.96, crystal2), m), 0.08, 1.0);
  metal = (1.0 - m) * (1.0 - 0.55 * soot);

  // ---- height (metres) for the bump: clump crust dominates
  H = m * (relief + 0.004 * (crystal - 0.5) * vhDetailB(0.06) + 0.005 * (wear - 0.5) * vhDetailB(0.6) + 0.02)
    + (1.0 - m) * (0.0003 * (brush - 0.5) + 0.0012 * weld);

  // ---- thermal: frost 110-180 K, tank walls 150-250 K, skirt warm
  float tankK = mix(215.0, 172.0, lower);
  kelvin = mix(tankK + 25.0 * (wear - 0.5), 140.0 + 40.0 * (crust - 0.4) + 12.0 * (crystal - 0.5), m);
  kelvin = mix(kelvin, 292.0, hs);
  kelvin = mix(kelvin, 340.0 + 40.0 * soot, 1.0 - smoothstep(VH_SKIRT_TOP - 0.5, VH_SKIRT_TOP + 1.5, y));
}
