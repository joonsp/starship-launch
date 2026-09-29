// Prepend: common.glsl, atmosphere.glsl (for the sun-disc transmittance).
precision highp float;
varying vec3 vDir;
uniform samplerCube uSky;
uniform vec3  uSunDir;
uniform vec3  uE0;
uniform float uCamAlt;
uniform float uSunDisc;     // 0 = no disc (night), 1 = full
uniform int   uViewMode;

void main() {
  vec3 dir = normalize(vDir);
  vec4 s = texture(uSky, dir);
  vec3 col = s.rgb;
  float mu = dot(dir, uSunDir);
  if (uViewMode == VIEW_PHOTO || uViewMode == VIEW_CLAY) {
    // analytic sun disc (angular radius 0.2654 deg) with limb darkening, tinted by the atmosphere transmittance
    float cosR = 0.9999893;
    if (mu > 0.9995 && uSunDisc > 0.0) {
      vec3 Ts = atm_sunTransmittance(max(uCamAlt, 1.0), uSunDir);
      float r = sqrt(clamp((1.0 - mu) / (1.0 - cosR), 0.0, 4.0));       // 1 at the limb
      float limb = 1.0 - 0.6 * (1.0 - sqrt(max(1.0 - min(r, 1.0) * min(r, 1.0), 0.0)));
      float edge = 1.0 - smoothstep(0.85, 1.12, r);
      float horizonClip = smoothstep(-0.02, 0.01, uSunDir.y);
      col += uE0 * Ts * 0.9 * limb * edge * uSunDisc * horizonClip;
    }
  } else {
    // thermal: cold sky, warmer clouds and a warmer horizon layer
    float k = mix(228.0, 268.0, s.a) + 26.0 * exp(-max(dir.y, 0.0) * 9.0);
    col = sl_thermalRamp(k);
  }
  gl_FragColor = vec4(col, 1.0);
}
