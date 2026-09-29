// Rocket plume: 33 methalox jets merging into one column. Raymarched emission volume inside an
// analytic bounding frustum. Output (HalfFloat RGBA target, see contracts.ts frame graph step 2):
//   rgb = premultiplied additive emission (linear HDR)
//   a   = luminance-weighted mean view distance of the emission along the ray (metres), 0 = none.
// Occludes MANUALLY against the opaque scene depth (uSceneDepth).
//
// Local frame: origin at the engine-plane centre, -y along the plume axis, x/z = vehicle frame.
// s = distance below the nozzle-exit plane (= -y - uExitDrop).
precision highp float;
precision highp sampler3D;

in vec3 vLocal;
in vec3 vView;
out vec4 fragColor;

// ── globals (shared uniform objects) ──
uniform float uTime;
uniform float uDrift;
uniform int uViewMode;
uniform float uFrame;

// ── per-frame ──
uniform sampler3D uNoise;
uniform sampler2D uSceneDepth;
uniform float uHasDepth;
uniform float uNear;
uniform float uFar;
uniform vec2 uTargetSize;
uniform float uPixelAngle;     // radians per target pixel (vertical)
uniform vec3 uLocalCam;
uniform float uStepsNear;
uniform float uStepsFar;

// ── geometry (from plume-params.ts) ──
uniform float uExitDrop;       // nozzle exits below the engine plane (m)
uniform float uExitR;          // nozzle exit radius (m)
uniform float uLs;             // shock-cell spacing (m)
uniform float uNeck;           // over-expanded boundary necking amplitude
uniform float uJetSpread;      // jet mixing-layer growth dR/ds
uniform float uCoreLen;        // bright-core e-folding length (m)
uniform float uNearEnd;        // end of the individual-jet near field (m)
uniform float uLen;            // s at the ground impingement point (m)
uniform float uColR0;          // merged-column core radius at s = 0 (m)
uniform float uColSpread;      // its growth dR/ds
uniform float uBoundTopR;      // analytic bounding frustum
uniform float uBoundSpread;
uniform float uBoundH;
uniform vec2 uCentreJets[3];
uniform vec3 uMidRing;         // radius, count, angular offset (rad)
uniform vec3 uOuterRing;

// ── look ──
uniform vec3 uColChemi;
uniform vec3 uColHot;
uniform vec3 uColEnv;
uniform vec3 uColDiamond;
uniform vec3 uColSheathHot;
uniform vec3 uColSheathCool;
uniform vec3 uColBase;
uniform float uIntensity;      // global emission multiplier
uniform float uEnvI;           // near-field jet envelope radiance (per metre)
uniform float uCoreI;          // near-field jet core radiance (per metre)
uniform float uDiamondAmp;     // Mach-diamond knot gain over the (dimmer) expanded core
uniform float uColumnI;        // merged column core radiance (per metre)
uniform float uSheathI;        // afterburning mixing-layer radiance (per metre)
uniform float uBaseI;          // extra brightening toward the ground impingement
uniform vec3 uKelvin;          // thermal view: sheath, core, diamond temperatures (K)

#include <sl_common>

const float TAU = 6.28318530718;

// pixel footprint (m) at the current sample: prefilters sub-pixel jet cores / diamonds far away
float gFoot = 0.0;

float hash1(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }

// Noise lookup with the mip level chosen from the pixel footprint: `tile` is the world size (m)
// of one texture repeat across the flow (64 texels), so sub-pixel turbulence is prefiltered.
vec4 noiseLod(vec3 uvw, float tile) {
  return textureLod(uNoise, uvw, max(0.0, log2(gFoot * 64.0 / tile)));
}
float sq(float x) { return x * x; }

// Frozen by default: the turbulence advects down the axis only in slow-drift mode.
float flowS() { return uTime * uDrift * 9.0; }

// ────────────────────────────────────────────────────────────────── analytic bound
// Frustum: local y in [-H, 0], radius R(y) = R0 - k*y. Returns (t0, t1); empty if t1 <= t0.
vec2 frustum(vec3 ro, vec3 rd) {
  float H = uBoundH, R0 = uBoundTopR, k = uBoundSpread;
  float ta, tb;
  if (abs(rd.y) < 1e-6) {
    if (ro.y > 0.0 || ro.y < -H) return vec2(1.0, 0.0);
    ta = -1e9; tb = 1e9;
  } else {
    float a1 = -ro.y / rd.y, a2 = (-H - ro.y) / rd.y;
    ta = min(a1, a2); tb = max(a1, a2);
  }
  float m = R0 - k * ro.y;
  float a = rd.x * rd.x + rd.z * rd.z - k * k * rd.y * rd.y;
  float b = 2.0 * (ro.x * rd.x + ro.z * rd.z + k * rd.y * m);
  float c = ro.x * ro.x + ro.z * ro.z - m * m;
  float c0 = -1e9, c1 = 1e9;
  if (abs(a) < 1e-8) {
    if (abs(b) < 1e-8) { if (c > 0.0) return vec2(1.0, 0.0); }
    else if (b > 0.0) c1 = -c / b; else c0 = -c / b;
  } else {
    float disc = b * b - 4.0 * a * c;
    if (disc < 0.0) {
      if (a > 0.0) return vec2(1.0, 0.0);
    } else {
      float sd = sqrt(disc);
      float r1 = (-b - sd) / (2.0 * a), r2 = (-b + sd) / (2.0 * a);
      if (r1 > r2) { float tmp = r1; r1 = r2; r2 = tmp; }
      if (a > 0.0) { c0 = r1; c1 = r2; }
      // a < 0: inside = (-inf, r1] U [r2, inf); inside the slab only the lower nappe exists, so
      // exactly one of the two pieces overlaps it (the frustum is convex).
      else if (tb <= r1 || ta < r1) c1 = r1;
      else c0 = r2;
    }
  }
  return vec2(max(ta, c0), min(tb, c1));
}

// ────────────────────────────────────────────────────────────────── near field: one jet
// d = offset from the jet axis (m), s = distance below the exits (m), h = per-engine hash.
// Accumulates emission E (per metre), extinction sig, and the thermal weights.
void addJet(vec2 d, float s, float h, inout vec3 E, inout float sig, inout float heat, inout float kw) {
  // over-expanded jet: necks after the lip, breathes with the shock cells, mixing layer grows
  float Rj = uExitR * (1.0 - uNeck * sin(TAU * s / uLs) * exp(-s / 12.0)) + uJetSpread * (0.85 + 0.3 * h) * s;
  float rho2 = dot(d, d) / (Rj * Rj);
  if (rho2 > 6.0) return;
  // translucent chemiluminescent envelope: super-Gaussian, i.e. a defined shear-layer boundary
  // rather than a soft blob; it softens downstream as the mixing layer thickens
  float sharp = mix(2.6, 1.0, smoothstep(2.0, 18.0, s));
  float env = exp(-2.3 * pow(rho2, sharp));
  float coreFade = exp(-s / uCoreLen);
  float rc = 0.2 + 0.3 * (1.0 - coreFade);            // core widens as it decays
  float fr = gFoot / Rj;                               // footprint relative to the jet radius
  float rcE = sqrt(rc * rc + fr * fr);                 // prefiltered core width (energy preserving)
  float core = exp(-rho2 / (rcE * rcE)) * coreFade * (rc / rcE);
  // Mach diamonds: standing shock cells, rhombi centred on the jet axis at s = (n + 0.55) L_s
  float cph = s / uLs - 0.55 + 0.08 * (h - 0.5);
  float n = floor(cph + 0.5);
  float f = cph - n;                                   // -0.5..0.5 within the cell
  float dm = sqrt(rho2) / 0.55 + abs(f) / 0.26;         // rhombus metric: compact knots
  float cellFade = (n >= 0.0 && n < 5.0) ? exp(-n / 1.7) : 0.0;   // fades over 3-5 cells
  float dia = (1.0 - smoothstep(0.45, 1.0, dm)) * cellFade;
  // unresolvable far away: replace the knot by its cell average (same mean brightness, no aliasing)
  dia = mix(dia, 0.3 * cellFade, smoothstep(0.25, 1.0, fr));
  // first metres after the lip: exit static temperature ~1300 K, only faintly luminous
  float lit = smoothstep(-0.8, 1.6, s);
  float k = 0.86 + 0.28 * h;                           // engine-to-engine variation
  // The expanded potential core is cooler and dimmer; the shock-compressed knots are reheated and
  // bright. uDiamondAmp is the knot gain; the cell-averaged brightness is ~(0.55 + 0.3 * gain).
  // Far away (unresolved) this averages out to the requested 8-15 % axial modulation or less.
  float coreI = core * uCoreI * lit * (0.55 + uDiamondAmp * dia);
  E += k * (uColEnv * (env * uEnvI * (0.3 + 0.7 * lit)) + mix(uColHot, uColDiamond, clamp(dia * 1.5, 0.0, 1.0)) * coreI);
  // the cluster is dense (33 cores project onto every side-view ray): moderate extinction keeps
  // the near-side outer ring dominant, as in close-up footage
  sig += 0.9 * env + 0.6 * core;
  float w = 0.3 * env + core + dia;
  heat += w;
  kw += w * mix(uKelvin.y, uKelvin.z, clamp(dia * 2.0, 0.0, 1.0));
}

// The two nearest engines of one ring (the third is >= 1.5 pitches away: negligible).
void ringJets(vec2 xz, float s, float rr, float ang, vec3 ring, float seed, float reach,
              inout vec3 E, inout float sig, inout float heat, inout float kw) {
  if (abs(rr - ring.x) > reach) return;
  float st = TAU / ring.y;
  float fi = (ang - ring.z) / st;
  float i0 = floor(fi);
  for (int k = 0; k <= 1; k++) {
    float idx = i0 + float(k);
    float a = ring.z + idx * st;
    vec2 c = ring.x * vec2(cos(a), -sin(a));          // engine-layout: x = r cos a, z = -r sin a
    addJet(xz - c, s, hash1(mod(idx, ring.y) + seed), E, sig, heat, kw);
  }
}

void nearField(vec2 xz, float s, inout vec3 E, inout float sig, inout float heat, inout float kw) {
  float fade = 1.0 - smoothstep(8.0, uNearEnd - 1.0, s);
  if (fade <= 0.0) return;
  // the jets start to waver as the shear layers roll up (frozen turbulence)
  float wob = smoothstep(3.0, 20.0, s);
  if (wob > 0.0) {
    vec4 n = noiseLod(vec3(xz.x / 7.0, (s + flowS()) / 17.0, xz.y / 7.0) + vec3(0.61, 0.0, 0.23), 7.0);
    xz += (n.xy - 0.5) * 0.9 * wob;
  }
  vec3 e = vec3(0.0); float sg = 0.0, ht = 0.0, kk = 0.0;
  float reach = 2.2 * (uExitR + uJetSpread * 1.15 * s) + 0.3;
  float rr = length(xz);
  if (rr < length(uCentreJets[0]) + reach) {
    for (int i = 0; i < 3; i++) addJet(xz - uCentreJets[i], s, hash1(float(i) + 71.0), e, sg, ht, kk);
  }
  float ang = atan(-xz.y, xz.x);
  ringJets(xz, s, rr, ang, uMidRing, 3.0, reach, e, sg, ht, kk);
  ringJets(xz, s, rr, ang, uOuterRing, 29.0, reach, e, sg, ht, kk);
  E += e * fade; sig += sg * fade; heat += ht * fade; kw += kk * fade;
}

// ────────────────────────────────────────────────────────────────── far field: merged column
void column(vec2 xz, float s, inout vec3 E, inout float sig, inout float heat, inout float kw) {
  // The cluster envelope builds up as the jets merge. Where the jets are resolvable it starts late
  // (the individual jets carry the look); where they are sub-pixel (far views) it starts early and
  // stands in for their unresolved average, so the top of the column keeps its photo brightness.
  float far = smoothstep(0.12, 0.7, gFoot);
  float ramp = smoothstep(mix(4.0, 0.5, far), mix(20.0, 13.0, far), s);
  float skinOn = smoothstep(3.0, 28.0, s);
  if (ramp <= 0.0 && skinOn <= 0.0) return;                   // just below the exits: jets only
  float g = smoothstep(uLen - 62.0, uLen - 4.0, s);            // stagnation toward the deflector
  float endFade = 1.0 - smoothstep(uLen - 2.5, uLen, s);
  float Rc = (uColR0 + uColSpread * s) * (1.0 + 0.16 * g * g);
  float fs = s + flowS();
  // large eddies: domain warp that grows downstream (entrainment)
  vec4 nL = noiseLod(vec3(xz.x / 34.0, fs / 90.0, xz.y / 34.0), 34.0);
  float A = 0.2 + 0.012 * s;
  vec2 q = xz + (nL.xy - 0.5) * 2.0 * A;
  // flow-aligned detail (strongly stretched along the axis). Each octave is LOD-faded to its mean
  // once its features drop below the pixel footprint, so distant views stay clean, not sparkly.
  // (the lookups are also mip-filtered; the fades keep the fibre contrast mean-preserving)
  float lodD = 1.0 - smoothstep(0.6, 2.2, gFoot);
  float lodF = 1.0 - smoothstep(0.1, 0.4, gFoot);
  vec4 nD = noiseLod(vec3(q.x / 8.0, fs / 100.0, q.y / 8.0) + vec3(0.31, 0.17, 0.53), 8.0);
  float nF = lodF > 0.0 ? noiseLod(vec3(q.x / 2.6, fs / 40.0, q.y / 2.6) + vec3(0.7, 0.4, 0.1), 2.6).w : 0.5;
  float r = length(q) / Rc;
  // core: flat-topped, sharp but ragged edge (the photo's column edge is 1-2 px)
  float edge = 0.9 + 0.24 * (nD.x - 0.5) * (0.4 + 0.6 * lodD);
  float core = 1.0 - smoothstep(edge - 0.2, edge + 0.07, r);
  // Two populations: a dim violet-pink chemiluminescent body, and sparse hot FIBRES (remnant jet
  // cores and shear-layer filaments). Sparse + high contrast so the streaks survive integration
  // over a ~11 m chord, exactly like the white filaments in the photo.
  float fibD = smoothstep(0.5, 0.8, nD.w);
  float fibF = smoothstep(0.4, 0.75, nF);
  float fib = mix(0.3, fibD, lodD) * mix(0.62, 0.25 + 1.25 * fibF, lodF);
  float hotC = exp(-r * r * 2.2);
  vec3 body = uColChemi;
  vec3 hot = mix(uColHot, uColDiamond, 0.35 * hotC);
  float warm = 0.22 * smoothstep(50.0, 140.0, s);               // afterburning products mixed in
  float Ib = uColumnI * 0.14 * core * ramp;
  float If = uColumnI * fib * (0.7 + 0.8 * hotC) * core * ramp;
  // afterburning mixing layer: a lumpy orange skin hugging the core edge
  float th = 0.1 + 0.0014 * s;
  float shell = exp(-sq((r - edge - 0.04) / th));
  float bil = smoothstep(0.3, 0.8, nL.z * 0.5 + nD.z * 0.35 + (nF - 0.5) * 0.35 + 0.075);
  float Is = uSheathI * shell * (0.1 + 1.4 * bil) * skinOn * (0.45 + 0.55 * smoothstep(0.0, 100.0, s));
  vec3 scol = mix(uColSheathCool, uColSheathHot, bil);
  // brighten and yellow toward the ground impingement (feeds the volume module's fireball)
  float gb = 1.0 + uBaseI * g;
  vec3 cc = mix(body * Ib + hot * If, uColBase * (Ib + If), max(warm, 0.7 * g)) * gb;
  Is *= 1.0 + 2.0 * g;
  E += (cc + scol * Is) * endFade;
  sig += (0.075 * core + 0.04 * shell) * ramp;
  float wc = core * ramp * endFade, ws = shell * (0.3 + bil) * endFade;
  heat += wc + 0.5 * ws;
  kw += wc * uKelvin.y + 0.5 * ws * uKelvin.x;
}

// ────────────────────────────────────────────────────────────────── integration
struct Acc { vec3 L; float Tr; float wS; float tS; float heat; float kel; };

void marchSegment(vec3 ro, vec3 rd, float ta, float tb, float n, float jit, bool near, inout Acc acc) {
  if (tb <= ta || n < 1.0) return;
  float dt = (tb - ta) / n;
  for (int i = 0; i < 160; i++) {
    if (float(i) >= n || acc.Tr < 0.01) break;
    float t = ta + (float(i) + jit) * dt;
    vec3 p = ro + rd * t;
    gFoot = t * uPixelAngle;
    float s = -p.y - uExitDrop;
    if (s < 0.0 || s > uLen) continue;
    vec3 E = vec3(0.0); float sig = 0.0, heat = 0.0, kw = 0.0;
    if (near) nearField(p.xz, s, E, sig, heat, kw);
    column(p.xz, s, E, sig, heat, kw);
    // exact for constant emission/extinction within the step
    float a = exp(-sig * dt);
    float w = sig > 1e-5 ? (1.0 - a) / sig : dt;
    vec3 dL = E * (acc.Tr * w);
    acc.L += dL;
    float lum = dot(dL, vec3(0.2126, 0.7152, 0.0722));
    acc.wS += lum; acc.tS += lum * t;
    acc.heat += heat * acc.Tr * w; acc.kel += kw * acc.Tr * w;
    acc.Tr *= a;
  }
}

void main() {
  vec3 ro = uLocalCam;
  vec3 rd = normalize(vLocal - ro);
  vec2 iv = frustum(ro, rd);
  float t0 = max(iv.x, 0.0), t1 = iv.y;

  // manual occlusion against the opaque scene
  if (uHasDepth > 0.5) {
    float d = texture(uSceneDepth, gl_FragCoord.xy / uTargetSize).r;
    if (d < 1.0) {
      float vz = (uNear * uFar) / ((uFar - uNear) * d - uFar);   // view-space z (negative)
      vec3 dv = normalize(vView);
      t1 = min(t1, vz / min(dv.z, -1e-4));
    }
  }
  if (t1 <= t0) { fragColor = vec4(0.0); return; }

  // split the ray into the near field (individual jets, fine steps) and the merged column
  float yN = -(uNearEnd + uExitDrop);
  float nA = t0, nB = t1, fA = t0, fB = t1;
  if (abs(rd.y) < 1e-6) {
    if (ro.y < yN) { nB = nA; } else { fB = fA; }
  } else {
    float tN = (yN - ro.y) / rd.y;
    float tTop = (-uExitDrop - ro.y) / rd.y;
    float lo = min(tN, tTop), hi = max(tN, tTop);
    nA = max(t0, lo); nB = min(t1, hi);
    if (rd.y < 0.0) fA = max(t0, tN); else fB = min(t1, tN);
  }
  // the jets (and the column skin) never reach beyond NEAR_R of the axis in the near field:
  // clip the expensive fine-step segment to that cylinder
  {
    const float NEAR_R = 7.5;
    float a = dot(rd.xz, rd.xz), b = dot(ro.xz, rd.xz), c = dot(ro.xz, ro.xz) - NEAR_R * NEAR_R;
    float disc = b * b - a * c;
    if (a < 1e-8) { if (c > 0.0) nB = nA; }
    else if (disc <= 0.0) nB = nA;
    else { float sd = sqrt(disc); nA = max(nA, (-b - sd) / a); nB = min(nB, (-b + sd) / a); }
  }
  float jit = sl_ign(gl_FragCoord.xy, uDrift > 0.5 ? uFrame : 0.0);
  float fpN = 0.5 * (nA + nB) * uPixelAngle, fpF = 0.5 * (fA + fB) * uPixelAngle;
  float cntN = nB > nA ? clamp(ceil((nB - nA) / max(0.2, 1.3 * fpN)), 4.0, uStepsNear) : 0.0;
  float cntF = fB > fA ? clamp(ceil((fB - fA) / max(0.5, 0.8 * fpF)), 3.0, uStepsFar) : 0.0;

  Acc acc = Acc(vec3(0.0), 1.0, 0.0, 0.0, 0.0, 0.0);
  if (rd.y < 0.0) {        // looking down the axis: near field first
    marchSegment(ro, rd, nA, nB, cntN, jit, true, acc);
    marchSegment(ro, rd, fA, fB, cntF, jit, false, acc);
  } else {
    marchSegment(ro, rd, fA, fB, cntF, jit, false, acc);
    marchSegment(ro, rd, nA, nB, cntN, jit, true, acc);
  }

  if (acc.wS <= 1e-6) { fragColor = vec4(0.0); return; }
  float dist = max(acc.tS / acc.wS, 0.01);

  // flicker only in slow-drift mode
  float flick = 1.0 + uDrift * 0.045 * sin(uTime * 29.0) * sin(uTime * 13.7 + 1.3);
  vec3 col = acc.L * uIntensity * flick;

  if (uViewMode == VIEW_THERMAL) {
    float Tk = acc.kel / max(acc.heat, 1e-5);
    float cover = 1.0 - exp(-acc.heat * 0.45);
    col = sl_thermalRamp(Tk) * cover * 1.8;
  }
  fragColor = vec4(col, dist);
}
