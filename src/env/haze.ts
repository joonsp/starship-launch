// Aerial perspective for the environment's own lit materials (terrain, roads): fog fades to the SKY at the horizon
// (sampled from the baked sky cube) instead of the flat globals.uFogColor, so the ground never seams against the sky.
// Use with applyGlobals(..., { fog: false }) and inject at the standard anchors.
export const HAZE_DECL = /* glsl */`
uniform samplerCube uHazeCube;      // cloud-free sky (64^2): horizon colour for aerial perspective
`;

/** Requires `float slDist` (distance to the camera) and `float slHazeCap` (1 = full haze, < 1 for water so the sea keeps a dark band) in scope. Place before <opaque_fragment>. */
export const HAZE_APPLY = /* glsl */`
  if (uViewMode != VIEW_THERMAL) {
    vec3 slDirV = normalize(vSlWorldPos - cameraPosition);
    vec3 slHaze = textureLod(uHazeCube, normalize(vec3(slDirV.x, 0.035, slDirV.z)), 1.0).rgb;
    float slFog = 1.0 - exp(-pow(slDist * uFogDensity, 2.0));
    outgoingLight = mix(outgoingLight, slHaze, clamp(slFog * slHazeCap, 0.0, 1.0));
  }
`;
