// Low-quality composite for arbitrary views (planar reflections): blends the low-res volume over the
// target with blendFunc(ONE, SRC_ALPHA), i.e. dst = L + dst * T. No depth read (the target's depth
// attachment is bound while this draws, so sampling it would be a feedback loop).
uniform highp sampler2D uVol0;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  outColor = texture(uVol0, vUv);
}
