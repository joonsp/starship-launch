// Sky + cirrus + background cumulus baked into one cubemap face (see sky.ts).
// The scene is frozen, so all of this runs once per lighting preset (and once per ~1 km of camera travel).
// Prepend: common.glsl, atmosphere.glsl.
precision highp float;
precision highp sampler3D;

varying vec2 vUv;

uniform int   uFace;
uniform vec3  uBakePos;        // camera position at bake time (world, m)
uniform vec3  uSunDir;         // toward the sun
uniform vec3  uCloudSunDir;    // light direction used for the clouds (sun lifted a little: multiple scattering brightens tops)
uniform vec3  uE0;             // extraterrestrial sun irradiance for the atmosphere (scene units)
uniform float uMsGain;         // multiple-scattering gain
uniform vec3  uSunLight;       // ground-level sun light (colour * intensity) used to light clouds
uniform vec3  uAmbTop;         // cloud ambient radiance from the sky (top)
uniform vec3  uAmbBottom;      // cloud ambient radiance from the ground (bottom)
uniform vec4  uCloud;          // x base, y top (absolute m), z max iterations, w enable
uniform vec4  uCirrus;         // x strength, y altitude (m), z streak angle (rad), w unused
uniform vec4  uWeather;        // x cloud density scale, y cloud coarseness, z haze per metre, w night (stars) strength
uniform vec3  uHorizonTint;    // multiplies the sky near the horizon
uniform vec3  uSkyFloor;       // night-sky glow added to the sky (0 by day)
uniform vec3  uGround;         // radiance of the ground hemisphere (env cube only)
uniform float uBelow;          // 1 = paint the lower hemisphere with uGround (env cube), 0 = clamp to horizon sky
uniform float uDebug;
uniform sampler2D uCover;
uniform sampler3D uNoiseS;
uniform sampler3D uNoiseD;

const float COVER_EXT = 26000.0;

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

// ------------------------------------------------------------------ cirrus: thin fibrous streaks at high altitude
// returns premultiplied colour in rgb and opacity in a
vec4 cirrus(vec3 ro, vec3 rd, vec3 amb) {
  if (uCirrus.x <= 0.0 || rd.y < 0.015) return vec4(0.0);
  float t = (uCirrus.y - ro.y) / rd.y;
  vec2 xz = (ro.xz + rd.xz * t) * 1.0e-3;                 // kilometres
  float c = cos(uCirrus.z), s = sin(uCirrus.z);
  vec2 q = vec2(c * xz.x + s * xz.y, -s * xz.x + c * xz.y);
  // anisotropic: long along x, thin across y
  vec2 uv = vec2(q.x * 0.30, q.y * 0.95);
  float warp = fbm2(uv * 0.55 + 4.0, 4);
  vec2 w = vec2(warp - 0.5, fbm2(uv * 0.7 + 11.0, 4) - 0.5);
  float n = fbm2(uv * vec2(1.0, 1.9) + w * 2.6, 5);
  float veil = fbm2(xz * 0.09 + 21.0, 4);                    // broad cirrostratus veil
  float streak = smoothstep(0.44, 0.85, n);
  // fine fibres
  float fib = fbm2(uv * vec2(1.6, 3.6) + w * 3.4 + 7.7, 3);
  streak *= 0.45 + 0.9 * fib;
  float a = clamp(streak * (0.35 + 0.65 * veil), 0.0, 1.0) * 0.42 * uCirrus.x;
  a *= smoothstep(0.07, 0.30, rd.y);                     // fade near the horizon (foreshortened, aliased)
  float mu = dot(rd, uSunDir);
  vec3 sunN = mix(vec3(sl_luma(uSunLight)), uSunLight, 0.45);
  vec3 lit = sunN * (0.17 + 0.10 * pow(max(mu, 0.0), 3.0)) + amb * 0.95;
  return vec4(lit * a, a);
}

// ------------------------------------------------------------------ cumulus
float cloudCover(vec3 p, out vec4 c) {
  c = textureLod(uCover, p.xz / (2.0 * COVER_EXT) + 0.5, 0.0);
  return c.r;
}

// density 0..1 at a world position; `fine` adds the erosion detail
float cloudDensity(vec3 p, vec4 c, bool fine) {
  float cover = c.r;
  float depth = uCloud.y - uCloud.x;
  float top = max(c.g, 0.05) * depth;
  // the base is not a perfect plane: low-frequency wander of about +-130 m, more for the towering clusters
  float baseOff = (textureLod(uNoiseS, vec3(p.xz * (1.0 / 4300.0), 0.31), 0.0).g - 0.45) * 300.0;
  float h = (p.y - uCloud.x - baseOff) / top;
  if (h <= 0.0 || h >= 1.0) return 0.0;
  float type = c.b;
  // envelope: flat base, fat middle, domed top (taller clusters keep their body higher)
  float prof = smoothstep(0.0, 0.16, h) * (1.0 - smoothstep(0.22 + 0.30 * type, 1.0, h));
  float env = cover * prof;
  vec3 sp = p * (1.0 / 2300.0);
  vec4 ns = textureLod(uNoiseS, sp, 0.0);
  // billows: perlin-worley + worley octaves (mean ~0.5)
  float shape = ns.r * 0.22 + ns.g * 0.34 + ns.b * 0.28 + ns.a * 0.16;
  float B = 2.3 * uWeather.y;
  float f = env * 1.30 + (shape - 0.45) * B - 0.50;
  float d = clamp(f * 1.9, 0.0, 1.0);
  if (fine && d > 0.0) {
    vec3 nd = textureLod(uNoiseD, p * (1.0 / 640.0), 0.0).rgb;
    float det = nd.r * 0.5 + nd.g * 0.32 + nd.b * 0.18;
    d = clamp(d - (det - 0.40) * 1.7 * (1.0 - 0.45 * d), 0.0, 1.0);
  }
  return d;
}

const float CLOUD_SIGMA = 0.028;   // extinction of density 1, per metre

float lightTau(vec3 p, vec4 cin) {
  float tau = 0.0;
  float s = 30.0, acc = 0.0;
  for (int i = 0; i < 6; i++) {
    float mid = acc + s * 0.5;
    vec3 q = p + uCloudSunDir * mid;
    vec4 c;
    float cv = cloudCover(q, c);
    if (cv > 0.02) tau += cloudDensity(q, c, i < 3) * s;
    acc += s; s *= 2.0;
  }
  // forward-scattering droplets barely attenuate the sun: the effective optical depth is (1-g) * tau
  return tau * CLOUD_SIGMA * uWeather.x * 0.11;
}

vec4 marchClouds(vec3 ro, vec3 rd, vec3 skyHaze, float jitter) {
  // returns rgb = radiance (already attenuated by transmittance), a = remaining transmittance
  if (uCloud.w < 0.5 || rd.y < 0.0015) return vec4(0.0, 0.0, 0.0, 1.0);
  float t0 = max((uCloud.x - ro.y) / rd.y, 0.0);
  float t1 = min((uCloud.y - ro.y) / rd.y, 60000.0);
  if (t0 >= t1) return vec4(0.0, 0.0, 0.0, 1.0);
  float mu = dot(rd, uCloudSunDir);
  // three phase lobes (forward, isotropic, back) mean-normalised (times 4 pi) for the Wrenninge octaves
  float phase0 = 4.0 * 3.14159265 * (0.55 * sl_hg(mu, 0.62) + 0.45 * sl_hg(mu, -0.25));
  vec3 L = vec3(0.0);
  float T = 1.0;
  float t = t0 + jitter * clamp(t0 * 0.01, 25.0, 200.0);
  int maxIt = int(uCloud.z);
  // humid-air cream rather than saturated orange: the sun colour is pulled 40% toward grey for the clouds
  vec3 sunE = mix(vec3(sl_luma(uSunLight)), uSunLight, 0.6) / 3.14159265;
  for (int i = 0; i < 400; i++) {
    if (i >= maxIt || t > t1 || T < 0.012) break;
    float dt = clamp(t * 0.0075, 20.0, 160.0);
    vec3 p = ro + rd * t;
    vec4 c;
    float cv = cloudCover(p, c);
    if (cv < 0.02) { t += dt * 3.0; continue; }
    float d = cloudDensity(p, c, true) * uWeather.x;
    if (d < 0.004) { t += dt; continue; }
    float sigma = d * CLOUD_SIGMA;
    float tauL = lightTau(p, c);
    // Wrenninge multiple-scattering octaves
    float ms = 0.0, a = 1.0, b = 1.0, cc = 1.0, norm = 0.0;
    for (int o = 0; o < 3; o++) {
      float ph = mix(1.0, phase0, cc);
      ms += b * exp(-tauL * a) * ph;
      norm += b;
      a *= 0.5; b *= 0.5; cc *= 0.6;
    }
    ms /= norm;
    float hN = clamp((p.y - uCloud.x) / max((uCloud.y - uCloud.x) * c.g, 1.0), 0.0, 1.0);
    // "powder": inner cores are darker than thin edges seen against the sun
    float powder = 1.0 - 0.55 * exp(-d * 2.2);
    vec3 amb = mix(uAmbBottom, uAmbTop, smoothstep(0.0, 0.85, hN));
    // wrap term: multiple scattering lets light leak around towers, so shaded flanks still glow softly
    float wrap = 0.30 * (1.0 - hN * 0.35);
    vec3 S = sunE * (ms + wrap * 0.75) * mix(1.0, powder, 0.35) + amb;
    float hz = 1.0 - exp(-t * uWeather.z);
    S = mix(S, skyHaze, hz);
    float Ts = exp(-sigma * dt);
    L += T * S * (1.0 - Ts);
    T *= Ts;
    t += dt;
  }
  return vec4(L, T);
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
  vec3 viewT;
  vec3 col;
  float cloudAlpha = 0.0;
  if (rd.y >= 0.0 || uBelow < 0.5) {
    vec3 rdA = rd.y >= 0.0 ? rd : normalize(vec3(rd.x, 0.0, rd.z) + vec3(0.0, 1.0e-3, 0.0));
    col = atm_inscatter(camAlt, rdA, uSunDir, uE0, uMsGain, rd.y >= 0.0 ? 36 : 12, viewT);
    col *= mix(vec3(1.0), uHorizonTint, exp(-max(rdA.y, 0.0) * 7.0));
    // ambient amount reaching clouds/cirrus comes from the same sky
    vec3 skyAmb = uAmbTop;
    col += uSkyFloor * (0.25 + 0.75 * exp(-max(rdA.y, 0.0) * 3.0));
    col += stars(rdA) * viewT;
    vec4 ci = cirrus(ro, rdA, skyAmb);
    col = col * (1.0 - ci.a) + ci.rgb;
    float jitter = sl_ign(gl_FragCoord.xy + vec2(float(uFace) * 37.0, 0.0), 0.0);
    vec4 cu = marchClouds(ro, rdA, col, jitter);
    col = col * cu.a + cu.rgb;
    cloudAlpha = clamp(1.0 - cu.a + ci.a * 0.4, 0.0, 1.0);
  } else {
    vec3 rdH = normalize(vec3(rd.x, 0.0, rd.z) + vec3(0.0, 1.0e-3, 0.0));
    vec3 hor = atm_inscatter(camAlt, rdH, uSunDir, uE0, uMsGain, 12, viewT);
    col = mix(hor, uGround, smoothstep(0.0, -0.12, rd.y));
  }
  if (uDebug > 0.5 && rd.y > 0.01) {
    float tt = (uCloud.x + 400.0 - ro.y) / rd.y;
    vec3 pp = ro + rd * tt;
    vec4 cc; float cv = cloudCover(pp, cc);
    if (uDebug < 1.5) col = vec3(textureLod(uNoiseS, pp / 2600.0, 0.0).rgb);
    else if (uDebug < 2.5) col = vec3(cv, cc.g, cc.b);
    else col = vec3(cloudDensity(pp, cc, true));
  }
  gl_FragColor = vec4(col, cloudAlpha);
}
