import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import {
  FIELD_ASPECT,
  reconstructFieldCamera,
  type FovBase,
  type ReconstructedFieldCamera,
} from '@webmidgar/convert';
import type { FieldCamera } from '@webmidgar/formats-field';

/**
 * Übersetzt eine rekonstruierte Field-Kamera in eine Three.js-
 * PerspectiveCamera (Masterplan Phase 3.2). Der Aspect bleibt fest 4:3 —
 * die Einpassung in den Viewport übernimmt ausschließlich der Kompositor.
 */

export interface FieldCameraOptions {
  fovBase: FovBase;
  near: number;
  far: number;
}

export function buildFieldCamera(cam: FieldCamera, opts: FieldCameraOptions): PerspectiveCamera {
  return cameraFromReconstruction(reconstructFieldCamera(cam, { fovBase: opts.fovBase }), opts);
}

export function cameraFromReconstruction(
  recon: ReconstructedFieldCamera,
  opts: { near: number; far: number },
): PerspectiveCamera {
  const camera = new PerspectiveCamera(
    (recon.fovYRad * 180) / Math.PI,
    FIELD_ASPECT,
    opts.near,
    opts.far,
  );
  camera.position.set(...recon.positionScene);
  const basis = new Matrix4().makeBasis(
    new Vector3(...recon.right),
    new Vector3(...recon.up),
    new Vector3(...recon.back),
  );
  camera.quaternion.setFromRotationMatrix(basis);
  camera.updateMatrixWorld(true);
  return camera;
}
