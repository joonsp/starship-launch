// Sky dome: the view direction is the (unit sphere) vertex position; depth is pinned to the far plane so the dome
// never clips regardless of camera far / mirror-camera oblique planes, and follows the camera for free.
// With SKY_OVERLAY (the below-horizon cumulus layer) the fragment shader writes the cloud's own depth instead, and the
// whole mesh collapses (no fragments at all) unless the camera is inside or above the cumulus slab.
varying vec3 vDir;
#ifdef SKY_OVERLAY
uniform vec4 uReproj;
#endif
void main() {
  vDir = position;
#ifdef SKY_OVERLAY
  if (uReproj.x < 0.5 || cameraPosition.y < uReproj.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
#endif
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}
