// Full-screen quad / triangle vertex shader (GLSL3). Works with PlaneGeometry(2, 2) and with the
// pmndrs full-screen triangle alike: vUv is derived from the clip-space position.
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
