// Launch-cloud raymarch at reduced resolution (MRT), one jittered full-res pixel per low-res pixel:
//   out0 = (L_inscatter.rgb, T_total)          one sample, for full-res pixel q (see main)
//   out1 = (T_plume, depthRef, tFront, 1)      T_plume = cloud transmittance to the plume distance
//                                              depthRef = opaque view depth of pixel q (m)
// Model (see research/rendering.md section 2):
//   density  = baked puff field (R) eroded by tileable Perlin-Worley + Worley detail noise
//   sun      = baked optical depth -> Wrenninge octaves x dual-lobe Henyey-Greenstein x Beer-powder,
//              + slab-diffusion transmission ~1/(1 + 0.75 (1 - g) tau) (the glow of backlit edges),
//              reddened by a fine aerosol (in the cloud, and in the boundary-layer haze for a low sun)
//   ambient  = blue sky from above + ground bounce (the ground under the cloud is shaded in the bake),
//              via baked hemisphere visibilities, split per sample by the density-gradient normal and
//              occluded by near/mid-field taps; dusty, lower-albedo steam near the ground
//   plume    = baked line-light irradiance (x globals.uPlumeLight) + baked fireball / outflow irradiance
//              (ballistic + diffusion transport), with a directional relief toward the fire
//   emission = blackbody of the temperature channel (fireball / hot gas)
//   integration: Hillaire 2015 energy-conserving  L += T * (S - S*exp(-st*dt)) / st
// Stops at the opaque depth; empty-space skipping via a max-density occupancy volume; R2 + golden-
// ratio jitter; stochastic texture filtering; near-field detailed shadows for the sun and the sky.

uniform highp sampler3D uDensity;
uniform highp sampler3D uOccupancy;
uniform highp sampler3D uShape;
uniform highp sampler3D uDetail;
uniform highp sampler3D uLightA;
uniform highp sampler3D uLightB;
uniform highp sampler2D uDepth;
uniform highp sampler2D uPlume;

uniform mat4 uCamMatrixWorld;
uniform mat4 uProjInv;
uniform vec3 uCamPos;
uniform float uNear;
uniform float uFar;
uniform vec2 uFullRes;
uniform vec2 uLowRes;
uniform vec2 uJitter;
uniform float uFrame;
uniform float uVisit;       // how many times this frame's sub-pixel offset has been traced before
uniform int uSteps;
uniform int uHasDepth;
uniform int uHasPlume;

uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec3 uOccRes;
uniform vec3 uOccCell;     // world size of one occupancy cell (m)
uniform int uFlags;        // debug bits: 1 no empty-space skipping, 2 white-noise jitter,
                           //             8 no near-field sky occlusion, 16 no rim wisps
uniform int uNearShadow;   // near-field sun-shadow samples on the detailed density (0..3)
uniform int uLightDebug;   // 0 all, 1 sun, 2 sky+ground ambient, 3 plume+fire light, 4 emission
uniform float uSigma;
uniform float uAlbedo;
uniform vec3 uPhase;      // g forward, g back, forward weight
uniform vec3 uMs;         // Wrenninge a, b, c
uniform float uPowder;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform vec3 uPlumeLight;
uniform vec3 uFireLight;
uniform vec3 uFireCentre;    // fireball centroid (world m): direction for the near-field fire relief
uniform vec4 uGains;      // sun, ambient, plume, emission
uniform float uSunTauScale;
uniform vec3 uShapeP;     // amount, 1/scale (1/m), -
uniform vec3 uDetailP;    // amount, 1/scale (1/m), crispness
uniform float uNearFade;
uniform int uViewMode;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uDriftOffset;
uniform vec3 uGrowth;      // drift: per-axis billow growth about the mount (1 = frozen)
uniform vec2 uTempRange;  // kelvin at G = 0 and G = 1
// Fine-mode aerosol (dust, soot and salt entrained from the pad, Angstrom-like sigma ~ lambda^-a):
// a small, wavelength-dependent absorption on top of the grey droplet extinction. It acts on the
// LIGHT paths: sunlight that has diffused deep into the cloud comes out amber, rims stay sun-coloured.
uniform vec4 uRedden;     // rgb = extra (chromatic) extinction per unit sun optical depth; w = vertical optical
                          // depth of the same aerosol in the hazy boundary layer at the ground (scale height 250 m)
uniform vec4 uDust;       // rgb = single-scattering albedo tint of the ground-hugging (dusty) steam, w = blend height (m)
uniform float uSkyOcc;    // weight of the near-field (detailed-density) sky occlusion
uniform vec3 uSunDiff;    // diffuse (slab-diffusion) sun transmission: strength, absorption per optical depth;
                          // z = share of the aerosol inside the cloud itself (vs the boundary-layer haze)
uniform vec3 uDilution;   // (y0, y1, factor at y1): the bake's dilution of rising steam with height
uniform float uNormalAmb; // 0..1: how much the density-gradient normal splits the ambient into sky (up) / ground (down)

in vec2 vUv;
layout(location = 0) out vec4 out0;
layout(location = 1) out vec4 out1;

#include <sl_common>

// Stochastic texture filtering (cf. Pharr et al. 2024): per step, the coarse density and light
// lookups are offset by a random sub-texel vector; temporal accumulation then integrates a box
// convolved with trilinear, i.e. a C1 quadratic B-spline. This removes the trilinear "facet" grid
// that low-resolution volumes otherwise show on dense isosurfaces, at no per-frame cost.
vec3 gStoch = vec3(0.0);     // in texels, [-0.5, 0.5)^3
uniform vec3 uDensTexel;     // density texel size in uvw units
uniform vec3 uLightTexel;    // light texel size in uvw units
uniform float uStochAmp;     // stochastic filter width in texels (0 = plain trilinear)

// pcg3d (Jarzynski & Olano 2020): decorrelated 3D random per (pixel, visit, step)
vec3 rand3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return vec3(v) * (1.0 / 4294967295.0);
}

float remap01(float v, float lo) { return clamp((v - lo) / max(1.0 - lo, 1e-4), 0.0, 1.0); }

float linDepth(float d) {
  // perspective depth (0..1) -> positive view-space distance along the camera axis
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

vec2 boxHit(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (uBoxMin - ro) * inv, t1 = (uBoxMin + uBoxSize - ro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

// Coarse (un-eroded) baked density at the last medium() sample: the ambient normal reuses it.
float gBase = 0.0;

// Density (x) and temperature (y) at world point p; t = distance from the camera (near fade).
vec2 medium(vec3 p, float t, out vec3 uvw) {
  // drift: billow growth about the mount (density space) and noise advection (noise space)
  vec3 pd = p / uGrowth;
  uvw = (pd - uBoxMin) / uBoxSize;
  // (the stochastic filter widens with height: the old, mixed tops read as broad lobes instead of the
  //  bead-like cluster of their authoring puffs; the accumulation integrates it into a smooth blur)
  float stochW = mix(uStochAmp, 1.2, smoothstep(140.0, 320.0, p.y));
  vec2 base = texture(uDensity, uvw + gStoch * stochW * uDensTexel).rg;
  gBase = base.r;
  if (base.r < 0.004) return vec2(0.0, base.g);
  // The bake dilutes rising steam with height (finalize.frag.glsl). Erode the UNDILUTED field and dilute
  // afterwards: eroding the thinned field would leave only the Worley cell cores of the high tops (beads).
  float dil = mix(1.0, uDilution.z, smoothstep(uDilution.x, uDilution.y, pd.y));
  base.r = min(base.r / dil, 1.0);
  vec3 pn = p - uDriftOffset;
  // 1. large-scale Perlin-Worley shape erosion (keeps cores, carves the mass boundaries)
  // (noise lookups also get the stochastic sub-texel offset: trilinear facets of the 128^3 / 32^3
  //  noise grids would otherwise print a fine texel-grid grain once `crisp` sharpens the density)
  vec4 s = texture(uShape, pn * uShapeP.y + gStoch * (1.0 / 128.0));
  float shape = s.r * 0.62 + s.g * 0.26 + s.b * 0.12;
  float d = remap01(base.r, (1.0 - shape) * uShapeP.x);
  if (d <= 0.0) return vec2(0.0, base.g);
  // 2. cauliflower erosion: carve along Worley cell boundaries (F1 large) so the surface follows
  //    round cells at 3 scales; wispy (inverse) inside the low ground roll
  vec4 e = texture(uDetail, pn * uDetailP.y + gStoch.zxy * (1.0 / 32.0));
  float ef = e.r * 0.5 + e.g * 0.3 + e.b * 0.2;      // (finer octaves weighted up: small cauliflower bumps)
  float billow = clamp((p.y - 6.0) / 30.0, 0.0, 1.0);
  float det = mix(ef, 1.0 - ef, billow);
  d = remap01(d, det * uDetailP.x);
  // 3. crisp surface: dense steam goes from clear air to opaque within a metre or two
  //    (the old, diluted steam of the high tops has mixed with air: softer, rounder lobes, not beads)
  float crisp = mix(uDetailP.z, max(1.5, uDetailP.z * 0.35), smoothstep(170.0, 380.0, p.y));
  d = clamp(d * crisp, 0.0, 1.0) * dil;
  // 4. rim wisps from a finer octave, only where the density is still thin
  vec4 e2 = texture(uDetail, pn * uDetailP.y * 3.7 + 0.31 + gStoch.yzx * (1.0 / 32.0));
  d = remap01(d, (1.0 - e2.r) * ((uFlags & 16) != 0 ? 0.0 : 0.2) * (1.0 - d));
  d *= smoothstep(0.3, uNearFade, t);
  return vec2(d, base.g);
}

float hg(float c, float g) { return sl_hg(c, g); }

void main() {
  // This low-res pixel shoots ONE ray through an exact full-resolution pixel q of its footprint,
  // chosen by the frame's sub-pixel offset uJitter (0..1 in low-res pixel units). The scatter pass
  // then writes the sample to pixel q of the full-res accumulation, so a still camera converges to
  // a true full-resolution image (crisp billows, exact silhouettes against the tower/vehicle).
  ivec2 lp = ivec2(gl_FragCoord.xy);
  vec2 s = uFullRes / uLowRes;
  ivec2 q = min(ivec2(floor((vec2(lp) + uJitter) * s)), ivec2(uFullRes) - 1);
  vec2 uv = (vec2(q) + 0.5) / uFullRes;
  vec4 vd = uProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 viewDir = normalize(vd.xyz / vd.w);
  vec3 rd = normalize(mat3(uCamMatrixWorld) * viewDir);
  vec3 ro = uCamPos;
  vec3 camFwd = -normalize(uCamMatrixWorld[2].xyz);
  float cosFwd = max(dot(rd, camFwd), 1e-3);

  // ---- opaque stop and plume distance at exactly this pixel
  float depthRef = uHasDepth == 1 ? linDepth(texelFetch(uDepth, q, 0).r) : uFar;
  float plumeDist = -1.0;
  if (uHasPlume == 1) {
    float a = texelFetch(uPlume, q, 0).a;
    plumeDist = a > 0.0 ? a : -1.0;
  }
  float tStop = depthRef >= uFar * 0.999 ? 1e9 : depthRef / cosFwd;

  vec3 L = vec3(0.0);
  float T = 1.0;
  float Tp = -1.0;
  float tFront = -1.0;
  vec2 bh = boxHit(ro, rd);
  float t0 = max(bh.x, 0.0), t1 = min(bh.y, tStop);

  if (t1 > t0) {
    // ---- per-ray constants
    float cosT = dot(rd, uSunDir);
    float ph[4];
    float c = 1.0;
    for (int o = 0; o < 4; o++) {
      ph[o] = mix(hg(cosT, uPhase.y * c), hg(cosT, uPhase.x * c), uPhase.z);
      c *= uMs.z;
    }
    float powderMix = uPowder * clamp(0.5 - 0.5 * cosT, 0.0, 1.0);
    bool clay = uViewMode == VIEW_CLAY;
    bool thermal = uViewMode == VIEW_THERMAL;
    // Ambient: globals.uSkyAmbient / uGroundAmbient are hemisphere RADIANCES (a white Lambert
    // surface under them has that radiance), and a conservative medium lit from all sides tends to
    // the incident radiance (white furnace), so they enter the source term without 1/pi.
    vec3 sunC = uSunColor * uGains.x, skyC = uSkyAmb * uGains.y;
    vec3 gndC = uGroundAmb * uGains.y;
    vec3 plumeC = uPlumeLight * uGains.z * (1.0 / SL_PI), fireC = uFireLight * (1.0 / SL_PI);
    float albedo = uAlbedo;
    if (clay) {
      sunC = vec3(sl_luma(sunC)); skyC = vec3(sl_luma(skyC)); gndC = vec3(sl_luma(gndC));
      plumeC = vec3(sl_luma(plumeC)); fireC = vec3(sl_luma(fireC)); albedo = 0.85;
    }

    // Jitter: R2 low-discrepancy dither on the traced full-res pixel (isotropic, unlike IGN whose
    // x-major structure leaves vertical residual streaks) + a golden-ratio sequence over this
    // pixel's own visits (uVisit): every full-res pixel gets a well-stratified 1D sequence.
    float jit = (uFlags & 2) != 0 ? sl_hash13(vec3(vec2(q), uFrame))
                                  : fract(dot(vec2(q), vec2(0.7548776662, 0.5698402910)) + uVisit * 0.61803398875);
    vec3 cellSize = uOccCell;
    // step length grows with distance (roughly constant screen-space sampling) and with a lower
    // step budget; `shaded` counts only steps that evaluate lighting, skips are nearly free.
    float kStep = 0.0026 * sqrt(128.0 / float(uSteps));
    float t = t0;
    float dt = clamp(0.6 + t0 * kStep, 0.75, 12.0);
    t += dt * jit;
    int shaded = 0;

    for (int i = 0; i < 1024; i++) {
      if (shaded >= uSteps || i >= uSteps * 4 || t >= t1) break;
      vec3 p = ro + rd * t;
      dt = clamp(0.6 + t * kStep, 0.75, 12.0);

      // empty-space skipping: jump to the exit of an empty occupancy cell
      vec3 pd = p / uGrowth;
      ivec3 oc = clamp(ivec3(floor((pd - uBoxMin) / uOccCell)), ivec3(0), ivec3(uOccRes) - 1);
      if ((uFlags & 1) == 0 && texelFetch(uOccupancy, oc, 0).r < 0.004) {
        vec3 cmin = (uBoxMin + vec3(oc) * cellSize) * uGrowth;
        vec3 cmax = cmin + cellSize * uGrowth;
        vec3 inv = 1.0 / rd;
        vec3 ta = (cmin - ro) * inv, tb = (cmax - ro) * inv;
        vec3 tm = max(ta, tb);
        float tExit = min(min(tm.x, tm.y), tm.z);
        // re-anchor at the cell exit with a FULL-period jitter: a partial range (e.g. 0.25..1) biases
        // the integral by the surface's phase relative to the cell planes -> visible moire stripes
        float tn = max(tExit, t) + dt * jit;
        if (plumeDist > 0.0 && Tp < 0.0 && tn > plumeDist) Tp = T;
        t = tn;
        continue;
      }

      vec3 uvw;
      gStoch = rand3(uvec3(uvec2(q), uint(uVisit) * 1024u + uint(i))) - 0.5;
      vec2 m = medium(p, t, uvw);
      vec3 uvwL = uvw + gStoch * uLightTexel;
      float st = m.x * uSigma;
      float stepLen = min(dt, t1 - t);
      if (plumeDist > 0.0 && Tp < 0.0 && t + stepLen > plumeDist) Tp = T * exp(-st * max(plumeDist - t, 0.0));

      if (st > 1e-5) {
        shaded++;
        if (tFront < 0.0 && st > 0.004) tFront = t;
        vec3 S;
        float kelvin = mix(uTempRange.x, uTempRange.y, m.y);
        if (thermal) {
          // false colour: steam ~320-400 K, fireball 1500-2500 K; emission-only look
          vec4 LA = texture(uLightA, uvwL);
          float kSteam = 320.0 + 80.0 * clamp(LA.g * 0.25 + LA.b * 0.1, 0.0, 1.0);
          float kHot = mix(400.0, 2500.0, smoothstep(0.08, 1.0, m.y));
          float kt = mix(kSteam, kHot, smoothstep(0.03, 0.2, m.y));
          S = st * sl_thermalRamp(kt);
        } else {
          vec4 LA = texture(uLightA, uvwL);
          vec3 uq;
          // Sky / ground visibility from a point ~one light texel back toward the viewer: a surface
          // voxel is half inside the cloud, so its own hemisphere rays start blocked; the air just
          // in front of the visible face sees the sky that face actually sees.
          vec3 uvwV = uvwL - rd / uGrowth * (uLightTexel.x * uBoxSize.x * 0.8) / uBoxSize;
          float skyV = texture(uLightA, uvwV).a;
          // Outward normal of the steam from the coarse density gradient (3 taps, one-sided against
          // this sample's own base density). Dense steam scatters like a rough surface: faces that
          // turn up see the sky, faces that turn down see the (darker) ground, and a lump tucked
          // under a bigger billow sees neither. The baked visibility is too coarse (half the density
          // grid) to carry that, so it is split here per sample.
          float b0 = gBase;
          vec3 uvB = uvw;
          vec3 dG = vec3(texture(uDensity, uvB + vec3(uDensTexel.x, 0.0, 0.0)).r,
                         texture(uDensity, uvB + vec3(0.0, uDensTexel.y, 0.0)).r,
                         texture(uDensity, uvB + vec3(0.0, 0.0, uDensTexel.z)).r) - b0;
          vec3 nOut = -dG / (length(dG) + 0.02);                   // ~0 deep inside (no preferred side)
          float nLen = length(nOut);
          vec3 nrm = nLen > 1e-3 ? nOut / nLen : vec3(0.0, 1.0, 0.0);
          float skyF = mix(1.0, (1.0 + nrm.y), uNormalAmb * min(nLen, 1.0));   // 0..2, 1 = no preference
          float gndF = mix(1.0, (1.0 - nrm.y), uNormalAmb * min(nLen, 1.0));
          // near-field occlusion on the DETAILED density, probed outward and upward from the face: the
          // cauliflower lumps shade each other's crevices (stochastic cone: a fixed offset prints streaks)
          vec3 oDir = normalize(nrm * min(nLen, 1.0) + vec3(0.0, 0.8, 0.0));
          float upD = medium(p + oDir * (4.5 + gStoch.y * 3.0) + gStoch.xzy * 4.0, 1e4, uq).x;
          // mid-field: one coarse tap ~16 m out on the base density (a lump under a bigger billow,
          // the base of a bank under its own overhang)
          float upB = texture(uDensity, ((p + oDir * (16.0 + gStoch.x * 6.0) + gStoch.zyx * 6.0) / uGrowth - uBoxMin) / uBoxSize).r;
          float occ = mix(1.0, exp(-upD * uSigma * 7.0) * exp(-upB * uSigma * 8.0), (uFlags & 8) != 0 ? 0.0 : uSkyOcc);
          skyV *= occ * skyF;
          float gv = texture(uLightB, uvwV).r * gndF * mix(1.0, occ, 0.5);
          // sun optical depth: near field marched on the DETAILED density (crisp self-shadowing of
          // the billows, finer than the light grid), far field from the bake beyond that
          float tauN = 0.0, reach = 0.0;
          for (int k = 0; k < 3; k++) {
            if (k >= uNearShadow) break;
            float seg = 3.0 * exp2(float(k));                  // 3, 6, 12 m segments
            tauN += medium(p + uSunDir * (reach + (0.5 + gStoch[k]) * seg), 1e4, uq).x * seg;
            reach += seg;
          }
          float tauFar = reach > 0.0 ? texture(uLightA, ((p + uSunDir * reach) / uGrowth - uBoxMin) / uBoxSize + gStoch * uLightTexel).r : LA.r;
          float tauS = (tauN + tauFar) * uSigma * uSunTauScale;
          // Wrenninge multiple-scattering octaves (sun)
          float sunS = 0.0;
          float a = 1.0, b = 1.0;
          for (int o = 0; o < 4; o++) { sunS += a * ph[o] * exp(-b * tauS); a *= uMs.x; b *= uMs.y; }
          // Diffusion: a thick, high-albedo slab transmits ~1/(1 + 0.75 (1 - g) tau) of the light diffusely
          // (not exp(-tau)); with a weak absorption this is the amber glow of a backlit bank's sun-side
          // edge. Isotropic, and only for light that has been scattered at least once (not on the rim).
          float tauR = tauS / max(uSunTauScale, 1e-3);
          sunS += uSunDiff.x * exp(-uSunDiff.y * tauR) / (1.0 + 0.75 * (1.0 - uPhase.x) * tauR)
                * (1.0 - exp(-0.5 * tauR)) * (0.25 / SL_PI);
          // aerosol reddening along the (multiply scattered) sun path
          // (the low sun also crosses the hazy, salt- and dust-laden boundary layer the launch cloud sits in:
          //  a slant path ~1/sin(elevation) through it, so the effect vanishes for a high sun)
          float tauHaze = uRedden.w * exp(-max(p.y, 0.0) / 250.0) / max(uSunDir.y, 0.08);
          // (the in-cloud reddening path is capped: deep, multiply scattered light turns amber, not red)
          vec3 sunL = sunS * (clay ? vec3(1.0) : exp(-(min(tauS, 2.5) * uSunDiff.z + tauHaze) * uRedden.rgb));
          // Beer-powder: in-scatter probability darkens thin sun-facing rims (not toward the sun)
          float powder = 1.0 - exp(-2.0 * tauS - m.x * uSigma * 12.0);
          sunL *= mix(1.0, powder, powderMix);
          // near-field relief for the (baked, direction-less) fire + plume light: two base-density
          // taps toward the pad / down toward the glowing outflow give the billows form under it
          vec3 fdir = normalize(uFireCentre - p + vec3(0.0, 25.0, 0.0));
          vec3 pf = p / uGrowth;
          float tauF = texture(uDensity, (pf + fdir * 7.0 - uBoxMin) / uBoxSize).r * 8.0
                     + texture(uDensity, (pf + fdir * 20.0 - uBoxMin) / uBoxSize).r * 14.0;
          // (dense billows that turn their face away from the pad keep only a small diffuse share; thin haze
          //  and faces toward the fire get the full baked glow)
          float fireRelief = 0.05 + 0.95 * exp(-tauF * uSigma * 0.3);
          vec3 inS = sunL * sunC + skyC * skyV + gndC * gv + (plumeC * LA.g + fireC * LA.b) * fireRelief;
          if (uLightDebug == 1) inS = sunL * sunC;
          else if (uLightDebug == 2) inS = skyC * skyV + gndC * gv;
          else if (uLightDebug == 3) inS = (plumeC * LA.g + fireC * LA.b) * fireRelief;
          else if (uLightDebug == 4) inS = vec3(0.0);
          else if (uLightDebug == 5) inS = vec3(LA.a);
          else if (uLightDebug == 6) inS = vec3(gv);
          else if (uLightDebug == 7) inS = vec3(exp(-tauS));
          else if (uLightDebug == 8) inS = vec3(skyV, occ, skyF * 0.5);
          else if (uLightDebug == 9) inS = vec3(gv, texture(uLightB, uvwV).r, gndF * 0.5);
          // hot combustion gas is emissive and absorbing (low albedo), not a water-droplet
          // scatterer: without this the fireball scatters its own light and reads white, not orange
          float hot = smoothstep(0.08, 0.35, m.y);
          // ground-hugging steam carries dust and debris from the pad: a warmer, lower albedo near the ground
          vec3 alb = clay ? vec3(albedo) : albedo * mix(uDust.rgb, vec3(1.0), smoothstep(0.0, uDust.w, p.y));
          S = st * alb * (1.0 - 0.9 * hot) * inS;
          if (!clay && (uLightDebug == 0 || uLightDebug == 4)) {
            // blackbody emission of the hot gas (Kirchhoff: thick fireball -> B(T))
            if (hot > 0.0) {
              float k4 = kelvin / 2400.0;   // Stefan-Boltzmann shape: T^4, 2400 K core ~ 8 x gain
              S += st * hot * sl_blackbody(kelvin) * (k4 * k4 * k4 * k4) * 8.0 * uGains.w;
            }
          }
        }
        float Tr = exp(-st * stepLen);
        L += T * (S - S * Tr) / st;
        T *= Tr;
        if (T < 0.004) { T = 0.0; break; }
        t += stepLen;
      } else {
        // inside an occupied cell but eroded to nothing: stride longer
        t += stepLen * 1.5;
      }
    }
    // aerial perspective on the in-scattered light (tiny at these distances, but consistent)
    if (tFront > 0.0 && uViewMode == VIEW_PHOTO) {
      float f = 1.0 - exp(-pow(tFront * uFogDensity, 2.0));
      L = mix(L, uFogColor * (1.0 - T), clamp(f, 0.0, 1.0));
    }
  }
  if (Tp < 0.0) Tp = plumeDist > 0.0 && plumeDist < t0 ? 1.0 : T;
  if (plumeDist < 0.0) Tp = T;

  out0 = vec4(L, T);
  out1 = vec4(Tp, depthRef, tFront, 1.0);
}
