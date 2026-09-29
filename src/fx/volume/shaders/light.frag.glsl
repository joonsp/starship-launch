// Light bake (the scene is frozen, so all light transport except the view ray is baked).
// Renders one z-layer of a 2-attachment 3D target at half the density resolution:
//   A.r = optical depth toward the sun, in density-metres (render: tau = sigma * A.r; kept raw so
//         the Wrenninge octaves can rescale the extinction per octave)
//   A.g = plume line-light irradiance (unit plume light; multiply by globals.uPlumeLight)
//   A.b = fireball irradiance (unit; multiply by the fire colour * intensity)
//   A.a = sky visibility (multi-scatter weighted transmittance over the upper hemisphere, 0..1)
//   B.r = ground-bounce visibility (same, lower hemisphere), times how much sky + sun that ground point gets
// Point-to-emitter transmittances use Wrenninge's octave sum (a = b = 0.5), which approximates the
// extra light that multiple scattering carries deep into the medium.
uniform highp sampler3D uDensity;
uniform float uLayer;
uniform vec3 uRes;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec3 uSunDir;
uniform float uSigma;
uniform float uBakeScale;      // mean loss of density to render-time erosion (~0.7)
uniform vec3 uPlumeA;
uniform vec3 uPlumeB;
uniform vec4 uFire[16];        // xyz = centre (m), w = radius (m)
uniform float uFireW[16];      // relative power
uniform int uFireN;
uniform int uPlumeN;           // samples along the plume segment
uniform int uSegSteps;         // steps per emitter segment
uniform float uFireTauScale;   // diffusion decay per optical depth for the fire/plume light (~sqrt(3(1-albedo)(1-g)))
layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;

float dens(vec3 p) {
  vec3 uvw = (p - uBoxMin) / uBoxSize;
  if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 0.0;
  return texture(uDensity, uvw).r * uBakeScale;
}
// distance from p along d to the exit of the box (p inside)
float boxExit(vec3 p, vec3 d) {
  vec3 inv = 1.0 / (abs(d) + 1e-6) * sign(d + 1e-9);
  vec3 t1 = (uBoxMin - p) * inv, t2 = (uBoxMin + uBoxSize - p) * inv;
  vec3 tmax = max(t1, t2);
  return max(0.0, min(min(tmax.x, tmax.y), tmax.z));
}
// optical depth (density-metres) along a ray with geometrically growing steps
float tauRay(vec3 p, vec3 d, float maxT, float dt0, int n) {
  float tau = 0.0, t = 0.0, dt = dt0;
  float grow = 1.13;
  for (int i = 0; i < 48; i++) {
    if (i >= n || t >= maxT) break;
    float h = min(dt, maxT - t);
    tau += dens(p + d * (t + 0.5 * h)) * h;
    t += h; dt *= grow;
  }
  return tau;
}
// optical depth along a straight segment a->b (midpoint rule)
float tauSeg(vec3 a, vec3 b) {
  float L = length(b - a);
  if (L < 1e-3) return 0.0;
  float h = L / float(uSegSteps), tau = 0.0;
  for (int i = 0; i < 24; i++) {
    if (i >= uSegSteps) break;
    tau += dens(mix(a, b, (float(i) + 0.5) / float(uSegSteps)));
  }
  return tau * h;
}
float msT(float tau) {
  float s = uSigma * tau;
  return (exp(-s) + 0.5 * exp(-0.5 * s) + 0.25 * exp(-0.25 * s)) / 1.75;
}
// Fire / plume light transport: a ballistic term plus a diffusion term. In a thick, high-albedo,
// forward-scattering medium the diffuse fluence decays per mean free path with
// kd ~ sqrt(3 (1 - albedo)(1 - g)) (~0.1-0.15 for steam), so the orange glow reaches deep into the
// lower billows (the photo's orange lower halves) but, unlike a constant-floor octave sum, it does
// not leak through the whole ground roll onto the faces that turn away from the fire.
float msTfire(float tau) {
  float s = uSigma * tau;
  return (exp(-s) + 1.2 * exp(-uFireTauScale * s)) / 2.2;
}

void main() {
  vec3 uvw = (vec3(gl_FragCoord.xy, uLayer + 0.5)) / uRes;
  uvw.z = (uLayer + 0.5) / uRes.z;
  vec3 p = uBoxMin + uvw * uBoxSize;
  float vox = uBoxSize.x / uRes.x;

  // --- sun
  float sunT = tauRay(p, uSunDir, boxExit(p, uSunDir), vox * 0.6, 44);

  // --- sky hemisphere (zenith + 4 at 40 deg elevation) and ground (nadir + 4 at -35 deg)
  const vec3 SKY[5] = vec3[5](vec3(0.0, 1.0, 0.0), vec3(0.766, 0.643, 0.0), vec3(-0.766, 0.643, 0.0), vec3(0.0, 0.643, 0.766), vec3(0.0, 0.643, -0.766));
  const float SKYW[5] = float[5](0.36, 0.16, 0.16, 0.16, 0.16);
  float sky = 0.0;
  for (int i = 0; i < 5; i++) sky += SKYW[i] * msT(tauRay(p, SKY[i], boxExit(p, SKY[i]), vox, 16));
  const vec3 GND[5] = vec3[5](vec3(0.0, -1.0, 0.0), vec3(0.819, -0.574, 0.0), vec3(-0.819, -0.574, 0.0), vec3(0.0, -0.574, 0.819), vec3(0.0, -0.574, -0.819));
  float gnd = 0.0;
  for (int i = 0; i < 5; i++) {
    float tg = p.y / max(-GND[i].y, 1e-3);
    float te = boxExit(p, GND[i]);
    float tr = msT(tauRay(p, GND[i], min(tg, te), vox, 10));
    // the ground seen in that direction may itself lie under the cloud: it only sends back the sky
    // and sun it receives (no bright bounce under the bank, as in the photo's dark cloud bases)
    if (tg < te && tr > 1e-3) {
      vec3 g = p + GND[i] * tg + vec3(0.0, 0.5, 0.0);
      float gSky = msT(tauRay(g, vec3(0.0, 1.0, 0.0), boxExit(g, vec3(0.0, 1.0, 0.0)), vox, 14));
      float gSun = exp(-uSigma * 0.6 * tauRay(g, uSunDir, boxExit(g, uSunDir), vox, 16));
      tr *= 0.7 * gSky + 0.3 * gSun;
    }
    gnd += SKYW[i] * tr;
  }

  // --- plume line light: N samples on A->B, 1/r^2 each, integrated (dl / pi*r_ref) so that at ~60 m
  //     from the column the total matches common.glsl sl_plumeLineFalloff (along * 1e4 / r^2)
  float Ep = 0.0;
  float segL = length(uPlumeB - uPlumeA);
  float dl = segL / float(uPlumeN);
  for (int k = 0; k < 16; k++) {
    if (k >= uPlumeN) break;
    float s = (float(k) + 0.5) / float(uPlumeN);
    vec3 e = mix(uPlumeA, uPlumeB, s);
    e.y = max(e.y, 2.0);
    float along = mix(1.6, 0.8, s);
    vec3 d = e - p;
    // 20 m softening (vs 6 m for surfaces): steam hugging the column would otherwise get a 1/r^2
    // spike that tone-maps to white instead of the photo's saturated orange
    float r2 = dot(d, d) + 400.0;
    // start the shadow ray 4 m off the jet axis: the jet itself does not attenuate its light
    vec3 e2 = e - normalize(d + 1e-4) * min(4.0, sqrt(r2));
    Ep += along * msTfire(tauSeg(p, e2)) * dl / r2;
  }
  Ep *= 1e4 / 188.0;

  // --- fireball sphere lights (start the shadow ray at 0.7 r from the centre)
  float Ef = 0.0;
  for (int m = 0; m < 16; m++) {
    if (m >= uFireN) break;
    vec3 c = uFire[m].xyz;
    float rf = uFire[m].w;
    vec3 d = c - p;
    float L = length(d);
    float r2 = L * L + 9.0 * rf * rf;   // extended (3 r) source: no white-hot spike in the adjacent steam
    // the shadow ray ends at 1.5 r: the hot gas itself is mostly clear exhaust, not steam
    vec3 e2 = c - d / max(L, 1e-3) * min(1.5 * rf, L);
    Ef += uFireW[m] * msTfire(tauSeg(p, e2)) / r2;
  }
  Ef *= 1e4;

  outA = vec4(sunT, Ep, Ef, sky);
  outB = vec4(gnd, 0.0, 0.0, 1.0);
}
