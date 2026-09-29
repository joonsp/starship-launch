// Sky dome (and, with SKY_OVERLAY defined, the below-horizon cumulus layer). See sky.ts SkyDome.
// Prepend: common.glsl, atmosphere.glsl (for the sun-disc transmittance).
precision highp float;
varying vec3 vDir;
uniform samplerCube uSky;       // baked sky at uBakePos: rgb radiance, a = cumulus opacity
uniform samplerCube uSkyDepth;  // distance (km) from uBakePos to the cumulus in each direction, 0 = none (nearest)
uniform samplerCube uSkyClear;  // clear sky with its cirrus, no cumulus (what is behind a cloud)
uniform vec3  uBakePos;         // where the cube was baked (world, m)
uniform vec4  uReproj;          // x = 1: the cube has depth (reprojection on), y/z = altitude range of the cumulus (m)
uniform vec3  uSunDir;
uniform vec3  uE0;
uniform float uCamAlt;
uniform float uSunDisc;     // 0 = no disc (night), 1 = full
uniform int   uViewMode;
uniform mat4  uProj;            // the drawing camera's projection matrix (overlay depth)
uniform vec4  uMoon;            // xyz direction to the moon, w = its strength (night only)

// Cube direction for the dome below the horizon: the horizon row (the terrain and ocean cover it anyway; cumulus below
// the horizon is the overlay's job, drawn at its true depth).
vec3 horizonDir(vec3 d) { return d.y >= 0.002 ? d : normalize(vec3(d.x, 0.0, d.z) + vec3(0.0, 0.002, 0.0)); }

// Is the point at distance t along the camera ray behind the cumulus surface that the bake point sees (by at most a
// cloud's thickness)? q receives the direction from the bake point.
bool behindCloud(vec3 c, vec3 dir, float t, out vec3 q) {
  vec3 v = c + dir * t - uBakePos;
  float r = length(v);
  q = v / max(r, 1.0e-3);
  float D = textureLod(uSkyDepth, q, 0.0).r * 1000.0;
  return D > 0.0 && r >= D && r <= D + max(900.0, 0.3 * t + 300.0);
}

// Reprojection: march the camera ray through the cumulus slab against the cube's depth (like a screen-space ray march
// against a depth buffer, seen from the bake point). xyz = bake-point direction of the first cumulus the ray meets,
// w = 1; w = 0 when it meets none.
vec4 reprojHit(vec3 c, vec3 dir) {
  if (abs(dir.y) < 1.0e-4) return vec4(0.0);
  float tA = (uReproj.y - c.y) / dir.y, tB = (uReproj.z - c.y) / dir.y;
  float t0 = max(min(tA, tB), 20.0), t1 = min(max(tA, tB), 60000.0);
  if (t0 >= t1) return vec4(0.0);
  const int N = 24;
  float k = pow(t1 / t0, 1.0 / float(N));
  float tPrev = t0, t = t0;
  vec3 q;
  for (int i = 0; i <= N; i++) {
    if (behindCloud(c, dir, t, q)) {
      float a = tPrev, b = t;              // refine the entry between the last clear sample and this one
      for (int j = 0; j < 5; j++) {
        float m = 0.5 * (a + b);
        vec3 qm;
        if (behindCloud(c, dir, m, qm)) { b = m; q = qm; } else a = m;
      }
      return vec4(q, 1.0);
    }
    tPrev = t;
    t *= k;
  }
  return vec4(0.0);
}

// Mip level for a cube lookup inside non-uniform control flow (no implicit derivatives there).
float cubeLod(vec3 dir) {
  float px = length(fwidth(dir));                                   // ~radians per pixel
  return max(0.0, log2(px * float(textureSize(uSky, 0).x) * 0.6366));
}

#ifndef SKY_OVERLAY

void main() {
  vec3 dir = normalize(vDir);
  float lod = cubeLod(dir);
  vec4 s;
  vec3 o = cameraPosition - uBakePos;
  if (uReproj.x > 0.5 && dot(o, o) > 0.25 && dir.y > 0.0) {
    vec4 h = reprojHit(cameraPosition, dir);
    if (h.w > 0.5) s = textureLod(uSky, h.xyz, lod);            // the cumulus as the bake point saw it
    else {
      s = textureLod(uSky, dir, lod);
      // this ray meets no cumulus: where the bake point saw one in this direction, show the sky behind it
      if (s.a > 0.004) s = vec4(textureLod(uSkyClear, dir, 0.0).rgb, 0.0);
    }
  } else {
    // a sky cube with depth holds real cumulus below the horizon (the overlay draws them); the environment cube holds
    // its ground hemisphere there
    s = textureLod(uSky, uReproj.x > 0.5 ? horizonDir(dir) : dir, lod);
  }
  vec3 col = s.rgb;
  float mu = dot(dir, uSunDir);
  if (uViewMode == VIEW_PHOTO || uViewMode == VIEW_CLAY) {
    // analytic sun disc (angular radius 0.2654 deg) with limb darkening, tinted by the atmosphere transmittance and
    // hidden behind cumulus
    float cosR = 0.9999893;
    if (mu > 0.9995 && uSunDisc > 0.0) {
      vec3 Ts = atm_sunTransmittance(max(uCamAlt, 1.0), uSunDir);
      float r = sqrt(clamp((1.0 - mu) / (1.0 - cosR), 0.0, 4.0));       // 1 at the limb
      float limb = 1.0 - 0.6 * (1.0 - sqrt(max(1.0 - min(r, 1.0) * min(r, 1.0), 0.0)));
      float edge = 1.0 - smoothstep(0.85, 1.12, r);
      float horizonClip = smoothstep(-0.02, 0.01, uSunDir.y);
      col += uE0 * Ts * 0.9 * limb * edge * uSunDisc * horizonClip * (1.0 - s.a);
    }
    if (uMoon.w > 0.0) {
      // the moon (0.26 deg), a waxing gibbous lit from the east, with a faint aerosol aureole; hidden behind cumulus
      float mm = dot(dir, uMoon.xyz);
      if (mm > 0.999) {
        float r = sqrt(clamp((1.0 - mm) / (1.0 - 0.9999897), 0.0, 16.0));
        vec3 e = normalize(cross(uMoon.xyz, vec3(0.0, 1.0, 0.0)));            // disc-plane axis toward the east-ish
        float x = dot(dir - uMoon.xyz * mm, e) / 0.00454;                     // -1..1 across the disc
        float lit = smoothstep(-0.7, -0.4, -x);                               // the terminator of a gibbous moon
        float disc = 1.0 - smoothstep(0.92, 1.08, r);
        col += vec3(1.0, 0.97, 0.92) * (1.6 * disc * mix(0.04, 1.0, lit) + 0.02 * exp(-r * 0.35)) * uMoon.w * (1.0 - s.a);
      }
    }
  } else {
    // thermal: cold sky, warmer clouds and a warmer horizon layer
    float k = mix(228.0, 268.0, s.a) + 26.0 * exp(-max(dir.y, 0.0) * 9.0);
    col = sl_thermalRamp(k);
  }
  gl_FragColor = vec4(col, 1.0);
}

#else

// Cumulus BELOW the horizon, for a camera inside or above the slab (a high orbit or a drone flight): premultiplied
// cloud radiance blended over the scene at the cloud's own depth, so terrain in front of a cloud hides it and a cloud
// in front of the terrain covers it. The sky cube holds these clouds composited over the horizon sky; the clear-sky
// cube takes that sky back out.
void main() {
  vec3 dir = normalize(vDir);
  float lod = cubeLod(dir);
  if (dir.y >= 0.0) discard;
  vec4 h = reprojHit(cameraPosition, dir);
  if (h.w < 0.5) discard;
  vec4 s = textureLod(uSky, h.xyz, lod);
  if (s.a < 0.004) discard;
  vec3 sky = textureLod(uSkyClear, horizonDir(h.xyz), 0.0).rgb;
  vec3 L = max(s.rgb - sky * (1.0 - s.a), vec3(0.0));
  // depth of the cloud point seen along this ray
  float D = textureLod(uSkyDepth, h.xyz, 0.0).r * 1000.0;
  vec4 clip = uProj * viewMatrix * vec4(uBakePos + h.xyz * D, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 0.999999);
  if (uViewMode != VIEW_PHOTO && uViewMode != VIEW_CLAY) L = sl_thermalRamp(268.0) * s.a;
  gl_FragColor = vec4(L, s.a);
}

#endif
