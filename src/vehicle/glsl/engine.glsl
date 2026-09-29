// Raptor 3 shading. Position is ENGINE-LOCAL (origin on the engine axis at the engine plane, y up).
// VH_EXIT_Y = nozzle exit height in the engine frame (-0.6 sea level, -1.5 RVac).
#ifndef VH_EXIT_Y
#define VH_EXIT_Y -0.6
#endif

// Regen-cooled bell: dark oxidised Inconel/steel, heat-tinted (straw -> blue) rim, sooted inside.
void vhBell(vec3 p, vec3 nObj,
            out vec3 alb, out float rough, out float metal, out float H, out float kelvin) {
  float dy = p.y - VH_EXIT_Y;                                   // height above the exit plane
  float inside = step(dot(normalize(nObj.xz + 1e-6), normalize(p.xz + 1e-6)), -0.05);
  float az = atan(p.z, p.x);
  float s1 = vhNoise(vec3(az * 6.0, p.y * 2.0, 0.5));
  float s2 = mix(0.5, vhNoise(vec3(p.x * 30.0, p.y * 6.0, p.z * 30.0)), vhDetail(0.05));
  vec3 base = vec3(0.075, 0.068, 0.062) * (0.7 + 0.6 * s1);
  // temper colours on the rim: straw close to the exit, blue a little higher, fading out
  float rim = 1.0 - smoothstep(0.0, 0.34, dy);
  vec3 temper = mix(vec3(0.60, 0.46, 0.20), vec3(0.16, 0.21, 0.46), smoothstep(0.02, 0.16, dy));
  base = mix(base, temper * (0.6 + 0.6 * s1), rim * 0.75);
  // radiation-cooled extension (lower part of the RVac) burns darker and rougher
  float t = clamp(dy / 3.0, 0.0, 1.0);
  vec3 soot = vec3(0.020, 0.018, 0.017);
  alb = mix(base, soot, inside * 0.72);
  rough = mix(0.40 + 0.20 * s1 + 0.05 * (s2 - 0.5), 0.72, inside);
  metal = mix(0.9, 0.6, inside);
  H = 0.0004 * (s2 - 0.5);
  kelvin = mix(1350.0, 940.0, smoothstep(0.0, 2.6, -p.y + 1.2 + 0.0)) * mix(1.0, 1.0, inside);
  kelvin = mix(kelvin, 1050.0 + 250.0 * s1, inside);
  kelvin = clamp(kelvin, 900.0, 1400.0);
}

// Chamber, turbopumps, plumbing: bright stainless with heat discolouration; chamber glows in thermal.
void vhEngineSteel(vec3 p, vec3 nObj,
                   out vec3 alb, out float rough, out float metal, out float H, out float kelvin) {
  float n1 = vhFbm(vec3(p.x * 6.0, p.y * 6.0, p.z * 6.0), 0.16);
  float ch = 1.0 - smoothstep(0.86, 1.9, p.y);                  // near the throat / chamber: heat tint
  vec3 steel = vec3(0.55, 0.56, 0.58) * (0.6 + 0.6 * n1);
  steel = mix(steel, vec3(0.30, 0.24, 0.16) * (0.7 + 0.7 * n1), ch * 0.7);
  float grime = smoothstep(0.55, 0.85, vhFbm(vec3(p.x * 3.0, p.y * 3.0, p.z * 3.0), 0.33));
  alb = mix(steel, vec3(0.04), grime * 0.55);
  rough = 0.34 + 0.25 * grime + 0.12 * (n1 - 0.5);
  metal = 0.95 - 0.3 * grime;
  H = 0.0;
  kelvin = mix(430.0, 1150.0, ch) + 60.0 * (n1 - 0.5);
}

// Dark hardware: gimbal actuators, mount flanges, painted booster/ship panels.
void vhDarkMetal(vec3 p, vec3 nObj, out vec3 alb, out float rough, out float metal, out float H, out float kelvin) {
  float n1 = vhFbm(vec3(p.x * 4.0, p.y * 4.0, p.z * 4.0), 0.25);
  alb = vec3(0.035, 0.036, 0.040) * (0.6 + 0.9 * n1);
  rough = 0.45 + 0.25 * n1;
  metal = 0.75;
  H = 0.0;
  kelvin = 300.0;
}
