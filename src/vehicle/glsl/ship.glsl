// Starship S41: black hexagonal tile heat shield on the windward half and the whole nose, brushed
// stainless with weld seams and slight bluing on the leeward side. Windward = -z (azimuth 90 deg).
//
// Tiles are laid out on the unrolled hull (u = r * phi around, v = height); the coverage boundary is
// decided per HEX CELL (its centre angle), which gives the real, stair-stepped zig-zag heat-shield edge.

// shared: the tile albedo/roughness for one hex cell. gv/id from vhHex, e = edge distance (tile units)
void vhTileShade(vec2 id, float e, float footTile, out vec3 alb, out float rough, out float H, out float steelShow) {
  float h1 = vhHash21(id + 3.7);
  float h2 = vhHash21(id + 91.3);
  float h3 = vhHash21(id + 17.9);
  float gapHalf = 0.5 * VH_TILE_GAP / VH_TILE;
  float aa = max(footTile, 1e-4);
  float gap = 1.0 - smoothstep(gapHalf - aa, gapHalf + aa, e);           // 1 in the gap between tiles
  // tile body: near black glassy coating; per-tile tone, a few reflown / lighter tiles, very few missing ones
  float tone = mix(0.010, 0.030, h1 * h1);
  vec3 tile = vec3(tone) * vec3(1.0, 0.98, 1.06);
  float light = smoothstep(0.988, 0.996, h2);                                // ~2 % lighter (reflown/new) tiles
  tile = mix(tile, vec3(0.035, 0.034, 0.033), light);
  // subtle edge chamfer wear
  float edge = 1.0 - smoothstep(gapHalf, gapHalf + 0.06, e);
  tile *= 1.0 + 1.3 * edge * (0.4 + h3);
  steelShow = step(0.9965, h2) * (1.0 - gap);                               // missing tile: steel substrate shows
  vec3 filler = vec3(0.028, 0.026, 0.025);                                   // dark gap filler
  alb = mix(tile, filler, gap);
  rough = mix(0.17 + 0.14 * h3 + 0.25 * light, 0.85, gap);
  // pillow-shaped tile: tiny dome, deep gap
  H = 0.0011 * smoothstep(gapHalf, gapHalf + 0.12, e) - 0.0016 * gap + 0.0003 * (h1 - 0.5);
}

void vhShip(vec3 p, vec3 nObj,
            out vec3 alb, out float rough, out float metal, out float H, out float kelvin,
            out float tile, out float cc, out float ccRough) {
  float ys = p.y - VH_SHIP_Y0;
  float rr = max(length(p.xz), 0.02);
  vec2 q = dot(p.xz, p.xz) < 1e-8 ? vec2(0.0, 1.0) : p.xz;   // guard the exact axis (nose tip)
  float phi = atan(q.x, -q.y);                          // 0 at the belly (-z), +-pi at the leeward side
  float dseam = abs(fract((ys - 3.4) / 1.83 + 0.5) - 0.5) * 1.83;

  // ---- tile layout
  vec2 P = vec2(rr * phi, ys) / VH_TILE;
  vec2 gv, id;
  vhHex(P, gv, id);
  float e = vhHexEdge(gv);
  float phiC = (id.x * VH_TILE) / rr;
  float ysC = id.y * VH_TILE;
  float noseW = smoothstep(VH_NOSE_Y0 - 0.2, VH_NOSE_Y0 + 2.5, ys);          // nose is tiled all around
  float edgePhi = mix(VH_TILE_EDGE_PHI, 3.6, noseW);
  float jag = (vhHash21(vec2(id.y, 4.0)) - 0.5) * 0.09;                       // raggedness of the shield edge
  float on = (1.0 - step(edgePhi + jag, abs(phiC))) * step(VH_TILE_Y0, ysC);
  // fade to the mean when the pixel covers many tiles
  float footTile = vhFoot / VH_TILE;
  float pat = 1.0 - smoothstep(0.16, 0.50, footTile);

  vec3 tAlb; float tRough, tH, steelShow;
  vhTileShade(id, e, footTile, tAlb, tRough, tH, steelShow);
  vec3 tAvg = vec3(0.0135);
  tAlb = mix(tAvg, tAlb, pat);
  tRough = mix(0.24, tRough, pat);
  tH *= pat;

  // ---- brushed stainless
  float ring = floor((ys - 3.4) / 1.83);
  float wOff = vhHash21(vec2(ring, 1.0)) * 1.5;
  float arc = rr * phi;
  float dv = abs(fract((arc + wOff) / (0.5 * 3.14159 * 4.5) + 0.5) - 0.5) * (0.5 * 3.14159 * 4.5);   // 4 vertical welds/ring, staggered
  float sMask = max(vhSmoothBand(dseam, 0.03), vhSmoothBand(dv, 0.025) * 0.7) * vhDetail(0.08);
  float blue = vhFbm(vec3(p.x * 0.35, p.y * 0.35, p.z * 0.35), 3.0);
  float wear = vhFbm(vec3(p.x * 1.4, p.y * 0.5, p.z * 1.4), 0.7);
  vec3 steel = vec3(0.60, 0.61, 0.63) * (0.78 + 0.35 * wear);
  steel = mix(steel, steel * vec3(0.62, 0.72, 0.98), smoothstep(0.52, 0.72, blue) * 0.55);   // bluing
  steel = mix(steel, steel * vec3(0.96, 0.84, 0.66), sMask * 0.6);                            // weld heat tint
  float brush = mix(0.5, vhNoise(vec3(p.x * 2.5, p.y * 70.0, p.z * 2.5)), vhDetail(0.02));
  float sRough = 0.30 + 0.07 * (wear - 0.5) + 0.10 * (brush - 0.5) + 0.12 * sMask;
  float canning = vhFbm(vec3(p.x * 1.1, p.y * 0.8, p.z * 1.1), 0.9) - 0.5;      // oil-canning of the thin skin

  // ---- combine: tile over steel; missing tiles show steel; aft skirt is soot-dark
  float tl = on * (1.0 - steelShow);
  alb = mix(steel, tAlb, tl);
  rough = mix(sRough, tRough, tl);
  metal = mix(1.0, 0.0, tl);
  H = mix(0.0004 * (brush - 0.5) + 0.006 * canning * vhDetailB(0.9), tH, tl);
  tile = tl;
  cc = tl * 0.9;
  ccRough = mix(0.5, 0.11 + 0.1 * (1.0 - pat), tl);

  float skirt = 1.0 - smoothstep(VH_SKIRT_Y - 0.25, VH_SKIRT_Y + 0.25, ys);
  float inward = step(dot(normalize(nObj.xz + 1e-6), normalize(p.xz + 1e-6)), -0.3);
  float dark = max(skirt, inward * (1.0 - smoothstep(3.3, 3.6, ys)));
  alb = mix(alb, vec3(0.05, 0.048, 0.046) * (0.6 + 0.8 * wear), dark * 0.9);
  rough = mix(rough, 0.62, dark);
  metal = mix(metal, 0.5, dark);
  tile *= 1.0 - dark;
  cc *= 1.0 - dark;

  kelvin = mix(mix(283.0 + 8.0 * (wear - 0.5), 292.0, tl), 345.0, dark);
}

// Flap: tiles on the belly-facing face (object normal toward -z), brushed steel on the back and edges.
void vhFlap(vec3 p, vec3 nObj,
            out vec3 alb, out float rough, out float metal, out float H, out float kelvin,
            out float tile, out float cc, out float ccRough) {
  vec3 n = normalize(nObj);
  vec3 t1 = cross(vec3(0.0, 1.0, 0.0), n);
  float l = length(t1);
  t1 = l > 1e-3 ? t1 / l : vec3(1.0, 0.0, 0.0);
  vec2 P = vec2(dot(p, t1), p.y) / VH_TILE;
  vec2 gv, id;
  vhHex(P, gv, id);
  float e = vhHexEdge(gv);
  float footTile = vhFoot / VH_TILE;
  float pat = 1.0 - smoothstep(0.16, 0.50, footTile);
  vec3 tAlb; float tRough, tH, steelShow;
  vhTileShade(id, e, footTile, tAlb, tRough, tH, steelShow);
  tAlb = mix(vec3(0.0135), tAlb, pat);
  tRough = mix(0.24, tRough, pat);
  float face = smoothstep(0.55, 0.85, -n.z);          // 1 on the belly-facing flat face
  float wear = vhFbm(vec3(p.x * 1.4, p.y * 0.5, p.z * 1.4), 0.7);
  float brush = mix(0.5, vhNoise(vec3(p.x * 2.5, p.y * 70.0, p.z * 2.5)), vhDetail(0.02));
  vec3 steel = vec3(0.34, 0.34, 0.36) * (0.7 + 0.5 * wear);
  float tl = face * (1.0 - steelShow);
  alb = mix(steel, tAlb, tl);
  rough = mix(0.36 + 0.1 * (brush - 0.5), tRough, tl);
  metal = mix(1.0, 0.0, tl);
  H = tH * pat * tl;
  tile = tl;
  cc = tl * 0.9;
  ccRough = 0.14;
  kelvin = mix(290.0, 298.0, tl);
}
