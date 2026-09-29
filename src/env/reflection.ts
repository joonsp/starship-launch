// Planar reflection of the world in the water plane (y = WATER_Y). One mirror render serves every pool and the
// near ocean. The virtual-camera / texture-matrix / oblique-near-plane maths follows three's Reflector.
import * as THREE from 'three';

export const WATER_Y = -0.03;

export class PlanarReflection {
  readonly target: THREE.WebGLRenderTarget;
  readonly textureMatrix = new THREE.Matrix4();
  readonly camera = new THREE.PerspectiveCamera();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y);
  private cw = 0; private ch = 0;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true,
      // core's volume pass marches the mirrored steam up to this opaque depth (see fx/volume renderReflection)
      depthTexture: new THREE.DepthTexture(4, 4),
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  }

  /** Match the reflection resolution to the drawing buffer * scale. Returns true when it changed. */
  resize(bufW: number, bufH: number, scale: number): boolean {
    const w = Math.max(64, Math.round(bufW * scale)), h = Math.max(64, Math.round(bufH * scale));
    if (w === this.cw && h === this.ch) return false;
    this.cw = w; this.ch = h;
    this.target.setSize(w, h);
    return true;
  }

  /**
   * Position the mirror camera for `main` and refresh the texture matrix. Returns false when the camera is below
   * the water plane (no reflection needed).
   */
  prepare(main: THREE.PerspectiveCamera): boolean {
    main.updateMatrixWorld();
    const camPos = new THREE.Vector3().setFromMatrixPosition(main.matrixWorld);
    if (camPos.y <= WATER_Y + 0.02) return false;
    const normal = new THREE.Vector3(0, 1, 0);
    const planePt = new THREE.Vector3(0, WATER_Y, 0);
    const rot = new THREE.Matrix4().extractRotation(main.matrixWorld);
    const view = new THREE.Vector3().subVectors(planePt, camPos);
    view.reflect(normal).negate().add(planePt);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(camPos);
    const target = new THREE.Vector3().subVectors(planePt, look).reflect(normal).negate().add(planePt);
    const vc = this.camera;
    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    vc.lookAt(target);
    vc.near = main.near; vc.far = main.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(main.projectionMatrix);
    vc.projectionMatrixInverse.copy(main.projectionMatrixInverse);

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);

    // Nothing below the water plane may appear in the reflection (the trench, the terrain's underside). This used
    // to be an oblique near plane; the integrator replaced it by a WORLD-space clip plane that core's renderView
    // applies as renderer.clippingPlanes, because the volume pass linearises the mirror depth with the standard
    // near/far formula, which an oblique projection breaks (steam would be composited at the wrong depth).
    this.plane.setFromNormalAndCoplanarPoint(normal, planePt);
    vc.userData.clipPlane = this.plane;
    return true;
  }

  dispose(): void { this.target.dispose(); }
}
