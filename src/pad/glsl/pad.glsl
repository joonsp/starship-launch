// Procedural surface models of the launch pad (Pad 2). OWNER: pad module.
// Pasted after common.glsl (sl_hash13, sl_saturate ...). Everything is driven by WORLD position (vSlWorldPos) or the
// tower-local object position, never by UVs (the pad GLB has none). Every fbm octave and every crack/joint is faded by
// the pixel footprint pdFw (metres per pixel, set once per fragment), so the 20 px tower of the photo view has no
// shimmer while a 1.7 m eye-height close-up resolves pores, weld seams and grating bars.

#define PD_TAU 6.28318530718

// PAD-LOCAL frame: the mount, trench, diverter, apron and their plumbing are built with x along the flame-trench axis
// (world bearing 123 deg) and placed with rotation.y = PAD_YAW (-33.1 deg, scene-config.ts). pdL rotates a world
// position or direction into that frame (same as toPadLocal), so joints, soot fans and brushing follow the geometry.
const float PD_PAD_C = 0.83766, PD_PAD_S = -0.54612;   // cos / sin of PAD_YAW
vec3 pdL(vec3 v) { return vec3(PD_PAD_C * v.x - PD_PAD_S * v.z, v.y, PD_PAD_S * v.x + PD_PAD_C * v.z); }

float pdFw = 0.0;   // pixel footprint in metres (fwidth of the world position); set by pdInit

void pdInit(vec3 p) {
  vec3 fw = fwidth(p);
  pdFw = length(fw);
  if (!(pdFw >= 0.0) || pdFw > 1000.0) pdFw = 0.0;
}

// 1 while a feature of size `s` metres is comfortably resolved, 0 once it drops below ~1 px
float pdFade(float s) { return 1.0 - smoothstep(0.35, 1.3, pdFw / s); }

float pdH(vec3 p) { return sl_hash13(p); }

float pdNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = pdH(i), b = pdH(i + vec3(1, 0, 0)), c = pdH(i + vec3(0, 1, 0)), d = pdH(i + vec3(1, 1, 0));
  float e = pdH(i + vec3(0, 0, 1)), g = pdH(i + vec3(1, 0, 1)), h = pdH(i + vec3(0, 1, 1)), k = pdH(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}

// fbm on a pre-scaled coordinate q (= p / wl0). wl0 = shortest base wavelength in metres, used for the fade only.
float pdFbm(vec3 q, float wl0) {
  float s = 0.0, a = 0.5, tot = 0.0, wl = wl0;
  for (int i = 0; i < PD_OCT_MAX; i++) {
    if (float(i) >= uPdOct) break;   // octave count per quality tier is a uniform (no recompile on a quality switch)
    float fade = 1.0 - smoothstep(0.4, 1.6, pdFw / wl);
    // an octave that dropped below the pixel footprint contributes its mean, so the average tone does not drift
    // (octaves already below the pixel footprint skip the noise fetch entirely: the branch is coherent per tile)
    s += a * (fade > 0.002 ? fade * pdNoise(q) + (1.0 - fade) * 0.5 : 0.5);
    tot += a;
    q = q * 2.03 + 11.7; a *= 0.5; wl *= 0.5;
  }
  return s / tot;
}

// cellular F1/F2 distances on a plane (cell size 1 in q); returns vec2(F1, F2)
vec2 pdWorley(vec2 q) {
  vec2 c = floor(q), f = fract(q);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = vec2(sl_hash12(c + g), sl_hash12(c + g + 41.7));
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(vec2(d1, d2));
}

// Mikkelsen bump: perturb the view-space normal `n` by the screen-space gradient of height h (metres) at position vp
vec3 pdBump(vec3 vp, vec3 n, float h, float amp) {
  vec3 dpdx = dFdx(vp), dpdy = dFdy(vp);
  float dhx = dFdx(h) * amp, dhy = dFdy(h) * amp;
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  if (abs(det) < 1e-12) return n;
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * n - grad);
}

// tangent-plane 2D coordinates of a world point for a surface with world normal nW (dominant-axis projection)
vec2 pdPlane(vec3 p, vec3 nW) {
  vec3 a = abs(nW);
  if (a.y >= a.x && a.y >= a.z) return p.xz;
  if (a.x >= a.z) return vec2(p.z, p.y);
  return vec2(p.x, p.y);
}

// ----------------------------------------------------------------------------------------------- outputs
struct PdSurf { vec3 alb; float rough; float metal; float H; float frost; };

#define PD_LIN(r,g,b) vec3(r,g,b)

// ------------------------------------------------------------------------------------------- red steel
// Weathered rust-red painted steel: vertical run-off streaks from joints, rust blooms, chipped paint down to bare
// steel, ground dust on the lower 30 m and on upward faces, sun-bleached chalking above.
PdSurf pdTowerPaint(vec3 p, vec3 nW) {
  PdSurf s;
  float streak = pdFbm(vec3(p.x * 1.9, p.y * 0.07, p.z * 1.9), 0.5);
  float blotch = pdFbm(p / 3.2, 3.2);
  float fine = pdFbm(p / 0.22, 0.22);
  float low = 1.0 - smoothstep(0.0, 32.0, p.y);
  vec3 paint = PD_LIN(0.22, 0.068, 0.054) * (0.82 + 0.36 * blotch);
  paint = mix(paint, PD_LIN(0.30, 0.095, 0.06), smoothstep(0.55, 0.9, blotch) * 0.5);       // fading / chalk
  float rustMask = smoothstep(0.50, 0.80, streak * 0.62 + blotch * 0.42 + low * 0.18 - 0.05);
  vec3 rust = PD_LIN(0.30, 0.115, 0.045) * (0.7 + 0.6 * fine);
  vec3 alb = mix(paint, rust, rustMask * 0.75);
  float chip = smoothstep(0.80, 0.90, fine * 0.55 + streak * 0.5) * pdFade(0.2);
  alb = mix(alb, PD_LIN(0.060, 0.055, 0.052), chip);
  // dust: heavier low down and on upward faces
  float dust = clamp(low * 0.5 + smoothstep(0.55, 1.0, nW.y) * 0.4, 0.0, 0.7) * (0.6 + 0.6 * blotch);
  alb = mix(alb, PD_LIN(0.30, 0.235, 0.17), dust * 0.55);
  s.alb = alb;
  s.rough = 0.60 + 0.22 * rustMask + 0.15 * dust - 0.25 * chip;
  s.metal = 0.10 + 0.50 * chip + 0.05 * rustMask;
  s.H = (fine - 0.5) * 0.006 + (blotch - 0.5) * 0.004 + rustMask * 0.006 - chip * 0.0015;
  s.frost = 0.0;
  return s;
}

// ---------------------------------------------------------------------------------------- bare metals
PdSurf pdGalv(vec3 p, vec3 nW) {
  PdSurf s;
  float blotch = pdFbm(p / 0.7, 0.7);
  float spang = pdFbm(p / 0.05, 0.05);
  float streak = pdFbm(vec3(p.x * 3.0, p.y * 0.2, p.z * 3.0), 0.33);
  vec3 alb = PD_LIN(0.50, 0.51, 0.53) * (0.78 + 0.34 * spang);
  alb = mix(alb, PD_LIN(0.30, 0.29, 0.28), smoothstep(0.55, 0.85, blotch * 0.6 + streak * 0.5) * 0.7);   // zinc weathering
  float rust = smoothstep(0.78, 0.92, pdFbm(p / 0.4, 0.4) * 0.6 + streak * 0.45);
  alb = mix(alb, PD_LIN(0.20, 0.09, 0.045), rust * 0.55);
  s.alb = alb;
  s.rough = 0.40 + 0.25 * blotch + 0.2 * rust;
  s.metal = 0.95 - 0.35 * rust;
  s.H = (spang - 0.5) * 0.0015;
  s.frost = 0.0;
  return s;
}

PdSurf pdDarkSteel(vec3 p, vec3 nW) {
  PdSurf s;
  float blotch = pdFbm(p / 0.9, 0.9);
  float fine = pdFbm(p / 0.08, 0.08);
  float oil = smoothstep(0.55, 0.85, pdFbm(vec3(p.x * 4.0, p.y * 0.35, p.z * 4.0), 0.25));
  vec3 alb = PD_LIN(0.048, 0.047, 0.052) * (0.7 + 0.6 * blotch);
  alb = mix(alb, PD_LIN(0.16, 0.075, 0.04), smoothstep(0.66, 0.92, fine * 0.5 + blotch * 0.6) * 0.25);   // rust specks
  s.alb = alb;
  s.rough = 0.48 + 0.3 * fine - 0.2 * oil;
  s.metal = 0.85;
  s.H = (fine - 0.5) * 0.002;
  s.frost = 0.0;
  return s;
}

// steel deck plate / stainless with brushing, weld seams and (for the OLM) scorch toward the booster opening
PdSurf pdStainless(vec3 p, vec3 nW, float scorchAmt, float wet) {
  PdSurf s;
  // brushing streaks run along the surface: along world x/z tangent on vertical faces, along x on horizontal ones
  vec2 t2 = normalize(vec2(-nW.z, nW.x) + vec2(1e-4));
  float horiz = smoothstep(0.6, 0.9, abs(nW.y));
  vec3 bq = mix(vec3(dot(p.xz, t2) * 3.0, p.y * 9.0, 3.0), vec3(p.x * 3.0, p.z * 9.0, 7.0), horiz);
  float brush = pdFbm(bq, 0.11);
  float blotch = pdFbm(p / 1.6, 1.6);
  float grime = smoothstep(0.42, 0.85, pdFbm(p / 3.0, 3.0));
  float runoff = smoothstep(0.55, 0.85, pdFbm(vec3(p.x * 1.4, p.y * 0.14, p.z * 1.4), 0.7)) * (1.0 - horiz);
  vec3 alb = PD_LIN(0.42, 0.43, 0.45) * (0.92 + 0.14 * brush);
  alb = mix(alb, PD_LIN(0.28, 0.27, 0.26), smoothstep(0.5, 0.9, blotch) * 0.25);
  alb *= 1.0 - 0.2 * grime - 0.22 * runoff;
  // heat tint: straw -> blue oxide
  float tint = scorchAmt * smoothstep(0.35, 0.8, blotch + 0.2);
  alb = mix(alb, mix(PD_LIN(0.24, 0.17, 0.09), PD_LIN(0.07, 0.08, 0.15), smoothstep(0.4, 0.9, blotch)), tint * 0.45);
  alb *= 1.0 - 0.72 * scorchAmt * (0.5 + 0.5 * pdFbm(p / 0.5, 0.5));
  s.alb = alb;
  s.rough = 0.30 + 0.22 * brush + 0.30 * grime + 0.35 * scorchAmt - 0.12 * wet;
  s.metal = 1.0 - 0.3 * scorchAmt - 0.25 * grime;
  s.H = (brush - 0.5) * 0.0008;
  s.frost = 0.0;
  return s;
}

// Heat-blackened flame diverter: soot black, spalling brown oxide flakes, bright scuffed nose, white mineral crust.
PdSurf pdDiverter(vec3 p, vec3 nW) {
  PdSurf s;
  float blotch = pdFbm(p / 1.1, 1.1);
  float fine = pdFbm(p / 0.10, 0.10);
  float nose = exp(-abs(p.x) / 1.7);
  float scuff = smoothstep(0.55, 0.85, pdFbm(vec3(p.x * 2.0, p.y * 2.0, p.z * 0.6), 0.2)) * nose;
  vec3 alb = PD_LIN(0.030, 0.028, 0.026) * (0.6 + 0.9 * blotch);
  alb = mix(alb, PD_LIN(0.13, 0.058, 0.028), smoothstep(0.55, 0.85, fine * 0.5 + blotch * 0.6) * 0.6);
  float crust = smoothstep(0.7, 0.9, pdFbm(vec3(p.x * 0.6, p.y * 0.6, p.z * 3.0), 0.3)) * (1.0 - nose);
  alb = mix(alb, PD_LIN(0.32, 0.30, 0.26), crust * 0.6);
  alb = mix(alb, PD_LIN(0.22, 0.22, 0.23), scuff);
  s.alb = alb;
  s.rough = 0.62 - 0.35 * scuff + 0.2 * crust;
  s.metal = 0.85 - 0.6 * crust;
  s.H = (fine - 0.5) * 0.008 + crust * 0.004;
  s.frost = 0.0;
  return s;
}

// ------------------------------------------------------------------------------------------- painted grey
PdSurf pdOlmColumn(vec3 p, vec3 nW) {
  PdSurf s;
  float streak = pdFbm(vec3(p.x * 1.5, p.y * 0.09, p.z * 1.5), 0.6);
  float blotch = pdFbm(p / 2.5, 2.5);
  float fine = pdFbm(p / 0.15, 0.15);
  float low = 1.0 - smoothstep(0.0, 6.0, p.y);
  vec3 alb = PD_LIN(0.30, 0.31, 0.32) * (0.8 + 0.3 * blotch);
  alb = mix(alb, PD_LIN(0.12, 0.11, 0.10), smoothstep(0.5, 0.9, streak) * 0.5);                 // soot streaks
  alb = mix(alb, PD_LIN(0.20, 0.09, 0.04), low * smoothstep(0.5, 0.8, fine) * 0.6);              // rust at the feet
  s.alb = alb;
  s.rough = 0.58 + 0.2 * fine;
  s.metal = 0.25;
  s.H = (fine - 0.5) * 0.004;
  s.frost = 0.0;
  return s;
}

// ------------------------------------------------------------------------------------------- grating
PdSurf pdGrating(vec3 p, vec3 nW) {
  PdSurf s;
  // 30 mm bearing bars along x, 100 mm cross rods along z: mask = bar present
  float bx = step(fract(p.z * 33.3), 0.16);
  float bz = step(fract(p.x * 10.0), 0.10);
  float mask = max(bx, bz);
  float fine = smoothstep(0.012, 0.05, pdFw);
  mask = mix(mask, 0.32, fine);
  float top = smoothstep(0.5, 0.9, abs(nW.y));
  mask = mix(1.0, mask, top);
  float dirt = pdFbm(p / 0.8, 0.8);
  s.alb = mix(PD_LIN(0.008, 0.008, 0.009), PD_LIN(0.34, 0.34, 0.35) * (0.6 + 0.6 * dirt), mask);
  s.rough = 0.5;
  s.metal = 0.9 * mask;
  s.H = (mask - 0.5) * 0.004 * (1.0 - fine);
  s.frost = 0.0;
  return s;
}

// ---------------------------------------------------------------------------------------------- concrete
// variant 0 plain, 1 apron (slab joints, radial soot fan, tyre marks), 2 trench (scorched, spalled)
PdSurf pdConcrete(vec3 p, vec3 nW, int variant) {
  PdSurf s;
  vec2 c = pdPlane(p, nW);
  float macro = pdFbm(p / 9.0, 9.0);
  float mid = pdFbm(p / 0.9, 0.9);
  float pore = pdFbm(p / 0.07, 0.07);
  float stainStreak = pdFbm(vec3(c.x * 0.9, c.y * 0.12, 0.5), 1.1);
  // aged, dust-toned concrete (the site's aggregate is tan sand): warm mid grey-brown, never the clean light grey of new pours
  vec3 alb = PD_LIN(0.21, 0.17, 0.14) * (0.75 + 0.45 * macro) * (0.85 + 0.3 * mid);
  // hairline cracks: cellular ridges at ~2.6 m cells, domain-warped
  float crack = 0.0;
  if (pdFade(0.03) > 0.002) {
    vec2 w = pdWorley(c / 2.6 + vec2(mid, macro) * 0.6);
    crack = (1.0 - smoothstep(0.0, 0.035 + pdFw * 0.5, w.y - w.x)) * pdFade(0.03);
  }
  alb *= 1.0 - 0.55 * crack;
  float H = (pore - 0.5) * 0.003 + (mid - 0.5) * 0.004 - crack * 0.006;
  float dark = 0.0;
  if (variant == 1) {
    // Pad-2 apron (pad-local frame): a weathered warm grey-brown pour, not fresh grey concrete. Broad dust, mud and
    // wash-down patches at 15-60 m, slab-to-slab tone steps every 12 m, and heavy soot near the mount.
    alb *= PD_LIN(0.538, 0.376, 0.300);
    float big = smoothstep(0.30, 0.70, pdFbm(vec3(p.x, p.z, 3.7) / 42.0, 42.0));
    float pat = smoothstep(0.30, 0.70, pdFbm(vec3(p.x, p.z, 9.1) / 14.0 + big, 14.0));
    alb *= (0.62 + 0.80 * big) * (0.82 + 0.36 * smoothstep(0.30, 0.70, macro));
    alb = mix(alb, PD_LIN(0.150, 0.088, 0.055), smoothstep(0.55, 0.95, pat) * 0.6);             // mud / dust tongues off the flats
    alb = mix(alb, PD_LIN(0.045, 0.034, 0.028), smoothstep(0.55, 0.95, 1.0 - pat) * 0.55);     // wet / oil-stained pours
    vec2 cell = floor(p.xz / 12.0);
    float tone = sl_hash12(cell);
    alb *= 0.90 + 0.20 * tone;
    // expansion joints: thin dark lines, faded out once they are below a pixel (no plaid at distance)
    vec2 g = abs(fract(p.xz / 12.0 + 0.5) - 0.5) * 12.0;
    float jd = min(g.x, g.y);
    float joint = (1.0 - smoothstep(0.015, 0.05 + pdFw * 0.5, jd)) * (1.0 - smoothstep(0.04, 0.22, pdFw));
    alb = mix(alb, PD_LIN(0.05, 0.045, 0.04), joint * 0.5);
    H -= joint * 0.005;
    // exhaust soot: radial about the mount + an east-west fan out of the trench mouths + a long lobe toward the front edge
    float r = length(p.xz);
    float fan = exp(-abs(p.z) / 18.0) * exp(-abs(p.x) / 90.0);
    float lobe = exp(-abs(p.x - 20.0) / 60.0) * smoothstep(-20.0, 60.0, p.z) * exp(-max(p.z - 60.0, 0.0) / 90.0);
    dark = clamp(exp(-r / 34.0) * 0.9 + fan * 0.65 + lobe * 0.25, 0.0, 0.92) * (0.65 + 0.7 * macro);
    // oil / tyre darkening
    float oil = smoothstep(0.62, 0.85, pdFbm(p / 3.5, 3.5));
    alb *= 1.0 - 0.35 * oil;
    // wash-down water shine near the trench; otherwise fully rough (no sky sheen at grazing view)
    s.rough = 0.98 - 0.20 * smoothstep(0.65, 0.9, macro) * exp(-r / 45.0);
  } else if (variant == 2) {
    float depth = smoothstep(0.5, -8.0, p.y);
    dark = clamp(0.35 + 0.45 * depth + 0.35 * exp(-abs(p.x) / 20.0), 0.0, 0.95) * (0.7 + 0.5 * macro);
    float spall = smoothstep(0.62, 0.82, pdFbm(p / 0.6, 0.6) * 0.6 + mid * 0.4) * depth;   // exposed aggregate
    alb = mix(alb, PD_LIN(0.27, 0.23, 0.19), spall * 0.5);
    H -= spall * 0.012;
    // vertical panel joints on walls every 7.5 m
    float pj = abs(fract(p.x / 7.5 + 0.5) - 0.5) * 7.5;
    alb *= 1.0 - 0.6 * (1.0 - smoothstep(0.02, 0.08 + pdFw, pj)) * smoothstep(0.6, 0.9, 1.0 - abs(nW.y));
    s.rough = 0.88;
  } else {
    dark = 0.25 * stainStreak;
    s.rough = 0.86;
  }
  alb = mix(alb, alb * PD_LIN(0.30, 0.28, 0.27), dark);
  s.alb = alb;
  if (variant == 0) s.rough = 0.86 + 0.1 * pore;
  s.metal = 0.0;
  s.H = H;
  s.frost = 0.0;
  return s;
}

// -------------------------------------------------------------------------------------------- tanks (white)
PdSurf pdTank(vec3 p, vec3 op, vec3 nW, float frostAmt) {
  PdSurf s;
  float streak = pdFbm(vec3(p.x * 2.6, p.y * 0.16, p.z * 2.6), 0.4);
  float blotch = pdFbm(p / 4.0, 4.0);
  float fine = pdFbm(p / 0.14, 0.14);
  vec3 alb = PD_LIN(0.62, 0.63, 0.64) * (0.86 + 0.2 * blotch);
  alb = mix(alb, PD_LIN(0.26, 0.24, 0.22), smoothstep(0.55, 0.9, streak * 0.65 + blotch * 0.3) * 0.55);   // grime runs
  alb = mix(alb, PD_LIN(0.30, 0.22, 0.14), (1.0 - smoothstep(0.0, 1.5, p.y)) * 0.6);                      // ground splash
  // frost on cryogenic tanks: bottom half, fittings, ends
  float below = smoothstep(0.1, 0.9, -nW.y);
  float endp = smoothstep(0.55, 0.85, abs(nW.x));
  float fr = clamp((below * 0.7 + endp * 0.6 + 0.15 * (1.0 - blotch)) * frostAmt * (0.55 + 0.9 * fine), 0.0, 1.0);
  fr = smoothstep(0.25, 0.7, fr);
  alb = mix(alb, PD_LIN(0.78, 0.82, 0.86), fr);
  s.alb = alb;
  s.rough = mix(0.42 + 0.2 * fine, 0.92, fr);
  s.metal = 0.15 * (1.0 - fr);
  s.H = (fine - 0.5) * 0.004 * (1.0 + 3.0 * fr) + fr * 0.006;
  s.frost = fr;
  return s;
}

// OLM deck plate: stainless plate with welded 2.4 m seams, scorch toward the opening, grimy underside
PdSurf pdOlmSteel(vec3 p, vec3 nW) {
  float r = length(p.xz);
  float scorch = smoothstep(14.0, 5.0, r) * smoothstep(14.0, 18.0, p.y);
  float wet = smoothstep(0.7, 1.0, nW.y) * (0.5 + 0.5 * pdFbm(p / 6.0, 6.0));
  PdSurf s = pdStainless(p, nW, scorch, wet);
  // butt-weld seams every 2.4 m (top and underside), tiny raised bead
  vec2 g = abs(fract(p.xz / 2.4 + 0.5) - 0.5) * 2.4;
  float seam = (1.0 - smoothstep(0.012, 0.045 + pdFw * 0.6, min(g.x, g.y))) * step(0.5, abs(nW.y));
  s.alb *= 1.0 - 0.35 * seam;
  s.H += seam * 0.004;
  float under = smoothstep(-0.3, -0.9, nW.y);
  s.alb *= 1.0 - 0.5 * under;
  s.rough = mix(s.rough, 0.7, under);
  return s;
}

// top-house cladding: red paint with 0.2 m trapezoidal corrugation, in the tower-local frame (op)
PdSurf pdTowerClad(vec3 p, vec3 nW, vec3 op) {
  PdSurf s = pdTowerPaint(p, nW);
  float across = abs(op.x) > abs(op.z) ? op.z : op.x;
  float rib = sin(across * PD_TAU / 0.2) * 0.5 + 0.5;
  float f = 1.0 - smoothstep(0.03, 0.12, pdFw / 0.2 * 0.5);
  s.H += (rib - 0.5) * 0.03 * f * step(abs(nW.y), 0.5);
  s.alb *= 1.0 - 0.12 * (1.0 - rib) * f;
  return s;
}

// grey corrugated-panel building (the tower-base annex): 0.25 m ribs aligned with the tower's rotated frame
PdSurf pdAnnex(vec3 p, vec3 nW) {
  PdSurf s;
  const vec2 U = vec2(0.8453, 0.5348), V = vec2(-0.5348, 0.8453);
  float u = dot(p.xz, U), v = dot(p.xz, V);
  float across = abs(dot(nW.xz, U)) > abs(dot(nW.xz, V)) ? v : u;
  float blotch = pdFbm(p / 3.0, 3.0);
  float streak = pdFbm(vec3(p.x * 2.0, p.y * 0.1, p.z * 2.0), 0.5);
  float fine = pdFbm(p / 0.15, 0.15);
  float rib = sin(across * PD_TAU / 0.25) * 0.5 + 0.5;
  float f = 1.0 - smoothstep(0.2, 0.7, pdFw / 0.25);
  vec3 alb = PD_LIN(0.50, 0.49, 0.45) * (0.78 + 0.34 * blotch);
  alb = mix(alb, PD_LIN(0.14, 0.12, 0.10), smoothstep(0.55, 0.85, streak) * 0.5);
  alb = mix(alb, PD_LIN(0.22, 0.10, 0.05), (1.0 - smoothstep(0.0, 1.6, p.y)) * smoothstep(0.5, 0.8, fine) * 0.6);
  alb *= 1.0 - 0.14 * (1.0 - rib) * f * (1.0 - abs(nW.y));
  s.alb = alb;
  s.rough = 0.55 + 0.25 * fine;
  s.metal = 0.25;
  s.H = (rib - 0.5) * 0.035 * f * (1.0 - abs(nW.y)) + (fine - 0.5) * 0.002;
  s.frost = 0.0;
  return s;
}

// ------------------------------------------------------------------------------------------ thermal (kelvin)
// Radiant pre-heating of everything near the plume base (replaces the hook's generic proximity heating, which would
// turn the whole tower white-hot): a few tens of K on the tower, 100-200 K on the deck and columns.
float pdKRad(vec3 p) {
  float d = max(length(p.xz) - 5.0, 0.0);
  float h = mix(1.0, 0.55, smoothstep(-6.0, 40.0, p.y));
  return (40.0 + 140.0 * exp(-d / 12.0)) * exp(-d / 35.0) * h * (0.85 + 0.3 * pdNoise(p * 0.3));
}

// trench concrete: hot near the plume path (x = 0), hottest deep on the floor; ~300 K at the mouths
float pdKTrench(vec3 p) {
  float depth = smoothstep(2.0, -8.0, p.y);
  float a = exp(-abs(p.x) / 15.0);
  float n = 0.85 + 0.3 * pdNoise(p * 0.4);
  return 300.0 + (520.0 * a * (0.4 + 0.6 * depth) + 260.0 * exp(-dot(p.xz, p.xz) / 80.0)) * n;
}
float pdKApron(vec3 p) {
  float r = length(p.xz);
  return 298.0 + 110.0 * exp(-r / 26.0) * (0.8 + 0.4 * pdNoise(p * 0.2));
}
float pdKDiverter(vec3 p) {
  return 880.0 + (560.0 * exp(-abs(p.x) / 6.0) + 240.0 * exp(-p.x * p.x / 1.5)) * (0.85 + 0.3 * pdNoise(p * 0.7));
}
// OLM deck: the rim of the booster opening runs hot, the rest of the deck is water-cooled ambient
float pdKDeck(vec3 p) {
  float r = length(p.xz);
  float rim = smoothstep(12.0, 5.2, r);
  return 296.0 + pdKRad(p) * 0.6 + 880.0 * rim * rim * (0.85 + 0.3 * pdNoise(p * 0.6)) * step(14.0, p.y);
}
float pdKStainless(vec3 p) {
  if (p.y > 1.0) return 294.0 + pdKRad(p) * 0.7;
  float depth = smoothstep(2.0, -8.0, p.y);
  return 300.0 + 480.0 * exp(-abs(p.x) / 14.0) * (0.4 + 0.6 * depth) * (0.85 + 0.3 * pdNoise(p * 0.5));
}
float pdKColumn(vec3 p) { return 296.0 + pdKRad(p) * 0.8 + 90.0 * exp(-length(p.xz) / 18.0) * smoothstep(0.0, 12.0, 20.0 - p.y); }
