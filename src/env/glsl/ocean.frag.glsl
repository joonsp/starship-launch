// The Gulf: frozen swell + chop normals, Fresnel reflection (planar near the coast, sky cube far away),
// analytic GGX sun glitter, turbid shallows, surf lines and foam along the beach, horizon haze.
// Prepend: common.glsl, coast.glsl
precision highp float;
varying vec3 vWorld;

uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uSkyAmb;
uniform int   uViewMode;
uniform float uFogDensity;
uniform sampler2D uNoise;
uniform sampler2D uWave;          // tileable wave slope map (RG/BA slopes, see makeWaveSlopes)
#define WAVE_SLOPE_ENC 1.6
uniform sampler2D uReflect;
uniform mat4  uReflMat;
uniform samplerCube uSkyCube;     // full sky incl. clouds
uniform samplerCube uHazeCube;    // cloud-free sky: far-water reflection and haze
uniform vec4  uOcean;      // x reflection available, y wave strength, z haze cap over water, w foam amount
uniform vec3  uBody;       // deep-water body colour (linear)

vec4 nz(vec2 p, float period) { return texture(uNoise, p / period); }

void main() {
  vec2 xz = vWorld.xz;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float sd = slSeaDist(xz);                       // metres seaward of the coastline

  // ---------------------------------------------------------------- frozen waves
  // long-crested swell (elongated along the shore) + chop, from a tileable slope map: smooth, no faceting; the mip chain
  // averages the slopes out with distance so the far sea stays calm instead of shimmering.
  vec4 w1 = nz(xz, 2300.0), w2 = nz(xz, 520.0);
  float shoal = 1.0 + 1.2 * exp(-max(sd, 0.0) / 140.0);
  vec2 slopeEnc = vec2(WAVE_SLOPE_ENC * 0.5);
  vec4 sw1 = texture(uWave, vec2(xz.x / 190.0, xz.y / 620.0) + w1.rg * 0.15);        // swell, ~190 m across the crests
  vec4 sw2 = texture(uWave, vec2(xz.x / 55.0 + 0.37, xz.y / 170.0) + w2.rg * 0.2);
  vec4 ch1 = texture(uWave, vec2(xz.x / 19.0 + 0.11, xz.y / 24.0) + w2.gb * 0.3);
  vec4 ch2 = texture(uWave, vec2(xz.x / 5.3 + 0.61, xz.y / 6.7 + 0.29));
  vec2 g = (sw1.rg - 0.5) / slopeEnc * 0.10 + (sw2.ba - 0.5) / slopeEnc * 0.07
         + ((ch1.rg - 0.5) * 0.9 + (ch1.ba - 0.5) * 0.5) / slopeEnc * 0.10 + ((ch2.rg - 0.5) / slopeEnc) * 0.07;
  g *= shoal;
  float att = uOcean.y * exp(-dist / 4500.0);
  g *= att;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

  // ---------------------------------------------------------------- reflection
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  float NoV = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
  float rough = clamp(0.02 + dist / 9000.0, 0.02, 0.32);
  // rough water reflects higher (bluer, darker) parts of the sky: keeps the far sea a dark teal band under a pale horizon
  vec3 Rr = normalize(R + vec3(0.0, 0.16 * rough / 0.32 + 0.02, 0.0));
  vec3 skyR = mix(textureLod(uSkyCube, Rr, 1.0 + rough * 4.0).rgb, textureLod(uHazeCube, Rr, 1.0).rgb, smoothstep(1500.0, 6000.0, dist));
  vec3 refl = skyR;
  if (uOcean.x > 0.5 && dist < 7000.0) {
    vec4 rc = uReflMat * vec4(vWorld, 1.0);
    vec2 ruv = rc.xy / rc.w + N.xz * 0.9;
    vec3 pr = texture(uReflect, clamp(ruv, 0.002, 0.998)).rgb;
    refl = mix(pr, skyR, smoothstep(500.0, 2800.0, dist));
  }
  // the far sea reads cooler and greyer than the warm sky it mirrors (haze, foam and sediment scatter): tint the reflection
  float coolK = smoothstep(200.0, 2500.0, dist) * 0.75;
  refl = mix(refl, vec3(dot(refl, vec3(0.3, 0.55, 0.15))) * vec3(0.80, 0.98, 1.08), coolK);
  F *= 1.0 - 0.55 * smoothstep(0.02, 0.32, rough);
  // a wind-roughened sea seen at a grazing angle reflects, on average, far less than a flat mirror (Cox-Munk slope spread)
  F *= mix(1.0, 0.20, smoothstep(250.0, 2500.0, dist));

  // ---------------------------------------------------------------- body colour (turbid shallows -> teal deep)
  float depth = clamp(sd * 0.0065, 0.02, 40.0);
  float sunUp = max(uSunDir.y, 0.0);
  vec3 lightBody = uSunColor * (0.10 + 0.9 * clamp(dot(N, uSunDir), 0.0, 1.0)) / 3.14159 + uSkyAmb * 0.55;
  vec3 deep = uBody;
  vec3 shallow = vec3(0.16, 0.19, 0.12);
  float turb = exp(-depth * 0.7);
  vec3 bodyAlbedo = mix(deep, shallow, turb);
  vec3 body = bodyAlbedo * lightBody;

  vec3 col = mix(body, refl, F);

  // ---------------------------------------------------------------- sun glitter (GGX, Cox-Munk-ish slope spread)
  vec3 H = normalize(V + uSunDir);
  float NoH = clamp(dot(N, H), 0.0, 1.0), NoL = clamp(dot(N, uSunDir), 0.0, 1.0);
  float a = clamp(rough * rough * 0.5 + 0.0009 + (1.0 - att / max(uOcean.y, 1e-3)) * 0.0, 0.0006, 0.2);
  float dd = NoH * NoH * (a * a - 1.0) + 1.0;
  float D = a * a / (3.14159 * dd * dd);
  vec3 sunSpec = uSunColor * D * F * NoL / max(4.0 * NoV * max(NoL, 0.02), 0.02) * 0.25;
  col += min(sunSpec, vec3(30.0)) * step(0.0, uSunDir.y);

  // ---------------------------------------------------------------- surf: patchy breaker lines, lacy whitewater, swash
  if (uViewMode == VIEW_PHOTO && uOcean.w > 0.0) {
    float shoreT = max(sd, 0.0);
    float warp = (nz(xz, 61.0).a - 0.5) * 18.0 + (nz(xz, 17.0).g - 0.5) * 6.0;
    float patch1 = smoothstep(0.30, 0.62, nz(xz * vec2(1.0, 0.22), 830.0).b);        // breaking is patchy along the shore
    float patch2 = smoothstep(0.34, 0.66, nz(xz * vec2(1.0, 0.22) + 3.7, 830.0).g);
    float patch3 = smoothstep(0.42, 0.7, nz(xz * vec2(1.0, 0.22) + 8.1, 830.0).r);
    float b1 = exp(-pow((shoreT + warp - 24.0) / 6.5, 2.0)) * patch1;
    float b2 = exp(-pow((shoreT + warp * 1.3 - 58.0) / 8.0, 2.0)) * patch2 * 0.75;
    float b3 = exp(-pow((shoreT + warp * 1.6 - 105.0) / 11.0, 2.0)) * patch3 * 0.5;
    float lace = smoothstep(0.40, 0.72, nz(xz, 7.1).r * 0.55 + nz(xz, 2.3).g * 0.45);
    float swash = smoothstep(10.0, 1.0, shoreT + warp * 0.35) * (0.55 + 0.45 * lace);
    float foam = clamp((b1 + b2 + b3) * (0.30 + 0.70 * lace) * 1.15 + swash * 0.9, 0.0, 1.0) * uOcean.w;
    vec3 foamCol = (uSunColor * (0.35 + 0.65 * sunUp) / 3.14159 + uSkyAmb * 0.9) * 0.75;
    // turbid sediment-laden water behind the breakers
    col = mix(col, col * vec3(1.12, 1.05, 0.9) + vec3(0.012, 0.014, 0.008), smoothstep(60.0, 0.0, shoreT) * 0.5);
    col = mix(col, foamCol, foam);
  }

  // ---------------------------------------------------------------- view modes
  if (uViewMode == VIEW_CLAY) {
    // same recipe as the terrain in clay mode: 0.7 grey lit by the sun and by the (whitened) average sky
    vec3 skyAvg = 0.5 * (textureLod(uHazeCube, vec3(0.0, 1.0, 0.0), 6.0).rgb + textureLod(uHazeCube, normalize(vec3(V.x, 0.15, V.z)), 6.0).rgb);
    skyAvg = vec3(dot(skyAvg, vec3(0.3333))) * 0.6 + skyAvg * 0.4;
    col = vec3(0.7) * (uSunColor * NoL / 3.14159 + skyAvg * 0.9);
  } else if (uViewMode == VIEW_THERMAL) {
    col = sl_thermalRamp(297.0 - 2.0 * smoothstep(0.0, 400.0, sd) + 1.5 * (nz(xz, 300.0).g - 0.5));
  } else {
    // aerial perspective (capped over water so the sea keeps its dark band against the paler sky)
    vec3 dv = -V;
    vec3 haze = textureLod(uHazeCube, normalize(vec3(dv.x, 0.13, dv.z)), 1.0).rgb;
    float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
    col = mix(col, haze, clamp(fog, 0.0, 1.0) * uOcean.z);
  }
  gl_FragColor = vec4(col, 1.0);
}
