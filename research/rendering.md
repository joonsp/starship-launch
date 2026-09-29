# Rendering recipes for a frozen Starship launch frame (three.js, WebGL2, GLSL ES 3.0)

Provenance tags: **[src url]** = taken from a fetched source. **[est: reason]** = my engineering estimate or recalled literature, not fetched. Literature named without a URL is cited by title/author/venue only; I did not fetch it, so verify before quoting.

Coordinates: metres, origin at the centre of the launch mount, x east, y up, z south (-z north). Colours in this file are display-referred sRGB unless marked "linear".

---------------------------------------------------------------------------------------------------

## 0. Verified toolchain facts (checked 2026-09-29)

| Fact | Value | Source |
|---|---|---|
| Latest three.js on npm | 0.186.1 | [src https://registry.npmjs.org/three/latest] |
| Latest pmndrs `postprocessing` | 6.39.5, peer `three >=0.168.0 <0.187.0` | [src https://registry.npmjs.org/postprocessing/latest] |
| Pin | `three@0.186.x` + `postprocessing@6.39.x` (already at the top of the allowed range, do not go to r187 until the peer range moves) | derived |
| `renderer.setRenderTarget(rt, activeCubeFace, activeMipmapLevel)`; for `WebGLArrayRenderTarget` / `WebGL3DRenderTarget` the 2nd argument is the **z layer** | yes | [src https://archive.threejs.org/docs/api/en/renderers/WebGLRenderer.html via search summary; https://threejs.org/docs/api/en/renderers/WebGL3DRenderTarget.html] |
| `Reflector` options: `color, textureWidth(512), textureHeight(512), clipBias(0), shader, multisample(4)`; default shader uniforms `color, tDiffuse, textureMatrix`; render target via `reflector.getRenderTarget()`; onBeforeRender saves/restores render target, `xr.enabled`, `shadowMap.autoUpdate` | yes | [src https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/jsm/objects/Reflector.js] |
| Example `Water` (`three/addons/objects/Water.js`): options `textureWidth/Height, clipBias, alpha, time, waterNormals, sunDirection, sunColor, waterColor, eye, distortionScale(20), side, fog`; Schlick Fresnel F0 = 0.02; specular exponent 100; WebGLRenderer only (`WaterMesh` for WebGPU) | yes | [src https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/jsm/objects/Water.js] |
| Example `Sky` = Preetham model; uniforms `turbidity 2, rayleigh 1, mieCoefficient 0.005, mieDirectionalG 0.8, sunPosition, cloudScale 0.0002, cloudSpeed, cloudCoverage 0.4, cloudDensity 0.4, cloudElevation 0.5, showSunDisc 1, time` (r186 has a built-in cheap 2D cloud layer) | yes | [src https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/jsm/objects/Sky.js] |
| pmndrs effect names: `BloomEffect, ToneMappingEffect, LUT1DEffect, LUT3DEffect, SMAAEffect, NoiseEffect, VignetteEffect, ChromaticAberrationEffect, TiltShiftEffect, DepthOfFieldEffect, EffectComposer, EffectPass, RenderPass` | yes | [src https://pmndrs.github.io/postprocessing/public/docs/] |
| `ToneMappingEffect` options `{blendFunction, mode (default ToneMappingMode.AGX), resolution 256, whitePoint 4, middleGrey 0.6, minLuminance 0.01, averageLuminance 1, adaptationRate 1}`; modes include AGX, ACES, Reinhard2 variants | yes | [src https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/ToneMappingEffect.js~ToneMappingEffect.html] |
| `TiltShiftEffect` options `{blendFunction, offset 0, rotation 0, focusArea 0.4, feather 0.3, bias 0.06 (deprecated), kernelSize KernelSize.MEDIUM, resolutionScale 0.5, resolutionX, resolutionY}` | yes | [src https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/TiltShiftEffect.js~TiltShiftEffect.html] |
| With pmndrs: keep `renderer.toneMapping = NoToneMapping`, use a high-precision frame buffer, add `ToneMappingEffect` last | yes | [src https://discourse.threejs.org/t/pmndrs-post-processing-tone-mapping-guidance/59374 and docs search summary] |
| Hillaire-2020 sky ports that exist: `@pmndrs/sky` and `SebH-TSL-Sky` are **TSL / WebGPU-first**, not GLSL3 WebGL2. `@takram/three-atmosphere` is a WebGL **precomputed** (Bruneton-style) scattering package, "Beta", WebGPU rewrite promised and announced as API-incompatible | yes | [src https://github.com/pmndrs/sky, https://github.com/DennisSmolek/SebH-TSL-Sky, https://github.com/takram-design-engineering/three-geospatial] |

**Decision:** stay on `WebGLRenderer` (WebGL2). Write our own GLSL3 volumetrics, plume, water and sky LUT. Do not depend on the beta takram packages or the TSL sky. For the sky use either (a) example `Sky` (Preetham) tuned to the photo, cheap and good enough, or (b) a self-written Hillaire LUT set (section 5.2) baked once because the camera altitude is fixed-ish.

---------------------------------------------------------------------------------------------------

## 1. Frozen-scene architecture (what to bake, what to run live)

Nothing moves, so all *lighting* and *shape* is bake-once. Only the camera moves (orbit / skew / first-person). Consequences:

| Asset | Size (est) | Format | Bake time (est) | Re-bake when |
|---|---|---|---|---|
| Noise A: Perlin-Worley (R) + 3 Worley fBm (GBA) | 128^3 | RGBA8 3D RT | <200 ms | never (or seed change) |
| Noise B: Worley fBm x3 octaves | 32^3 | RGBA8 3D RT | <20 ms | never |
| Steam coarse density (R = density 0..1, G = temperature 0..1) | 192 x 48 x 144, domain AABB (-650,0,-500)..(650,320,500), ~6.8 m voxels [est: photo clouds ~500 m wide each side, ~250 m tall] | RG16F 3D RT | CPU splat ~50 ms | puff layout change |
| Sun optical depth tau_sun (integral of normalised density along ray to sun, metres) | 96 x 24 x 72 (half of density) | R16F 3D RT | ~100-300 ms (24 steps/voxel) | puff layout / sun change |
| Plume-light irradiance E(x) (RGB, multiple-scatter octaves, sigma baked in) | 96 x 24 x 72 | RGBA16F 3D RT | ~0.5-1 s (10 emitters x 12 steps) | sigma / emitter change |
| Background cumulus 2D coverage + type map | 1024^2 | RG8 | CPU | never |
| Sky: transmittance LUT 256x64, multi-scatter LUT 32x32, sky-view LUT 192x108 (Hillaire) | small | RGBA16F | <5 ms | sun change |
| Sky PMREM cube for IBL of the vehicle and reflections | 256 cube | via `PMREMGenerator.fromScene` | ~50 ms | sun change |
| Planar reflection RT for pools | 1/2 screen | HDR RT | per camera change | camera moves |
| Volumetric accumulation ping-pong | 1/2 res, RGBA16F + depth | | per frame | camera moves resets N=0 |

Frame graph (per frame, only while camera moving or until N = 64 samples accumulated; after that stop rendering entirely and only repaint on input):
1. Opaque pass: terrain, pools, vehicle, tower, ocean, sky dome -> HDR colour RT (HalfFloat) + `DepthTexture`.
2. Plume additive pass (cylinder proxy raymarch, section 2) -> same HDR RT.
3. Volumetric pass at half res: steam + background cumulus -> RT (rgb premultiplied, a = transmittance, second attachment = hit depth).
4. Temporal accumulate (static camera) -> history RT.
5. Depth-aware upsample + composite over HDR colour -> composite RT.
6. Heat haze (own `EffectPass`), then bloom+tonemap+LUT+grain+vignette+CA (`EffectPass`), then SMAA (own pass), see section 7.

---------------------------------------------------------------------------------------------------

## 2. Volumetric steam / smoke clouds

### 2.1 Theory in five lines (with citations)
- **Beer-Lambert**: T = exp(-integral sigma_t ds). Steam is nearly conservative-scattering: single-scatter albedo ~1.0 [est: water droplets, visible light]. Use albedo 0.98-1.0.
- **Extinction scale** [est]: cumulus 0.02-0.1 /m; launch steam is dense with big droplets and reads opaque over ~15-30 m, so use **sigma_t = 0.06 /m** for density = 1 (optical depth 6 across 100 m). This is the master knob; tune against how much the photo's billows show internal shading.
- **Phase**: dual-lobe Henyey-Greenstein (Henyey & Greenstein 1941): `p = mix(HG(g_back,cos), HG(g_fwd,cos), w)` with g_fwd = +0.6..0.8, g_back = -0.2..-0.5, w = 0.7. Cloud rendering practice: Schneider, "The Real-time Volumetric Cloudscapes of Horizon: Zero Dawn", SIGGRAPH 2015 Advances, and "Nubis" SIGGRAPH 2017 / "Nubis Evolved" 2022.
- **Powder / in-scatter darkening** (Schneider 2015): `beer_powder = exp(-tau) * (1 - exp(-2*tau))` where tau is the *light-ray* optical depth; it darkens sun-facing thin edges. Fade it out toward the sun (silver lining): apply fully when the view ray points away from the sun.
- **Multiple scattering, Wrenninge octaves** (Wrenninge, "Art-directable multiple volumetric scattering", SIGGRAPH 2013 Talks; also Wrenninge, *Production Volume Rendering*, 2012): `L = sum_{i=0}^{N-1} a^i * p(cos*c^i) * exp(-sigma * b^i * tau)`, with a = b = c = 0.5 (N = 3-4). Cheap and gives the bright, soft, translucent-white billows the photo shows even in shade.
- **Energy-conserving step integration** (Hillaire, "Physically Based and Unified Volumetric Rendering in Frostbite", SIGGRAPH 2015 Advances): per step `Sint = (S - S*exp(-sigma_t*dt)) / sigma_t`, `L += T*Sint; T *= exp(-sigma_t*dt)`, where S = sigma_s * lighting. Removes step-size dependence; important with only 48-64 steps.

### 2.2 Tileable 3D noise (GPU bake into `WebGL3DRenderTarget`)

Verified API (see section 0): constructor `new THREE.WebGL3DRenderTarget(width, height, depth, options)`, layer chosen by 2nd arg of `renderer.setRenderTarget`. The result `rt.texture` is a `Data3DTexture`, sampled as `sampler3D`. [src docs above; the option set below is standard `RenderTarget` options, est]

```js
import * as THREE from 'three';

export function makeBaker(renderer) {
  const cam  = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);

  /** Bake `material` (a ShaderMaterial with uniform uZ in 0..1 = layer centre) into every z-slice of `rt`. */
  return function bake(rt, material, onLayer) {
    quad.material = material;
    const D = rt.depth;
    const prevRT = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    for (let z = 0; z < D; z++) {
      material.uniforms.uZ.value = (z + 0.5) / D;
      if (onLayer) onLayer(z);
      renderer.setRenderTarget(rt, z);        // 2nd arg = z layer for WebGL3DRenderTarget; 3rd arg = mip level (0)
      renderer.render(scene, cam);
    }
    renderer.setRenderTarget(prevRT);
    renderer.autoClear = prevAuto;
  };
}

export function make3DRT(w, h, d, { format = THREE.RGBAFormat, type = THREE.UnsignedByteType, repeat = false, filter = THREE.LinearFilter } = {}) {
  const rt = new THREE.WebGL3DRenderTarget(w, h, d, {
    format, type,
    minFilter: filter, magFilter: filter,
    depthBuffer: false, stencilBuffer: false,
    generateMipmaps: false,
  });
  const wrap = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  rt.texture.wrapS = rt.texture.wrapT = rt.texture.wrapR = wrap;
  return rt;
}
```
Notes / pitfalls [est, standard WebGL2 behaviour]:
- Renderable float formats need `EXT_color_buffer_float` (three enables it) and linear filtering of **half** float is core WebGL2; linear filtering of full 32-bit float needs `OES_texture_float_linear`, so use `HalfFloatType` for anything you sample with `LinearFilter`.
- `RedFormat + HalfFloatType` is fine; for two channels `RGFormat`. Prefer RGBA anyway if a driver complains (Mesa/Intel).
- Do not put a `layer` loop inside a single draw (no layered rendering in three); one draw per slice is fine (128 draws).
- Alternative that avoids 3D RTs entirely: render slices into a 2D atlas and `texelFetch` with manual trilinear. Only needed if `setRenderTarget(rt,z)` misbehaves on a target driver.

Bake shader (GLSL ES 3.0, `ShaderMaterial` with `glslVersion: THREE.GLSL3`; three injects `#version 300 es`, precision and `pc_fragColor` for location 0):

```glsl
// ---- vertex ----
out vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
```
```glsl
// ---- fragment: noiseA.frag  (128^3 RGBA8) ----
uniform float uZ;
in vec2 vUv;

// integer hash (Hoskins-style), period-wrapped by caller
vec3 hash33(vec3 c){
  uvec3 q = uvec3(ivec3(c)) * uvec3(1597334673u, 3812015801u, 2798796415u);
  q = (q.x ^ q.y ^ q.z) * uvec3(1597334673u, 3812015801u, 2798796415u);
  return vec3(q) * (1.0 / float(0xffffffffu));
}
// tileable 3D Worley F1, `per` = cells per tile (integer)
float worley(vec3 p, float per){
  vec3 ip = floor(p), fp = fract(p);
  float d = 1e9;
  for (int z=-1; z<=1; z++) for (int y=-1; y<=1; y++) for (int x=-1; x<=1; x++){
    vec3 o = vec3(x,y,z);
    vec3 cell = mod(ip + o + per, per);          // wrap => tileable
    vec3 r = o + hash33(cell) - fp;
    d = min(d, dot(r,r));
  }
  return 1.0 - clamp(sqrt(d), 0.0, 1.0);           // billow-style: 1 at feature points
}
// tileable gradient (Perlin) noise
float perlin(vec3 p, float per){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  float n[8];
  for (int k=0;k<8;k++){
    vec3 o = vec3(k&1, (k>>1)&1, (k>>2)&1);
    vec3 g = normalize(hash33(mod(i + o + per, per)) * 2.0 - 1.0);
    n[k] = dot(g, f - o);
  }
  return mix(mix(mix(n[0],n[1],u.x), mix(n[2],n[3],u.x), u.y),
             mix(mix(n[4],n[5],u.x), mix(n[6],n[7],u.x), u.y), u.z) * 0.5 + 0.5;
}
float remap(float v, float a, float b, float c, float d){ return c + (clamp(v,a,b)-a)/(b-a)*(d-c); }

void main(){
  vec3 uvw = vec3(vUv, uZ);
  float pf = 0.0, a = 0.5, s = 0.0;
  for (int i=0;i<4;i++){ float per = 4.0*exp2(float(i)); pf += a*perlin(uvw*per, per); s += a; a *= 0.5; }
  pf /= s;                                                        // perlin fBm 4 oct
  float w1 = worley(uvw*4.0 , 4.0);
  float w2 = worley(uvw*8.0 , 8.0);
  float w3 = worley(uvw*16.0, 16.0);
  float wfbm = w1*0.625 + w2*0.25 + w3*0.125;
  float pw = remap(pf, 0.0, 1.0, wfbm, 1.0);                      // Schneider's Perlin-Worley
  // G,B,A = Worley at 3 frequencies (cell counts 4/8/16 and next octave 32 for A)
  pc_fragColor = vec4(pw, w1, w2, w3);
}
```
```glsl
// noiseB.frag (32^3): R,G,B = Worley at 2, 4, 8 cells/tile -> use as erosion fBm = dot(rgb, vec3(.625,.25,.125))
```
Parameter values (Schneider 2015 style): sample A at world scale 1/(≈150 m) for billow shape, B at 1/(≈25 m) for erosion; add a third tiny scale 1/6 m for wisps at the billow rim [est].

CPU alternative (worker): same algorithm in JS into a `Uint8Array` and `new THREE.Data3DTexture(data, 128,128,128)` with `format = RGBAFormat`, `minFilter = magFilter = LinearFilter`, `wrapS/T/R = RepeatWrapping`, `unpackAlignment = 1`, `needsUpdate = true`. ~0.5-1 s in a worker for 128^3.

### 2.3 Authoring the density field (hierarchical puffs + erosion)

The photo: two huge asymmetric masses; bases are ground-hugging, flat-bottomed and dark-shaded; tops are dense cauliflowers with 3 visible size tiers (~80-100 m lobes, ~30-40 m sub-billows, ~8-12 m surface bumps) [est from image; scale from ~123 m Starship stack]. Model as a rising, radially-spreading wall jet:

1. **Level 0 (mass)**: 25-40 spheres, radius 60-120 m, centres on a ring/arc around the mount at r = 150-450 m, heights 40-220 m, biased outward and upward with distance (mushroom-like right cloud). Flatten bottoms: clip below y = 8-15 m via smooth ramp.
2. **Level 1**: for each L0 sphere, 8-14 children on its *upper hemisphere shell* (normal.y > -0.2), radius = 0.30-0.45 * parent, centre at parent centre + n * parent_r * 0.8.
3. **Level 2**: for each L1, 6-10 children, radius x0.3-0.4, on outward surface.
4. Density per puff: `d_i = smoothstep(1, 0.55, |p-c|/r)` (soft rim), combine with **smooth-max/sum clamp**: `D = 1 - prod(1 - d_i)` (probabilistic union) which yields creased cauliflower joins.
5. **Erosion at render time** (not baked): shape `d = remap(D, (1-lowNoise)*0.35, 1, 0, 1)`, then `d = remap(d, worleyFbm*0.5, 1, 0, 1)`; near the surface only (Schneider: erosion is applied where density is low, so cores stay solid).
6. Temperature channel G: fireball near (0..30, 5..40, 0..40) plus the plume-adjacent steam core, decaying with distance; used for emission (2.8).

CPU splat (bounding-box scatter, ~50 ms for 3000 puffs):

```js
// dens: Float32Array(W*H*D), box: {min:Vec3, size:Vec3}
function splatPuff(dens, W,H,D, box, c, r){
  const vx = box.size.x/W, vy = box.size.y/H, vz = box.size.z/D;
  const x0 = Math.max(0, Math.floor((c.x-r-box.min.x)/vx)), x1 = Math.min(W-1, Math.ceil((c.x+r-box.min.x)/vx));
  const y0 = Math.max(0, Math.floor((c.y-r-box.min.y)/vy)), y1 = Math.min(H-1, Math.ceil((c.y+r-box.min.y)/vy));
  const z0 = Math.max(0, Math.floor((c.z-r-box.min.z)/vz)), z1 = Math.min(D-1, Math.ceil((c.z+r-box.min.z)/vz));
  for (let z=z0; z<=z1; z++) for (let y=y0; y<=y1; y++) for (let x=x0; x<=x1; x++){
    const px = box.min.x + (x+.5)*vx, py = box.min.y + (y+.5)*vy, pz = box.min.z + (z+.5)*vz;
    const q = Math.hypot(px-c.x, py-c.y, pz-c.z)/r; if (q>=1) continue;
    const t = Math.min(1, Math.max(0, (1-q)/0.45)); const d = t*t*(3-2*t);
    const i = x + W*(y + H*z);
    dens[i] = 1 - (1-dens[i])*(1-d);                 // probabilistic union
  }
}
```
Upload: `Data3DTexture(RG16F or Float32 -> convert to Uint16 half)`; simplest is `Float32Array` with `type = FloatType`, `RedFormat`, and set `minFilter = LinearFilter` only if `OES_texture_float_linear` exists (`renderer.extensions.has('OES_texture_float_linear')`), otherwise convert to half with `THREE.DataUtils.toHalfFloat`.

### 2.4 Density lookup in the marcher

```glsl
uniform sampler3D uDensity;      // coarse puff field (R density, G temperature)
uniform sampler3D uNoiseA;       // 128^3 perlin-worley + worley
uniform sampler3D uNoiseB;       // 32^3 worley erosion
uniform vec3  uBoxMin, uBoxSize;
uniform float uSigma;            // 0.06 /m
uniform vec3  uNoiseScale;       // x: 1/150, y: 1/25, z: 1/6   (per metre)

float remap(float v,float a,float b,float c,float d){ return c+(clamp((v-a)/(b-a),0.,1.))*(d-c); }

// returns normalised density 0..1 (multiply by uSigma for extinction) and temperature
vec2 sampleMedium(vec3 p, bool detail){
  vec3 uvw = (p - uBoxMin) / uBoxSize;
  if (any(lessThan(uvw, vec3(0.))) || any(greaterThan(uvw, vec3(1.)))) return vec2(0.);
  vec2 base = texture(uDensity, uvw).rg;
  if (base.x <= 0.002) return vec2(0., base.y);
  float d = base.x;
  vec4 nA = texture(uNoiseA, p * uNoiseScale.x);
  d = remap(d, (1.0 - nA.r) * 0.30, 1.0, 0.0, 1.0);                  // billow shape
  if (detail && d > 0.0){
    vec3 nB = texture(uNoiseB, p * uNoiseScale.y).rgb;
    float wf = dot(nB, vec3(0.625, 0.25, 0.125));
    d = remap(d, wf * 0.55, 1.0, 0.0, 1.0);                          // cauliflower erosion
    vec3 nC = texture(uNoiseB, p * uNoiseScale.z + 0.37).rgb;        // rim wisps
    d = remap(d, dot(nC, vec3(.5,.3,.2)) * 0.25, 1.0, 0.0, 1.0);
  }
  return vec2(d, base.y);
}
```
Do not read `detail` noise in the sun/plume bakes (coarse only) but do use `uNoiseA` so shadows match billow silhouettes.

### 2.5 Baking the sun-transmittance 3D texture (optical depth toward the sun)

```glsl
// sunTau.frag  -> R16F, stores integral of normalised density along the sun ray, in metres
uniform float uZ; in vec2 vUv;
uniform vec3 uSunDir;                      // direction TO the sun, world space
uniform vec3 uBoxMin, uBoxSize;
// + uDensity, uNoiseA and sampleMedium() from 2.4
void main(){
  vec3 uvw = vec3(vUv, uZ);
  vec3 p = uBoxMin + uvw * uBoxSize;
  float tau = 0., t = 0.;
  float dt = 6.0;                          // metres; growing step below
  for (int i = 0; i < 24; i++){
    t += dt;                               // march outward with growing dt
    vec3 q = p + uSunDir * t;
    tau += sampleMedium(q, false).x * dt;
    dt *= 1.18;                            // cone-like growth; 24 steps reach ~ 6*(1.18^24-1)/0.18 ≈ 1.6 km
  }
  pc_fragColor = vec4(tau, 0., 0., 1.);
}
```
At render: `T_sun = exp(-uSigma * tau)`; multiple-scatter octaves reuse the same tau (2.1). Sun elevation is low (long golden shadows) so use the growing step: rays are long. For accuracy multiply by `1/max(uSunDir.y, 0.1)` only if the box is clipped vertically; it is not here. Also add the **ground-shadow term**: none, terrain is far below the steam.

### 2.6 Baking the plume-light (point/line-light) transmittance 3D texture

Emitters (est, coordinates in our frame): fireball on the flame deflector `(0, 10..25, 0)` strong warm-yellow; column samples along the axis from the vehicle base down to the deflector (say 8 points spaced 15-20 m, decreasing intensity upward because only the near-field plume is bright). Line light approximated by N point emitters.

```glsl
// plumeE.frag  -> RGBA16F
uniform float uZ; in vec2 vUv;
uniform vec3 uBoxMin, uBoxSize;
uniform vec4 uEmit[12];        // xyz = position (m), w = intensity (arbitrary radiometric)
uniform vec3 uEmitCol[12];     // linear RGB from blackbody/palette (section 2.8)
uniform int  uN;
uniform float uSigma;

float tauBetween(vec3 a, vec3 b){                // coarse optical depth, 12 steps
  float L = length(b - a), dt = L / 12.0, tau = 0.;
  for (int i = 0; i < 12; i++) tau += sampleMedium(mix(a, b, (float(i)+0.5)/12.0), false).x * dt;
  return tau;
}
void main(){
  vec3 p = uBoxMin + vec3(vUv, uZ) * uBoxSize;
  vec3 E = vec3(0.);
  for (int k = 0; k < 12; k++){
    if (k >= uN) break;
    vec3 e = uEmit[k].xyz;
    vec3 d = e - p; float r2 = dot(d,d) + 25.0;         // +25 m^2 softening: emitter is a 5 m blob, avoids singularity
    float tau = tauBetween(p, e) * uSigma;
    // Wrenninge multi-scatter octaves inside the medium (a=b=0.5)
    float ms = 0., a = 1., b = 1.;
    for (int o = 0; o < 3; o++){ ms += a * exp(-tau * b); a *= 0.5; b *= 0.5; }
    E += uEmitCol[k] * uEmit[k].w * ms / r2;
  }
  pc_fragColor = vec4(E, 1.);
}
```
Runtime use: `plumeLight = texture(uPlumeE, uvw).rgb * albedo * (1/(4*PI)) * plumeScale` (isotropic phase; forward scattering of near-field is smeared by multiple scattering). Because sigma is baked into the plume bake, re-bake when `uSigma` changes (<1 s).

### 2.7 Main raymarch (half-res, blue-noise jitter, depth stop, dual-lobe HG, Beer-powder, multi-scatter)

```glsl
// volume.frag  (ShaderMaterial, glslVersion GLSL3, full-screen quad, renders to half-res MRT)
layout(location = 1) out highp vec4 outDepth;          // 1 attachment beyond pc_fragColor (rt.count = 2)

uniform sampler2D uSceneDepth;      // main-pass depth texture (full res, sampled with texelFetch at 2x coords or min of 2x2)
uniform sampler2D uBlue;            // 64x64 blue noise (R8), RepeatWrapping, NearestFilter
uniform sampler3D uSunTau, uPlumeE;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos, uSunDir, uSunColor;      // sunColor: linear, warm, ~ (1.0,0.72,0.45)*sunIntensity
uniform vec3 uAmbLow, uAmbHigh;                // linear; low = ground bounce (warm, dark), high = blue sky
uniform float uFrame, uSigma, uAlbedo, uPlumeScale, uEmitScale;
uniform vec2 uRes;                             // half-res size
in vec2 vUv;

const int STEPS = 56;
const float PI = 3.14159265;

float HG(float c, float g){ float g2 = g*g; return (1.-g2) / (4.*PI*pow(1.+g2-2.*g*c, 1.5)); }
float dualHG(float c, float k){ return mix(HG(c, -0.35*k), HG(c, 0.65*k), 0.7); }   // k<=1 flattens lobes per octave (c-term)

vec2 boxHit(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax){
  vec3 inv = 1.0/rd, t0 = (bmin-ro)*inv, t1 = (bmax-ro)*inv;
  vec3 tmin = min(t0,t1), tmax = max(t0,t1);
  return vec2(max(max(tmin.x,tmin.y),tmin.z), min(min(tmax.x,tmax.y),tmax.z));
}
vec3 worldFromDepth(vec2 uv, float z){          // z = depth buffer value 0..1
  vec4 ndc = vec4(uv*2.-1., z*2.-1., 1.); vec4 w = uInvViewProj * ndc; return w.xyz / w.w;
}

void main(){
  vec2 uv = vUv;
  vec3 farP = worldFromDepth(uv, 1.0);
  vec3 rd = normalize(farP - uCamPos), ro = uCamPos;

  // --- opaque stop: min depth over the 2x2 full-res footprint (conservative) ---
  ivec2 fc = ivec2(gl_FragCoord.xy) * 2;
  float z = min(min(texelFetch(uSceneDepth, fc, 0).r, texelFetch(uSceneDepth, fc+ivec2(1,0), 0).r),
                min(texelFetch(uSceneDepth, fc+ivec2(0,1), 0).r, texelFetch(uSceneDepth, fc+ivec2(1,1), 0).r));
  float tScene = (z >= 1.0) ? 1e9 : length(worldFromDepth(uv, z) - ro);

  vec2 h = boxHit(ro, rd, uBoxMin, uBoxMin + uBoxSize);
  float t0 = max(h.x, 0.0), t1 = min(h.y, tScene);
  if (t1 <= t0){ pc_fragColor = vec4(0,0,0,1); outDepth = vec4(1e9); return; }

  // blue noise jitter with golden-ratio temporal shift (R1 sequence): decorrelates across accumulated frames
  float jit = fract(texelFetch(uBlue, ivec2(gl_FragCoord.xy) & 63, 0).r + uFrame * 0.61803398875);

  float dt = (t1 - t0) / float(STEPS);           // ~10-20 m; use min(dt, 25.) with more steps if quality is poor
  float t = t0 + dt * jit;
  float cosT = dot(rd, uSunDir);
  vec3  L = vec3(0.); float T = 1.0; float tHit = -1.0;

  for (int i = 0; i < STEPS; i++, t += dt){
    vec3 p = ro + rd * t;
    vec2 m = sampleMedium(p, true);                          // x density, y temperature
    float sig = m.x * uSigma;
    if (sig < 1e-4 && m.y < 0.01) continue;
    if (tHit < 0.0 && sig > 0.02) tHit = t;                  // first substantial hit for depth-aware upsample

    vec3 uvw = (p - uBoxMin) / uBoxSize;
    float tau = texture(uSunTau, uvw).r * uSigma;

    // Wrenninge octaves for the sun
    vec3 Ssun = vec3(0.); float a=1., b=1., c=1.;
    for (int o = 0; o < 3; o++){
      Ssun += a * exp(-tau*b) * dualHG(cosT*c, 1.0) ;
      a*=0.5; b*=0.5; c*=0.5;
    }
    // powder: darken thin sun-facing edges, fade toward the sun (silver lining)
    float powder = 1.0 - exp(-2.0 * tau);
    Ssun *= mix(1.0, 2.0 * powder, 0.6 * (1.0 - smoothstep(-0.2, 0.8, cosT)));
    Ssun *= uSunColor;

    // ambient: sky above, warm bounce below; darker deep inside (cheap AO from density)
    float hgt = clamp(p.y / uBoxSize.y, 0.0, 1.0);
    vec3 amb = mix(uAmbLow, uAmbHigh, hgt) * exp(-0.35 * m.x * 3.0) ;

    vec3 plume = texture(uPlumeE, uvw).rgb * uPlumeScale;

    // hot gas emission (blackbody ramp, section 2.8) -- optically thin add
    vec3 emis = blackbody(mix(700.0, 2600.0, m.y)) * (m.y * m.y) * uEmitScale;

    vec3 S = sig * uAlbedo * (Ssun + amb + plume);            // scattering source
    float Ts = exp(-sig * dt);
    vec3 Sint = (S - S * Ts) / max(sig, 1e-5);
    L += T * (Sint + emis * dt * (1.0 - Ts * 0.0));           // emission does not attenuate itself here
    T *= Ts;
    if (T < 0.01) break;
  }
  pc_fragColor = vec4(L, T);                                   // premultiplied radiance + transmittance
  outDepth = vec4(tHit < 0.0 ? 1e9 : tHit, 0., 0., 1.);
}
```
Composite: `final = L + T * sceneColor`.

Performance targets [est]: 56 steps x half-res at 1080p = 1M pixels x 56 = 56M density evals, each 3 texture fetches: fine on a laptop iGPU at ~10-20 fps, so a static frame converges in seconds; **64 accumulated frames = effectively 3600 steps per pixel** and clean.

### 2.8 Emission from hot gas: blackbody ramp
Preferred: bake a 256x1 LUT from CIE via the analytic Planckian-locus approximation (Kim et al. 2002 as listed on Wikipedia "Planckian locus"; constants below were recalled, verify against https://en.wikipedia.org/wiki/Planckian_locus):

```js
// JS: build RGB LUT for T in [500,12000] K, normalise max-channel = 1, output linear sRGB
function planckXY(T){
  const x = T<=4000 ? -0.2661239e9/T**3 - 0.2343589e6/T**2 + 0.8776956e3/T + 0.179910
                    : -3.0258469e9/T**3 + 2.1070379e6/T**2 + 0.2226347e3/T + 0.240390;
  const y = T<2222 ? -1.1063814*x**3 - 1.34811020*x**2 + 2.18555832*x - 0.20219683
          : T<4000 ? -0.9549476*x**3 - 1.37418593*x**2 + 2.09137015*x - 0.16748867
                   :  3.0817580*x**3 - 5.87338670*x**2 + 3.75112997*x - 0.37001483;
  const Y = 1, X = x*Y/y, Z = (1-x-y)*Y/y;
  let r =  3.2406*X - 1.5372*Y - 0.4986*Z, g = -0.9689*X + 1.8758*Y + 0.0415*Z, b = 0.0557*X - 0.2040*Y + 1.0570*Z;
  const m = Math.max(r,g,b,1e-6); return [Math.max(r/m,0), Math.max(g/m,0), Math.max(b/m,0)];
}
```
Radiance scale: multiply by `(T/2600)^4`-ish (Stefan-Boltzmann shape) so cold gas darkens: `blackbody(T)` in GLSL = `texture(uBB, (T-500)/11500).rgb * pow(T/2600.0, 4.0)`. Below ~1000 K return ~0 (dark red only). For the photo the fireball reads yellow-white (251,247,163) core to orange (245,150,14): T_colour ~ 2000-2600 K, consistent with **est** soot/afterburning incandescence in the near-pad fireball, not the sootless methalox core.

### 2.9 Half-res, depth-aware upsampling, temporal accumulation (static scene)

Upsample (joint bilateral, Kopf et al. 2007 idea; here min-depth compare):
```glsl
// composite.frag
uniform sampler2D uVol, uVolDepth, uSceneColor, uSceneDepthFull;  // uVol half-res
uniform vec2 uHalfRes; uniform mat4 uInvViewProj; uniform vec3 uCamPos;
vec4 upsample(vec2 uv, float fullDist){
  vec2 st = uv * uHalfRes - 0.5; ivec2 i0 = ivec2(floor(st)); vec2 f = fract(st);
  vec4 acc = vec4(0.); float wsum = 0.;
  for (int j=0;j<2;j++) for (int i=0;i<2;i++){
    ivec2 ip = clamp(i0+ivec2(i,j), ivec2(0), ivec2(uHalfRes)-1);
    float dv = texelFetch(uVolDepth, ip, 0).r;                      // hit depth of the half-res sample
    float w = (i==0?1.-f.x:f.x) * (j==0?1.-f.y:f.y);
    float dw = 1.0 / (1e-2 + abs(dv - fullDist) / max(fullDist, 1.0) * 40.0);   // similar depth => high weight
    w *= dw; acc += w * texelFetch(uVol, ip, 0); wsum += w;
  }
  return acc / wsum;
}
```
When the volume is far behind or in front of geometry, `dv` = 1e9 -> those taps get suppressed by the depth term; acceptable at silhouettes of the vehicle/tower.

Temporal accumulation for a frozen scene (no motion, so no reprojection needed):
```js
// per frame
if (camera moved || resized || uniforms changed) frame = 0;
accumMat.uniforms.uAlpha.value = 1 / (frame + 1);        // running mean; blend = mix(history, current, alpha)
frame++;   // stop rendering the volume when frame >= 64; keep the last history texture as a static input
```
```glsl
// accumulate.frag:  outColor = mix(texture(uHistory, vUv), texture(uCurrent, vUv), uAlpha);
```
Use two ping-pong RTs (HalfFloat RGBA, plus a second for depth via MRT, keep the depth of the latest frame only). While moving, run 24 steps and blur 3x3 to hide noise, then refine when the camera settles (typical "progressive" mode, est).

### 2.10 Cheaper option to fall back to
If the 3D approach costs too much: instanced billboard sprites with baked octree shading are inferior; instead keep the raymarch but bake the *whole steam field* into a 512 x 128 x 384 lit-radiance volume (colour = precomputed single-view-independent lighting: direct + ambient + plume, no phase) and only do 32-step viewing rays doing HG phase, which removes the nested sun lookups (already the case here since the sun is a texture lookup). The main cost is density eval, so reduce steps with a coarse occupancy 3D mip (skip empty space: sample `texture(uDensity, uvw, 3.0)` with mipmaps; set `generateMipmaps = true` on a Data3DTexture).

---------------------------------------------------------------------------------------------------

## 3. Rocket plume (methalox, sea level, 33 engines)

### 3.1 What it really looks like and why
- Daylight photo reading (measured in `palette.json`): column is **pink-white (#f5e4e7, clipped)**, base fireball **pale yellow-white (#fbf7a3) into saturated orange (#f5960e)**. [src measurement of research/reference.jpeg]
- Physics [est: standard combustion diagnostics, not verified for Raptor specifically]: a sootless methane/oxygen flame radiates mostly as **chemiluminescence** rather than blackbody: CH* (A-X 431 nm, violet/blue), C2* Swan bands (470-560 nm, green-blue), CN, OH* (309 nm, UV, invisible), plus H2O/CO2 IR. Full-flow staged combustion with a fuel-rich main chamber leaves CO/H2/CH4 residual that **afterburns** in the air-mixing layer (orange-yellow, plus any incandescent soot/particles from ablatives, ~1900-2600 K). A camera with clipped highlights turns the violet-blue core + broad yellow emission into "pink/violet-white". Therefore: core = blue-violet emission spectrum with very high radiance (which the sensor clips to near white with magenta tint), sheath = orange-yellow.
- Mach diamonds: quasi-periodic shock cells in the supersonic jet core. Standard estimate spacing (Prandtl-Pierce / Tam) `L_s ≈ 1.3 * D_e * sqrt(M_e^2 - 1)` [est: recalled correlation, Tam & Tanna style; not fetched]. For Raptor sea-level: expansion ratio **34.34**, chamber pressure **~300 bar** (250-330 bar depending on version) [src https://en.wikipedia.org/wiki/SpaceX_Raptor as summarised by search; values vary by version]. Isentropic solve of A/A* = 34.34 (my own computation, gamma 1.15 / 1.20 / 1.25): **M_e = 3.9 / 4.1 / 4.4**, **p_e = 0.92 / 0.76 / 0.63 bar** at p_c = 300 bar [est: computed], i.e. slightly over-expanded at sea level, so shock cells are weak. With nozzle exit diameter D_e ≈ **1.3 m** [est: not verified; look up Raptor 2/3 nozzle exit diameter in the vehicle-geometry research file], `L_s ≈ 1.3 * 1.3 * sqrt(4.1^2-1) ≈ 6.8 m` (range 6.3-7.6 m). With 33 engines the jets merge within ~2-4 nozzle diameters; per-engine diamonds are only visible in the near field and get smeared in the merged plume, and at this photo's scale (~1 px ≈ 0.3-0.5 m near the vehicle) none are resolved. **Recommendation: render a subtle 8-15 % axial intensity modulation with period ~6.8 m fading over ~50 m** and per-engine sub-plumes only if a close-up camera is allowed. Hidden detail is fine; the user wants an educational panel for this, so keep the number.

### 3.2 Geometry approach: raymarched cylinder proxy (recommended) vs layered shells
Recommended: **one open cylinder mesh** (BackSide) enclosing the plume from the nozzle plane down to the flame-deflector fireball, fragment shader raymarches inside with analytic cylinder entry/exit, emits additively, low absorption. Depth-tested against the scene (tower and vehicle occlude it), `depthWrite:false`, `blending: THREE.AdditiveBlending`, `transparent:true`. Drawn before the steam composite so steam attenuates it.

```glsl
// plume.frag  (ShaderMaterial, GLSL3, object space: cylinder axis = +Y, y=0 at nozzle plane, plume goes to -y)
uniform vec3  uCamObj;            // camera in plume object space
uniform float uLen, uR0, uSeed;   // e.g. uLen 140 m [est], uR0 ~ 4.5 m (half the ~9 m engine cluster) [est]
uniform float uLs;                // shock spacing, 6.8 m
uniform sampler3D uNoiseA, uNoiseB;
uniform vec3 uColCore, uColMid, uColSheath;   // linear HDR: core (1.0,0.82,0.95)*k1, mid (1,0.85,0.35)*k2, sheath (1,0.32,0.03)*k3
in vec3 vObj;
const int N = 40;

float plumeR(float s){ return uR0 * (1.0 + 0.055*s/uR0) ; }          // slow spreading, ~3° half angle near-matched [est]
vec3 emission(vec3 p){
  float s = -p.y;                                                    // distance below the nozzle plane
  if (s < 0. || s > uLen) return vec3(0.);
  // turbulence: domain warp grows with distance (entrainment)
  vec3 w = (texture(uNoiseA, p * 0.09 + vec3(0., uSeed, 0.)).gba - 0.5);
  float grow = smoothstep(2., 35., s);
  p.xz += w.xz * grow * 0.35 * plumeR(s);
  p.y  += w.y  * grow * 1.5;
  float R = plumeR(s);
  float r = length(p.xz) / R;
  float core  = exp(-r*r*2.2) * exp(-s/70.);                          // hot centreline, decays over ~70 m
  float shell = exp(-pow(abs(r-1.05)/0.28, 2.)) * exp(-s/110.);     // afterburning sheath, orange
  float wisps = texture(uNoiseB, p*0.35).r;                          // tiny streaks
  shell *= 0.5 + wisps;
  // Mach cells: cos^2 modulation, fades with distance and radius
  float diamonds = 1.0 + 0.12 * pow(0.5+0.5*cos(6.2831853*s/uLs), 2.0) * exp(-s/40.) * exp(-r*r*3.);
  vec3 c = uColCore * core * 14.0 * diamonds;                        // HDR >> 1: clipped white-pink after tone mapping + bloom
  c += mix(uColMid, uColSheath, smoothstep(0., 60., s)) * shell * 3.0;
  return c;
}
void main(){
  vec3 ro = uCamObj, rd = normalize(vObj - uCamObj);
  // analytic cylinder (radius Rmax at both ends ~ plumeR(uLen)*1.5) intersection -> t0,t1 (omitted for brevity: standard quadratic in xz + y slab)
  float dt = (t1 - t0) / float(N); float t = t0 + dt * jitter;
  vec3 L = vec3(0.);
  for (int i=0;i<N;i++, t+=dt) L += emission(ro + rd*t) * dt;
  gl_FragColor = vec4(L * uExposure, 1.0);                           // additive blending
}
```
Layered-shell fallback (cheaper, more stylised): 5-6 coaxial cylinders / cones with shells at r = 0.4R, 0.7R, 1.0R, 1.25R, 1.6R, additive, each with a vertical noise scroll frozen, alpha from `pow(fresnel-ish rim, k)` and flame-like `smoothstep` noise cutoff; colours core->sheath as above. Cheap but shows edges when rotated; the raymarched proxy avoids that.

Photo-derived colour guidance (linear after decode from sRGB): pink-white `#f5e4e7` -> approx (0.91, 0.78, 0.80); base yellow-white `#fbf7a3` -> (0.96, 0.93, 0.36); orange `#f5960e` -> (0.91, 0.31, 0.004). Because the JPEG is clipped, author in HDR and let the tone mapper clip it: core radiance ~10-20, sheath ~2-4.

### 3.3 Lighting the scene with the plume
Options compared:
1. **Point lights**: 3-6 `THREE.PointLight`s along the axis (fireball at the deflector strongest, warm 2400 K colour; mid-column pale yellow; upper column pale pink-white), `decay = 2`, `distance = 0`, physical intensity units (candela in r155+). Cheap and works with `MeshStandardMaterial` for tower, vehicle, ground and pad concrete. Shadows: enable on at most 1-2, set `renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true` once since the scene is frozen (point light = 6 cube faces). [est: standard three.js practice]
2. **Line-light in the shader** (representative point on a segment, Karis, "Real Shading in Unreal Engine 4", SIGGRAPH 2013 course; tube light): closest point on the axis segment to the shading point gives the diffuse and specular direction; illumination `E = I / (d^2 + r^2)`. Implement as an extra light term injected via `onBeforeCompile` on the opaque materials:

```glsl
// fragment injection after <lights_fragment_end>  (MeshStandard/PhysicalMaterial)
uniform vec3 uPlumeA, uPlumeB;   // segment endpoints, world space
uniform vec3 uPlumeCol;          // radiance colour
uniform float uPlumeI;
...
vec3 P = vWorldPosition;        // add `varying vec3 vWorldPosition` in vertex via <worldpos_vertex>
vec3 ab = uPlumeB - uPlumeA;
float tt = clamp(dot(P - uPlumeA, ab) / dot(ab,ab), 0., 1.);
vec3 closest = uPlumeA + ab * tt;
vec3 Ld = closest - P; float d2 = dot(Ld,Ld) + 16.0;  // 4 m soft radius
vec3 Lh = normalize(Ld);
float ndl = max(dot(normal, Lh), 0.);
reflectedLight.directDiffuse += uPlumeCol * uPlumeI * ndl / d2 * BRDF_Lambert(material.diffuseColor);
// (specular: reuse RE_Direct_Physical with a synthetic IncidentLight for full GGX; optional)
```
   Cheaper and much smoother than many lights; add 1 point light at the fireball for shadows.
3. **RectAreaLight** (`RectAreaLightUniformsLib.init()`, only works with Standard/Physical, no shadows): a vertical rect can only face one direction, cannot wrap the axis; do not use.

Recommendation: **option 2 for smooth axial falloff + 1-2 shadowing point lights (baked once) + the baked `uPlumeE` volume for the steam.** The tower's orange rim in the photo (`#ea9d6d` on lit tower steel) confirms strong warm near-field light.

---------------------------------------------------------------------------------------------------

## 4. Screen-space heat haze

Only a faint effect in the photo (no visible shimmer at this resolution), but educational mode wants it. Implement as a pmndrs custom `Effect` that offsets UVs where a plume mask is present and the plume is *in front of* the distorted pixel.

```js
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import { Uniform } from 'three';

const frag = /* glsl */`
uniform sampler2D tMask;      // half-res: R = plume-density along view ray (line integral of hot gas), G = plume front depth (linear metres)
uniform sampler2D tNoise;     // tileable 2D noise, RG signed in [0,1]
uniform float uAmp;           // pixels-ish: 0.0015..0.004 in UV units
uniform vec2  uScale;         // noise tiling, e.g. vec2(7., 12.)
void mainUv(inout vec2 uv){
  vec2 m = texture2D(tMask, uv).rg;
  float amt = m.r * uAmp;
  vec2 n = texture2D(tNoise, uv * uScale).rg * 2.0 - 1.0;
  n.y = abs(n.y) * 0.3 + n.y * 0.7;             // upward bias: shimmer rises
  uv += n * amt;
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){ outputColor = inputColor; }
`;
export class HeatHazeEffect extends Effect {
  constructor(){ super('HeatHazeEffect', frag, { blendFunction: BlendFunction.SRC, uniforms: new Map([
    ['tMask', new Uniform(null)], ['tNoise', new Uniform(null)], ['uAmp', new Uniform(0.003)], ['uScale', new Uniform([7,12])] ]) }); }
}
```
- Mask: render the plume proxy cylinder into a half-res RT with `mask = 1 - exp(-k * pathLengthThroughCylinderWeightedByGaussianRadial)`, plus a diffuse halo (blur by 9 px) so the distortion fades smoothly. Also add the hot flame-deflector region above the pad (long horizontal haze).
- Occlusion: only distort if scene depth > plume depth (pass depth via `EffectAttribute.DEPTH` and compare in `mainImage`, or simply skip and accept slight ghosting of the vehicle, which is *inside* the hot column so distortion of the vehicle base is physically right).
- Amplitude: `uAmp` 0.002-0.004 of screen height (2-4 px @ 1080p). Physically the refractive index change of hot gas is ~ 1e-4; real distortion is tiny and visible mainly as motion shimmer, so a frozen frame should keep this very low, else it looks wrong. [est]
- Put it in its **own `EffectPass` before** the bloom/tone-mapping pass. pmndrs disallows merging UV-modifying effects with convolution effects in the same pass (as I recall; verify by trying to merge). [est]

---------------------------------------------------------------------------------------------------

## 5. Water: shallow tidal pools, ocean

### 5.1 Tidal pools (planar reflection + fresnel + ripple normals, blended in a terrain splat)
Observations from the photo [src pixel samples in palette.json]: pools are mostly **dark brown** where the bed shows through (`#32251d`), grey-blue where they reflect sky (`#717b84`), and **strong orange** where they reflect the steam clouds (`#966438`). All pools are almost mirror-flat: ripple normals should be very weak.

All pools sit at one height, so **one planar reflection at y = y_water** covers them all. Use the `Reflector` machinery, but the terrain is one splat mesh, so use `Reflector` on an invisible (or `visible=false` hidden but still rendered? no) helper plane, or reimplement its ~40-line virtual-camera code to render the reflection RT and reuse only its `textureMatrix`. Simplest: keep a `Reflector` (plane at y_water, `color: 0x000000`, `multisample: 4`, `textureWidth/Height` = half screen), put it **slightly below** the terrain top so it's invisible where terrain is present; then read `reflector.getRenderTarget().texture` and `reflector.material.uniforms.textureMatrix.value` [src Reflector.js] into the terrain shader. Caveat: Reflector only renders in `onBeforeRender`, which fires only if the mesh is drawn each frame; keep it in the scene with `material.colorWrite=false; depthWrite=false` rather than `visible=false`. For the volumetric steam and cloud reflection (they are not meshes): either (a) render the mirrored camera through the same volumetric marcher at 1/4 res with 24 steps into a second RT which is composited into the reflection RT, or (b) approximate with a big emissive billboard textured from a low-res blurred copy of the previous frame's volumetric result (reflection of orange steam is smooth and low-frequency; option b is visually sufficient) [est].

Terrain-splat fragment code (blended by wetness mask):

```glsl
uniform sampler2D uMaskTex;       // R = pool depth 0..1 (0 dry, ~0.02 = wet-sand, 1 = deepest), G = wet sand, B unused. Hand-painted from the photo's ground layout or procedurally from noise + a height map
uniform sampler2D uReflect, uRippleN;    // planar reflection RT, tiling ripple normal map
uniform mat4 uReflMatrix;                // Reflector textureMatrix
uniform vec3 uBedAlbedo;                 // (0.20,0.15,0.11) linear wet mud
uniform vec3 uAbsorb;                    // per-metre absorption of tannin/silt water (1.6, 2.4, 3.2) [est] -> brown bed, depth 0.1-0.5 m
uniform float uRipple;                   // 0.02 (barely there)
uniform vec3 uSunDir, uSunColor;

vec3 poolShade(vec3 wp, vec3 V, vec3 dryColor){
  vec4 mk = texture(uMaskTex, wp.xz * uMaskScale + 0.5);
  float depth = mk.r * uMaxDepth;                     // metres
  float edge  = smoothstep(0.0, 0.02, mk.r);          // shoreline fade
  // ripple normal: two scales, frozen
  vec3 n = normalize(vec3(0,1,0) + uRipple * vec3(
      texture(uRippleN, wp.xz*0.35).rg*2.-1., 0.).xzy + 0.5*uRipple*vec3(texture(uRippleN, wp.xz*1.3+.37).rg*2.-1.,0.).xzy);
  float NoV = clamp(dot(n, V), 0., 1.);
  float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);        // Schlick, F0=0.02 (water) [src: Water.js uses the same F0]
  vec4 rc = uReflMatrix * vec4(wp, 1.0);
  rc.xy += n.xz * uRipple * 6.0 * rc.w;                // distort reflection lookup
  vec3 refl = textureProj(uReflect, rc).rgb;
  vec3 bed  = uBedAlbedo * exp(-uAbsorb * depth * 2.0) * (uSunColor*0.6 + vec3(0.15));  // shallow-water absorption, two-way
  vec3 sunSpec = uSunColor * pow(max(dot(reflect(-V,n), uSunDir),0.), 600.) * F;
  vec3 water = mix(bed, refl, F) + sunSpec;
  return mix(dryColor, water, edge);
}
```
Tips: at grazing camera angles (the photo camera is ~high, looking down ~15-20 deg, so NoV small) Fresnel approaches 0.2-0.5 and the pools mirror the steam: this is exactly the orange reflections in the photo. Expose "reflection strength" for the artist; add a slight **tint of the bed and a roughness blur** by sampling the reflection RT 3-5 times with a small kernel.

### 5.2 Ocean
The Gulf (photo: `#45626d` far, `#547884` left, `#66797d` right, flat, no waves resolved, horizon at y ~ 525 px) is 1-3 km away. Options:
1. **Example `Water`** [src Water.js above]: `new Water(geo, { waterNormals: tex, sunDirection, sunColor, waterColor: 0x1c4048, distortionScale: 1.5, textureWidth: 512, textureHeight: 512, fog: false })`. Pros: works out of the box with WebGLRenderer; reflection is exact. Cons: it renders a *second* reflection RT (duplicate of pool reflection: they are at different heights if the ocean sits lower, else share) and its sun specular exponent 100 is too broad; animate uniform `time` is unnecessary (set constant).
2. **Better for this photo (recommended)**: a custom shader on a large plane using the same reflection texture logic, but for distances > ~300 m skip the planar reflection and use **Fresnel-weighted sample of the sky-view LUT / PMREM at the reflected direction**, deep-water scattering colour `#3e5e6a` in linear ~ (0.05,0.11,0.14), normal roughness that *grows with distance* (mip the normal map by distance to avoid shimmer), foam/sandbar shoreline mask from a 2D texture (the pale line near y ~ 540-560 px). Add horizon haze `mix(waterColor, skyHorizon, 1 - exp(-dist/9000))` with `skyHorizon = #8bb4bc`.

```glsl
vec3 oceanShade(vec3 wp, vec3 V, samplerCube/uSkyEnv)  {
  vec3 n = normalize(vec3(0,1,0) + vec3(fbm2(wp.xz*0.003)*0.03, 0., fbm2(wp.xz*0.003+9.)*0.03) / (1.0 + dist/2000.));
  float F = 0.02 + 0.98*pow(1.0-max(dot(n,V),0.), 5.0);
  vec3 sky = textureLod(uSkyEnv, reflect(-V, n), 1.0).rgb;
  vec3 body = vec3(0.05,0.11,0.14);                     // est from palette (linearised #45626d ~ (0.06,0.12,0.15))
  return mix(body, sky, F) + sunGlitter;
}
```
Sun glitter is not visible in the photo (sun is not in the reflected direction), so keep glitter off or very small unless the user orbits.

---------------------------------------------------------------------------------------------------

## 6. Sky

### 6.1 Options
| Option | Pros | Cons |
|---|---|---|
| Example `Sky` (Preetham) [src Sky.js] | 1 line, WebGL2, has `turbidity/rayleigh/mie*`, r186 even has simple built-in clouds | Preetham is inaccurate at low sun & saturated blue; no aerial perspective; no atmosphere in the volumes |
| `@takram/three-atmosphere` (WebGL, Bruneton precomputed) | physically based sun/sky/aerial perspective | Beta, API to change when WebGPU version lands [src repo README], heavy dependency |
| `@pmndrs/sky` / `SebH-TSL-Sky` (Hillaire 2020, TSL) | exact port of Hillaire | requires WebGPURenderer/TSL, incompatible with our GLSL3 volumetrics on WebGLRenderer |
| **Own GLSL3 Hillaire LUTs** (recommended) | tiny, exact control of the palette; gives a sky-view LUT, sun transmittance colour for volumetrics, ambient colour for clouds | ~300 lines to write |

### 6.2 Hillaire 2020 LUTs (self-written, WebGL2)
Paper: Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering Technique", EGSR 2020, Computer Graphics Forum [src https://onlinelibrary.wiley.com/doi/abs/10.1111/cgf.14050; reference code at github.com/sebh/UnrealEngineSkyAtmosphere, not fetched]. LUTs: **Transmittance 256x64**, **Multiple-scattering 32x32**, **Sky-view 192x108**, optional aerial-perspective froxel volume 32^3 (skip: our camera is at altitude ~100-300 m so aerial perspective over ~3 km ≈ a simple exponential haze).
Constants (Earth, per metre; recalled from the paper's parameters, **verify against the paper**): Rayleigh scattering `(5.802, 13.558, 33.1) e-6`, scale height 8 km; Mie scattering `3.996e-6`, extinction `4.44e-6`, scale height 1.2 km, g = 0.8; ozone absorption `(0.650, 1.881, 0.085) e-6`, tent layer centred 25 km, half-width 15 km; ground radius 6360 km, top 6460 km. [est: recalled]
Bake order: transmittance -> multi-scatter (uses transmittance) -> sky-view for the *actual* camera altitude (say y = 200 m) and the sun direction. The photo's golden-hour warm sun / deep-blue zenith (`#127ebe`, hsv ~ (202deg, 0.89, 0.73)) suggests **sun elevation ~ 10-20 deg** [est: sun-lit cloud tops warm cream (#e4d6c1) but shadows neutral-cool; sky at zenith very saturated]. Feed the same transmittance LUT to get `uSunColor` at the volume (sun ray from the cloud, altitude ~ 100-300 m) and use the sky-view LUT integrated over the hemisphere (16 samples) for `uAmbHigh`.

Quick path first: use example `Sky` with `turbidity 1.5-2.5, rayleigh 2.0-3.0, mieCoefficient 0.003, mieDirectionalG 0.85`, sun elevation 12-20 deg, then convert to a PMREM cube via `pmrem.fromScene(skyScene)` for IBL, and compare to swatches from palette.json (zenith `#127ebe`, mid-sky `#7fa5c2`, horizon `#8bb4bc`). Swap in the Hillaire LUT only if the gradient cannot be matched.

### 6.3 Background cumulus layer (cheap raymarch + 2D coverage map)
The photo's big cumulus (three dominant masses; warm cream lit tops, grey-blue underside `#6a6c69`, centre cloud at ~ y 90-410 px) sit roughly 1.5-4 km away and are 0.6-1.5 km wide [est]. Model as a **slab layer** with a **2D coverage/type map** then raymarch 24-32 steps only inside the slab intersection (these clouds appear at low elevation angles, so use a layer with base ~300 m and top ~1800 m above ground, sampled with the coverage map in ground xz coordinates, with masses authored at 2-6 km from the mount; est), with placement authored to reproduce the photo's masses.

```glsl
// cumulus.frag inside the volumetric pass (shares sampleMedium style):
uniform sampler2D uCover;        // R coverage (0..1), G cloud-type/height-scale, B erosion bias; 1024^2, repeat
uniform vec2 uCoverScale;        // 1/8000 per metre
uniform vec2 uLayer;             // base, top metres  (300, 1800)
float cumulusDensity(vec3 p){
  float h = clamp((p.y-uLayer.x)/(uLayer.y-uLayer.x), 0., 1.);
  vec3 c = texture(uCover, p.xz*uCoverScale).rgb;
  // Schneider height gradient: rounded bottoms, fat middle, thin top; type g biases towards cumulus
  float grad = smoothstep(0.0, 0.1, h) * smoothstep(1.0, 0.55*c.g+0.35, h);
  float base = c.r * grad;
  vec4 nA = texture(uNoiseA, p*uNoiseScaleCum);               // scale 1/700 m
  float d = remap(base, (1.-nA.r)*0.55, 1., 0., 1.) * c.r;
  vec3 nB = texture(uNoiseB, p*uNoiseScaleCum*6.0).rgb;
  d = remap(d, dot(nB,vec3(.625,.25,.125))*0.45*(1.-h*.4), 1., 0., 1.);
  return d;                                                   // sigma ~ 0.0025 /m for km-scale cumulus [est]
}
```
Lighting: reuse 2.7's loop with `uSigma_cum = 0.004`, sun tau by 6-step march toward the sun (no bake needed; static frame accumulates) or a coarse 2D shadow-height bake. Cloud sun colour is warmer than steam (it is more distant; multiply by the sun transmittance from the sky LUT). Underside colour: sky ambient + ground bounce; tune to swatches `#797978`, `#6a6c69`. Very-far cumulus should be cheaper: 16 steps, `dt` growing.

### 6.4 Wispy cirrus (2D layer)
Photo: fibrous cirrus streaks in the top-right and diagonal streaks at top centre (`#7897b4`, only ~15-20 % brighter than the surrounding `#3184bc`..`#7fa5c2` sky).
```glsl
// analytically intersect ray with plane y = 8000 m (or a 2D dome), then:
vec3 cirrus(vec3 rd, vec3 sunDir){
  float t = 8000.0 / max(rd.y, 0.02);  vec2 uv = (rd.xz * t) * 1.0e-4;
  uv = mat2(0.87,-0.5,0.5,0.87) * uv;                        // rotate along the streak direction (est from photo: ~30° from horizontal, upward to the right)
  uv.x *= 0.18;                                              // stretch: anisotropic fBm => streaks
  float n = fbm2(uv*vec2(1.0, 6.0) + fbm2(uv*3.0)*0.6);      // domain-warped, tileable value/gradient noise
  float cov = smoothstep(0.52, 0.85, n) * smoothstep(0.0, 0.25, rd.y);
  float fwd = 0.5 + 0.5*pow(max(dot(rd, sunDir),0.), 4.);    // brighter near sun
  return vec3(0.85,0.9,1.0) * cov * (0.25 + 0.5*fwd);
}
// composite: sky = sky * (1. - a) + cirrus.rgb*a  with a = cov*0.35
```
Wispy edges: subtract a second high-frequency fbm at 4x frequency from `n` (`n -= 0.15*fbm2(uv*16.)`). Cirrus is at 8 km so it is above/behind everything, add before volumetric clouds.

---------------------------------------------------------------------------------------------------

## 7. Procedural materials (MeshPhysicalMaterial + onBeforeCompile)

Injection scheme, valid for r186 `meshphysical` shader chunks (chunk names recalled from three's source; check `three/src/renderers/shaders/ShaderLib/meshphysical.glsl.js`): vertex: append after `#include <begin_vertex>`: `vObjPos = position;` (declare `varying vec3 vObjPos; varying vec3 vObjNrm;`). Fragment: replace `#include <map_fragment>` (albedo), `#include <roughnessmap_fragment>`, `#include <metalnessmap_fragment>`, `#include <normal_fragment_maps>` (bump), `#include <emissivemap_fragment>`.

```js
function patch(mat, {uniforms={}, fragHelpers='', mapFrag='', roughFrag='', normalFrag=''}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos; varying vec3 vObjNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position; vObjNrm = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos; varying vec3 vObjNrm;\n' + fragHelpers)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + mapFrag)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + roughFrag)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + normalFrag);
  };
  mat.customProgramCacheKey = () => 'patch-' + (mat.name || 'x');
}
```
Cylindrical UV in the shader (booster/ship axis = object Y, radius R = 4.5 m [est: 9 m diameter, other researchers own exact numbers]):
```glsl
vec2 cylUV(vec3 p){ return vec2(atan(p.z, p.x) / 6.2831853 + 0.5, p.y); }   // u in turns, v in metres
float arcLen(vec3 p, float R){ return (atan(p.z,p.x)+3.14159265) * R; }     // metres along circumference
```
Triplanar (for the tower, flat pads): `blend = pow(abs(n), vec3(4.)); blend /= dot(blend, vec3(1.));` sample 3 planes with `p.yz`, `p.xz`, `p.xy`.

### 7.1 Stainless steel (brushed, anisotropic, weld seams)
- MeshPhysicalMaterial: `metalness 1.0, roughness 0.32, anisotropy 0.6, anisotropyRotation = Math.PI/2` (streaks run circumferentially) [three.js supports `anisotropy` / `anisotropyRotation` on MeshPhysicalMaterial since r153; est]. Colour: warm-shifted steel from the photo, lit booster `#9f9080`, shadowed `#434345`. Set `envMap` from the sky PMREM, `envMapIntensity` 1.0.
- Roughness modulation: circumferential brushing via 1D noise along v: `hash(floor(v*900.))` stretched along u; `rough = 0.30 + 0.06*brush + 0.10*grime`.
- Weld seams: horizontal ring welds every ring height `H_r` [est: ~1.8 m rings; check vehicle geometry file], vertical seam every 90 deg or at 2-3 fixed angles; profile `weld(x) = exp(-pow(x/0.012, 2))` (12 mm bead) modulated by low-freq noise; albedo darker-gold (heat-tint) ring `smoothstep(0.03,0.0,x)*vec3(0.5,0.4,0.25)`, +bump height 0.6 mm; normal from analytical derivative: `bump = weld; N = perturbNormalArb(...)` or easier: in `normal_fragment_maps` replace with `normal = normalize(normal + (dFdx(bump)*... )` using `dHdxy_fwd` pattern: `vec2 dH = vec2(dFdx(h), dFdy(h)); normal = perturbNormalArb(-vViewPosition, normal, dH * bumpScale, faceDirection);`.
```glsl
// fragHelpers
float seams(vec3 p, float ringH, float R){
  float y = p.y / ringH; float d = abs(fract(y + 0.5) - 0.5) * ringH;          // metres to nearest ring weld
  float a = arcLen(p, R); float vd = min(abs(mod(a, 3.1416*R*0.5) ), 3.1416*R*0.5 - abs(mod(a, 3.1416*R*0.5))) ; // 4 vertical welds
  return max(exp(-pow(d/0.012,2.)), exp(-pow(vd/0.012,2.)));
}
```
```glsl
// mapFrag  (albedo tint + grime)
float sm = seams(vObjPos, uRingH, uR);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(0.55,0.45,0.30), sm*0.6);   // heat tint
// roughFrag
float brush = fract(sin(dot(floor(vec2(arcLen(vObjPos,uR)*30., vObjPos.y*900.)), vec2(12.9898,78.233)))*43758.5453);
roughnessFactor = clamp(roughnessFactor + 0.06*(brush-0.5) + 0.12*sm, 0.05, 1.0);
```

### 7.2 Cryogenic frost on tanks
The booster in the photo is grey-brown with lit warm patches; frost from cold LOX/methane tanks appears as white patches on the upper booster/ship tank regions and gets shed in flakes at liftoff. [est] Mask = `smoothstep(y0,y1,y)` (tank height band) * `(0.5 + fbm)` thresholded, with **vertical streaks** (stretch noise in v: `noise(vec2(u*60., v*3.))`) and edges eroded by Worley crystals:
```glsl
float frost(vec3 p){
  vec2 uv = cylUV(p);
  float band = smoothstep(uY0, uY0+3., p.y) * (1.0 - smoothstep(uY1-6., uY1, p.y));
  float n = fbm3(vec3(uv.x*40., p.y*1.5, 0.)) ;                 // streaked
  float cell = worley2(vec2(uv.x*220., p.y*220.));              // crystals
  float m = smoothstep(0.45, 0.65, n*band + 0.25*cell);
  return m;
}
// mapFrag:  float f = frost(vObjPos);  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86,0.9,0.95), f*0.9);
// roughFrag: roughnessFactor = mix(roughnessFactor, 0.85, f);   metalnessFactor = mix(metalnessFactor, 0.0, f);
// bump: h += f * (0.5 + cell)*0.002;
```
`metalnessFactor` is defined by `#include <metalnessmap_fragment>` so patch after that chunk. Add a faint blue subsurface tint in shadow: `diffuseColor.rgb *= vec3(0.96,0.99,1.03)`. Frost also scatters sun: fine with high roughness. For the photo scale (~4 px/m) all this is sub-pixel; keep the mask coarse and let detail appear on zoom.

### 7.3 Hexagonal ceramic heat-shield tiles (Ship, windward side)
Hex grid in (u_m, v_m) metres: tile pitch `P` ~ 0.20 m (across flats) and gap ~ 4-6 mm [est: Starship tiles are hexagonal ~15-20 cm; verify in vehicle research].
```glsl
// hex cell id + distance-to-edge (iq-style axial hex)
vec4 hexCell(vec2 p, float P){
  const vec2 s = vec2(1.7320508, 1.0);
  p /= P;
  vec4 hC = floor(vec4(p, p - vec2(1.0, 0.5)) / s.xyxy) + 0.5;
  vec4 h  = vec4(p - hC.xy*s, p - (hC.zw + 0.5)*s);
  vec4 r  = dot(h.xy,h.xy) < dot(h.zw,h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + 0.5);
  return r;                                     // r.xy = local coords in cell, r.zw = id
}
float hexEdgeDist(vec2 q){ q = abs(q); return max(dot(q, vec2(0.8660254, 0.5)), q.y) ; }   // 0..0.5 to the edge (normalised)
float rnd(vec2 id){ return fract(sin(dot(id, vec2(127.1,311.7)))*43758.5453); }
```
```glsl
// mapFrag
vec2 m = vec2(arcLen(vObjPos, uR), vObjPos.y);
vec4 hc = hexCell(m, uTileP);
float ed = 0.5 - hexEdgeDist(hc.xy);                   // >0 inside; small near edges
float gap = smoothstep(0.012, 0.0, ed);                // ~ 5 mm / 0.2 m = 0.025
float rid = rnd(hc.zw);
vec3 tileCol = vec3(0.020, 0.018, 0.017) * (0.7 + 0.6*rid);        // near-black glassy tiles, per-tile brightness
tileCol = mix(tileCol, vec3(0.05,0.045,0.04), smoothstep(0.85,1.0,rid));   // replaced/new tile
diffuseColor.rgb = mix(tileCol, vec3(0.005), gap);                     // dark gap
// roughFrag: roughnessFactor = mix(0.28 + 0.15*rid, 0.9, gap);  // glossy tile, rough gap filler
// normalFrag: tile-level tilt + gap depth via bump: h = -gap*0.003 + (rid-0.5)*0.0004; feed derivative bump.
```
Clearcoat for the glassy black coating: `material.clearcoat = 0.4; clearcoatRoughness = 0.25`. In the photo the ship shows as **pure near-black `#1d1b1a`** at ~4 px per metre, so tiles are only visible in first-person/close views. Use LOD: fade the tile pattern by `fwidth`: `float aa = fwidth(m.y)/uTileP; pattern = mix(pattern, avgTile, smoothstep(0.15,0.4, aa))`.

### 7.4 Soot
Ship/booster base and interstage bear black soot/stain streaks, and the aft-facing surfaces darken toward the engines [est]. `soot = smoothstep(a, b, height_mask) * (0.4 + 0.6*fbm(vObjPos.xz*vec2(3.,0.5) ... vertical-streak noise: noise(vec2(u*50., v*0.8)))`; apply `diffuseColor.rgb *= mix(1.0, 0.12, soot); roughnessFactor = mix(roughnessFactor, 0.85, soot); metalnessFactor *= (1.0-soot*0.7);`. Direction-of-flow streaks: elongate noise in the vertical, warp with a slow low-frequency term.

---------------------------------------------------------------------------------------------------

## 8. Post-processing (pmndrs `postprocessing` 6.39.x with three r186)

```js
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, TexturePass,
  BloomEffect, ToneMappingEffect, ToneMappingMode, LUT3DEffect, LookupTexture,
  SMAAEffect, SMAAPreset, NoiseEffect, VignetteEffect, ChromaticAberrationEffect, TiltShiftEffect,
  BlendFunction, KernelSize
} from 'postprocessing';

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, depth: false });
renderer.toneMapping = THREE.NoToneMapping;                 // required with pmndrs; do tone mapping via ToneMappingEffect [src]
renderer.outputColorSpace = THREE.SRGBColorSpace;

const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });

// Inject our own composited HDR texture (opaque + plume + volumetrics) instead of RenderPass:
composer.addPass(new TexturePass(hdrCompositeTexture));          // or RenderPass(scene,camera) if volumetrics are scene meshes

composer.addPass(new EffectPass(camera, heatHaze));               // own pass (UV-modifying)

const bloom = new BloomEffect({
  mipmapBlur: true,                       // dual-filter mip chain bloom
  intensity: 0.7,                         // palette: soft glow around fire/plume
  luminanceThreshold: 0.9,                // in linear HDR; steam whites sit ~0.7-0.9, the fire >> 2
  luminanceSmoothing: 0.25,
  radius: 0.75,                           // mip blur radius
  levels: 8
});
const tone  = new ToneMappingEffect({ mode: ToneMappingMode.AGX });   // or ACES_FILMIC; AGX is the default per docs [src]
const lut   = new LUT3DEffect(gradeLUT);                              // gradeLUT: a LookupTexture (.cube via LUTCubeLoader or generated), see 8.1
const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
grain.blendMode.opacity.value = 0.12;
const vign  = new VignetteEffect({ offset: 0.32, darkness: 0.45 });
const ca    = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0006, 0.0008), radialModulation: true, modulationOffset: 0.35 });
const tilt  = new TiltShiftEffect({ offset: 0.0, rotation: 0, focusArea: 0.55, feather: 0.25, kernelSize: KernelSize.MEDIUM, resolutionScale: 0.5 });  // enable for diorama look only

composer.addPass(new EffectPass(camera, bloom, tone, lut, ca, vign, grain));  // tone before lut; effects merge in one pass
composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));   // SMAA last (needs LDR)
```
Caveats [est, verify in the docs while coding]:
- Bloom before tone mapping so HDR values feed the threshold; tone mapping merged after it in the same pass is allowed.
- **Convolution effects** (bloom, tilt-shift, CA?) and UV-changing effects may need separate passes; the library reports a clear error if a merge is invalid.
- `SMAAEffect` in v6 needs no external image loading (the lookup textures are embedded); older `SMAAImageLoader` code is obsolete. Keep SMAA in its own pass after grain, or accept temporal accumulation instead: the volumetric accumulation already antialiases the volumes, so SMAA only matters for geometry (tower/vehicle edges).
- The sRGB conversion happens at the end of the last `EffectPass`; LUT grade in `LUT3DEffect` assumes an sRGB input by default and pmndrs handles the colour-space transform between effects (`inputColorSpace`), but check `lut.inputColorSpace` if colours look washed.
- Dark-corner vignette must stay mild: photo edges are not vignetted (sky corner `#127ebe` stays saturated); use `darkness ≤ 0.35`.
- Chromatic aberration: subtle only (≤ 1 px at the corners); the photo is a sharp drone frame.
- Tilt-shift: default OFF (photo is deep-focus); offer as a "diorama" toggle in the UI.

### 8.1 Grading LUT
Build a 33^3 `LookupTexture` on the CPU from a colour function, or author in a grader and load a `.cube` with `LUTCubeLoader`. Target values from `palette.json` `grading_target`:
- shadows lift to about `#12100f` (p1 luma ≈ 19/255), split-tone shadows toward blue-teal, highlights toward warm cream (`#e4d6c1`, R−B ≈ 35-45), overall saturation +8..12 %, mild S-curve contrast, highlight rolloff soft (99.9th percentile luma ≈ 239/255, cloud highlights top at 225-232 and only plume core / fireball clip).
- Colour temperature (est): sun ~4500-5000 K, skylight ~9000-12000 K, fire ~2000-2600 K.

---------------------------------------------------------------------------------------------------

## 9. Photo colour analysis (summary; full swatches in `research/palette.json`)

Measured with PIL/numpy on `research/reference.jpeg` (1677x943), 9x9 to 13x13 pixel means, sRGB 8-bit; the image is already display-graded (sharpened, tone-mapped), so treat as a *target look*, not scene-linear radiance.

| Element | Swatch (pixel) | Note |
|---|---|---|
| Sky zenith (top-left) | `#127ebe` (60,40) | saturated cerulean, hsv (202°, 0.89, 0.73) |
| Sky horizon left | `#8bb4bc` (40,400) | teal-grey haze |
| Upper-right sky (cirrus-washed) | `#9ab2c9` (1350,30) | |
| Cumulus lit highlight | `#e4d6c1` (80,190); `#e4d4bc` (900,190) | warm cream, never above ~232 |
| Cumulus shadow | `#797978` (760,340), `#6a6c69` (1000,390) | neutral grey (almost no blue!) |
| Steam shaded outer billows | `#5d6572` (1450,420), `#718593` (180,560), `#8598a5` (150,500) | cool blue-grey |
| Steam lit orange | `#d4a164` (1500,560), `#d89451` (480,540), `#cd975d` (1560,150) | R/B ≈ 2.7 |
| Plume column | `#f5e4e7` (818,540) | pink-white, clipped |
| Fireball | core `#fbf7a3`, edge `#f5960e` (840-900,650) | |
| Vehicle | ship black `#1d1b1a`, booster lit `#9f9080`, tower `#7b5958` | |
| Ocean | `#45626d`..`#66797d` | horizon y ≈ 525 px |
| Ground | mud `#34251e`, marsh `#483b24`, pad `#55403e`, asphalt `#15191a` | |
| Pools | orange reflection `#966438`, sky reflection `#717b84`, dark bed `#32251d` | |

Global stats: mean RGB (116,116,115) neutral (warm plume balances blue sky); luma percentiles p1/p5/p50/p95/p99/p99.9 = 19/31/116/199/217/239; mean saturation 0.33; brightest pixel cluster at (819,622), i.e. the base of the plume.
Look rules for the renderer: (1) steam is **warm on the lit side and cool blue-grey on the shaded side, with pinkish-lilac bounce (`#776568`)** in mid-shadow, plus deep brown where it meets the ground (`#412f2c`); (2) the underside and inner surfaces of the right cloud glow orange from the plume; (3) ground is dark and low-key, pools give the only bright accent besides the fire; (4) the sky is one of the most saturated regions, so do not desaturate it in grading.

---------------------------------------------------------------------------------------------------

## 10. Suggested defaults (starting point; tune against the swatches)

| Parameter | Value | Tag |
|---|---|---|
| steam sigma_t at density 1 | 0.06 /m | est |
| steam albedo | 0.98 | est |
| HG (g_fwd, g_back, w) | (0.65, -0.35, 0.7) | est |
| Wrenninge (a,b,c), N | 0.5, 0.5, 0.5; 3 | src (Wrenninge 2013 recommends ~0.5) / est |
| march steps (half-res), accum frames | 56, 64 | est |
| noise scales (m) | 150 / 25 / 6 | est |
| sun colour (linear) | ~(1.0, 0.72, 0.45) x intensity | est from palette |
| sun elevation | 10-20 deg | est |
| ambient high / low (display sRGB start) | `#5d7fa8` / `#7a5a44` | est from shaded steam + brown ground bounce |
| plume core / sheath radiance | 14 / 3 (linear HDR) | est |
| Mach cell spacing | 6.8 m (5.2 D_e) | est (computed, see 3.1) |
| bloom | intensity 0.7, threshold 0.9, radius 0.75, mipmapBlur | est |
| tone mapping | AGX (default), fallback ACES | src (docs) |
| vignette / grain / CA | 0.35 / 0.12 / 0.0007 | est |
| heat haze amplitude | 0.003 UV | est |

## 11. Risks and gaps
- `setRenderTarget(rt, layer)` for a `WebGL3DRenderTarget` is documented; I did not execute it. Smoke-test a 4-layer target early (write layer index as value, read back with `readRenderTargetPixels`... note `readRenderTargetPixels` does not select the layer; verify by sampling in a shader).
- Exact numeric constants for the Hillaire atmosphere and Planckian locus are recalled, not fetched; verify against the paper / Wikipedia before hard-coding.
- Raptor nozzle exit diameter and tile size are estimates; another researcher's vehicle file should supersede them.
- `TiltShiftEffect.bias` is deprecated [src]; do not use it.
- Cloud reflection in the pool needs a decision (section 5.1 a vs b).
