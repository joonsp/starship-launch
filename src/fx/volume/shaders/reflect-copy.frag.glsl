// Planar-reflection view, step 0: copy the mirror target's opaque colour and linear depth into the volume pass's
// own buffer (rgb = colour, a = linear view depth in metres). The progressive refinement then re-composites the
// steam over this copy every frame while the target itself keeps its depth attachment for the march.
uniform highp sampler2D uSrc;
uniform highp sampler2D uSrcDepth;
uniform float uNear;
uniform float uFar;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  float d = texelFetch(uSrcDepth, q, 0).r;
  float z = d * 2.0 - 1.0;
  float lin = d >= 1.0 ? uFar : (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  outColor = vec4(texelFetch(uSrc, q, 0).rgb, lin);
}
