// Single-scattering atmosphere with an isotropic multiple-scattering approximation ("Hillaire-lite").
// Because the sky is baked into a cubemap once (the scene is frozen), the per-pixel integral is affordable
// and we skip the LUT plumbing of the original paper. Constants follow Hillaire (2020) / Bruneton (2008)
// Earth values, per metre. All positions are relative to the Earth's centre, y up.
//
// Requires: uniforms uAtmo (x = rayleigh scale, y = aerosol scale, z = mie g, w = ozone scale)
//           and common.glsl (sl_hg is not used here; we use Cornette-Shanks).
#ifndef SL_ATMOSPHERE
#define SL_ATMOSPHERE

const float ATM_RE = 6360.0e3;          // ground radius
const float ATM_RA = 6460.0e3;          // top of atmosphere
const float ATM_HR = 8000.0;            // Rayleigh scale height
uniform float uAeroH;         // aerosol scale height (m): a shallow humid marine layer keeps the upper sky clean and saturated
uniform vec2  uAeroPhase;     // x = weight of the sharp forward aureole lobe, y = g of the broad humid-haze lobe
uniform float uFar;           // cap (m) on the view-ray length: the far haze is handled by terrain/ocean fog, and a shorter cap keeps the horizon from glowing
uniform float uWarm;          // 0 = sun transmittance colour ignored for scattering (white haze), 1 = physical
uniform vec3 uBetaR;          // Rayleigh scattering coefficients (per m); art-directed toward a saturated cerulean
#define ATM_BETA_R uBetaR
const vec3  ATM_BETA_M_SCA = vec3(3.996e-6);
const vec3  ATM_BETA_M_EXT = vec3(4.44e-6);
const vec3  ATM_BETA_OZ = vec3(0.650e-6, 1.881e-6, 0.085e-6);

uniform vec4 uAtmo; // x rayleigh scale, y aerosol scale, z mie g, w ozone scale

vec2 atm_raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(-1.0);
  float s = sqrt(d);
  return vec2(-b - s, -b + s);
}

// Optical depth (per-channel extinction integrated) from p toward the sun until the top of the atmosphere.
// Returns a huge value if the ray is blocked by the planet.
vec3 atm_sunTau(vec3 p, vec3 sunDir, int nSteps) {
  vec2 hit = atm_raySphere(p, sunDir, ATM_RA);
  float len = hit.y;
  vec2 g = atm_raySphere(p, sunDir, ATM_RE);
  if (g.x > 0.0) return vec3(1.0e3);
  vec3 tau = vec3(0.0);
  float dt = len / float(nSteps);
  for (int i = 0; i < 12; i++) {
    if (i >= nSteps) break;
    float t = (float(i) + 0.5) * dt;
    float h = max(length(p + sunDir * t) - ATM_RE, 0.0);
    float dR = exp(-h / ATM_HR) * uAtmo.x;
    float dM = exp(-h / uAeroH) * uAtmo.y;
    float dO = max(0.0, 1.0 - abs(h - 25000.0) / 15000.0) * uAtmo.w;
    tau += (ATM_BETA_R * dR + ATM_BETA_M_EXT * dM + ATM_BETA_OZ * dO) * dt;
  }
  return tau;
}

float atm_phaseCS(float mu, float g);
float atm_phaseR(float mu) { return 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu); }
// Cornette-Shanks
float atm_phaseCS(float mu, float g) {
  float g2 = g * g;
  return 3.0 / (8.0 * 3.14159265) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-3), 1.5));
}
// humid coastal aerosol: a sharp forward aureole plus a broad whitening lobe
float atm_phaseM(float mu, float g) { return uAeroPhase.x * atm_phaseCS(mu, g) + (1.0 - uAeroPhase.x) * atm_phaseCS(mu, uAeroPhase.y); }

// In-scattered radiance along the ray (camera at altitude camAlt metres) up to tMax (or the top of the atmosphere).
// E0 = extraterrestrial sun irradiance (linear rgb, arbitrary scene scale). `viewT` receives the view transmittance.
vec3 atm_inscatter(float camAlt, vec3 rd, vec3 sunDir, vec3 E0, float msGain, int nSteps, out vec3 viewT) {
  vec3 ro = vec3(0.0, ATM_RE + camAlt, 0.0);
  vec2 top = atm_raySphere(ro, rd, ATM_RA);
  float tMax = min(top.y, uFar);
  vec2 gr = atm_raySphere(ro, rd, ATM_RE);
  if (gr.x > 0.0) tMax = min(tMax, gr.x);
  float N = float(nSteps);
  float mu = dot(rd, sunDir);
  float pR = atm_phaseR(mu), pM = atm_phaseM(mu, uAtmo.z);
  vec3 L = vec3(0.0);
  vec3 tau = vec3(0.0);
  float tPrev = 0.0;
  for (int i = 0; i < 48; i++) {
    if (i >= nSteps) break;
    float u = (float(i) + 0.5) / N;
    float t = tMax * pow(u, 2.6);                        // dense sampling near the camera
    float tn = tMax * pow((float(i) + 1.0) / N, 2.6);
    float dt = tn - tPrev; tPrev = tn;
    vec3 p = ro + rd * t;
    float h = max(length(p) - ATM_RE, 0.0);
    float dR = exp(-h / ATM_HR) * uAtmo.x;
    float dM = exp(-h / uAeroH) * uAtmo.y;
    float dO = max(0.0, 1.0 - abs(h - 25000.0) / 15000.0) * uAtmo.w;
    vec3 ext = ATM_BETA_R * dR + ATM_BETA_M_EXT * dM + ATM_BETA_OZ * dO;
    vec3 tauStep = ext * dt;
    vec3 Tv = exp(-(tau + 0.5 * tauStep));
    tau += tauStep;
    vec3 sunTau = atm_sunTau(p, sunDir, 6);
    vec3 Ts0 = exp(-sunTau);
    // humid coastal air scatters a much whiter light than a clean atmosphere: pull the sun's reddening toward grey
    vec3 Ts = mix(vec3(dot(Ts0, vec3(0.3333))), Ts0, uWarm);
    vec3 sca = ATM_BETA_R * dR * pR + ATM_BETA_M_SCA * dM * pM;
    // multiple scattering: isotropic, sun transmittance softened (skylight arrives from all directions)
    // skylight is bluish everywhere, so the source of the 2nd+ scattering orders is NOT tinted by the direct-sun
    // transmittance colour (that would turn the horizon yellow); only its overall level follows the sun.
    vec3 Tms = vec3(pow(max(dot(Ts, vec3(0.3333)), 1e-4), 0.55));
    vec3 scaIso = (ATM_BETA_R * dR + ATM_BETA_M_SCA * dM) * (1.0 / (4.0 * 3.14159265)) * msGain;
    L += Tv * (sca * Ts + scaIso * Tms) * E0 * dt;
  }
  viewT = exp(-tau);
  return L;
}

// Transmittance from the camera to the sun (through the whole atmosphere); used for the sun disc.
vec3 atm_sunTransmittance(float camAlt, vec3 sunDir) {
  vec3 ro = vec3(0.0, ATM_RE + camAlt, 0.0);
  return exp(-atm_sunTau(ro, sunDir, 12));
}

#endif
