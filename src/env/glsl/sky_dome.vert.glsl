// Sky dome: the view direction is the (unit sphere) vertex position; depth is pinned to the far plane so the dome
// never clips regardless of camera far / mirror-camera oblique planes, and follows the camera for free.
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}
