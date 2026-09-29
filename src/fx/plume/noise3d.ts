// Tileable 3D noise, baked once on the GPU into a WebGL3DRenderTarget (RGBA8, repeat-wrapped,
// mip-mapped).
// OWNER: plume module. The plume is frozen, so the turbulence is a texture lookup, not ALU noise.
//   R, G : two independent 5-octave gradient-noise fBm fields (period 4 lattice cells per tile),
//          used as a signed domain warp (entrainment eddies).
//   B    : "billow" = 1 − Worley F1 fBm (3 octaves), puffy afterburning lumps.
//   A    : finer 4-octave fBm (period 8), edge breakup and streaks.
// All channels are remapped to roughly fill 0..1 (mean ≈ 0.5).
import * as THREE from 'three';

const VERT = /* glsl */ `
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform float uLayer;
uniform float uSize;

// integer-lattice hash → gradient in [-1,1]^3 (lattice coordinates are wrapped by the caller)
vec3 hash33(vec3 p, float seed) {
  p = fract((p + seed * 17.13) * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
}

// tileable gradient noise (quintic fade); x in lattice units, period in lattice cells
float gnoise(vec3 x, float period, float seed) {
  vec3 i = floor(x), f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n = 0.0;
  float v[8];
  for (int k = 0; k < 8; k++) {
    vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 c = mod(i + o, period);
    v[k] = dot(hash33(c, seed), f - o);
  }
  return mix(mix(mix(v[0], v[1], u.x), mix(v[2], v[3], u.x), u.y),
             mix(mix(v[4], v[5], u.x), mix(v[6], v[7], u.x), u.y), u.z);
}

float fbm(vec3 x, float period, float seed, int oct) {
  float s = 0.0, a = 0.5, norm = 0.0;
  for (int o = 0; o < 6; o++) {
    if (o >= oct) break;
    s += a * gnoise(x, period, seed + float(o) * 7.0);
    norm += a; a *= 0.5; x *= 2.0; period *= 2.0;
  }
  return s / norm;
}

// tileable Worley F1 (distance to the nearest feature point), x in cell units
float worley(vec3 x, float period, float seed) {
  vec3 i = floor(x), f = fract(x);
  float d = 1e9;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int w = -1; w <= 1; w++) {
    vec3 o = vec3(float(w), float(y), float(z));
    vec3 c = mod(i + o, period);
    vec3 fp = o + hash33(c, seed) * 0.5 + 0.5;
    vec3 r = fp - f;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}

void main() {
  vec3 uvw = vec3(vUv, (uLayer + 0.5) / uSize);   // 0..1, tile = 1
  float r = fbm(uvw * 4.0, 4.0, 1.0, 5);
  float g = fbm(uvw * 4.0, 4.0, 11.0, 5);
  float wb = 0.0;
  wb += 0.55 * (1.0 - worley(uvw * 4.0, 4.0, 3.0));
  wb += 0.30 * (1.0 - worley(uvw * 8.0, 8.0, 5.0));
  wb += 0.15 * (1.0 - worley(uvw * 16.0, 16.0, 9.0));
  float a = fbm(uvw * 8.0, 8.0, 23.0, 4);
  // gradient-noise fBm has sigma ~0.18: stretch to use the 8-bit range well
  vec4 o = vec4(r * 1.9 + 0.5, g * 1.9 + 0.5, (wb - 0.35) / 0.55, a * 1.9 + 0.5);
  fragColor = clamp(o, 0.0, 1.0);
}
`;

/** Bake a size³ RGBA8 tileable noise volume. Returns the render target (keep it alive; use .texture). */
export function bakeNoise3D(renderer: THREE.WebGLRenderer, size = 64): THREE.WebGL3DRenderTarget {
  const rt = new THREE.WebGL3DRenderTarget(size, size, size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
    // mip-mapped: the raymarch picks an explicit LOD from the pixel footprint (textureLod), so
    // sub-pixel turbulence is prefiltered instead of sparkling
    generateMipmaps: false,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const tex = rt.texture;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.name = 'plume.noise3d';

  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uLayer: { value: 0 }, uSize: { value: size } },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const prev = renderer.getRenderTarget();
  const prevAuto = renderer.autoClear;
  renderer.autoClear = false;
  for (let z = 0; z < size; z++) {
    // regenerate the mip chain only once, after the last layer (three does it at the end of render())
    tex.generateMipmaps = z === size - 1;
    mat.uniforms.uLayer.value = z;
    renderer.setRenderTarget(rt, z);
    renderer.render(scene, cam);
  }
  tex.generateMipmaps = false;
  renderer.setRenderTarget(prev);
  renderer.autoClear = prevAuto;
  mat.dispose();
  quad.geometry.dispose();
  return rt;
}
