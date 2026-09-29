// Plume bounding proxy (a capped frustum drawn BackSide): passes the local-frame position (for the
// raymarch) and the view-space position (to convert scene depth into a distance along the ray).
out vec3 vLocal;
out vec3 vView;

void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
