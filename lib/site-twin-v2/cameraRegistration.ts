import { createHash } from "node:crypto";
import { registerPhotoWithGeometryEngine } from "./geometryEngineClient";
import { SITE_TWIN_POLICY } from "./policy";
import { SiteTwinError } from "./errors";
import type { SiteTwin, SiteTwinCameraRegistration, SiteTwinPhoto } from "./types";

export type CameraRegistrationPhoto = {
  id?: string;
  role: SiteTwinPhoto["role"];
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  widthPx: number;
  heightPx: number;
  base64: string;
  digest?: string;
};

function digestPhoto(photo: CameraRegistrationPhoto) {
  return photo.digest ?? createHash("sha256").update(Buffer.from(photo.base64, "base64")).digest("hex");
}

/**
 * Registers a normalized project photograph against a known Site Twin reference
 * image. LightGlue/SuperPoint is preferred by the geometry engine; OpenCV ORB
 * + RANSAC is the local fallback. No generative AI is involved.
 */
export async function registerSiteTwinPhoto(args: {
  twin: SiteTwin;
  photo: CameraRegistrationPhoto;
  referenceImage: { mimeType: string; base64: string };
}) {
  const photoBytes = Buffer.from(args.photo.base64, "base64");
  const referenceBytes = Buffer.from(args.referenceImage.base64, "base64");
  const result = await registerPhotoWithGeometryEngine({
    reference: referenceBytes,
    referenceMimeType: args.referenceImage.mimeType,
    photo: photoBytes,
    photoMimeType: args.photo.mimeType,
  });
  if (result.reprojectionErrorPx > SITE_TWIN_POLICY.maximumAutomaticReprojectionErrorPx) {
    throw new SiteTwinError(
      "CAMERA_REGISTRATION_FAILED",
      `Recalage automatique rejeté (${result.reprojectionErrorPx.toFixed(1)} px).`,
      { recoverable: true, details: result },
    );
  }
  const digest = digestPhoto(args.photo);
  const photoId = args.photo.id ?? `photo-${digest.slice(0, 16)}`;
  const photo: SiteTwinPhoto = {
    id: photoId,
    role: args.photo.role,
    mimeType: args.photo.mimeType,
    widthPx: args.photo.widthPx,
    heightPx: args.photo.heightPx,
    digest,
  };
  const registration: SiteTwinCameraRegistration = {
    photoId,
    status: "automatic",
    homography: result.homography,
    reprojectionErrorPx: result.reprojectionErrorPx,
    evidence: [{
      source: "lightglue",
      confidence: Math.max(0.5, 1 - result.reprojectionErrorPx / 20),
      reference: result.method,
      notes: [
        `${result.inliers}/${result.matches} correspondances validées.`,
        ...result.diagnostics,
      ],
    }],
  };
  const twin: SiteTwin = {
    ...args.twin,
    photos: [...args.twin.photos.filter((item) => item.id !== photoId), photo],
    cameraRegistrations: [
      ...args.twin.cameraRegistrations.filter((item) => item.photoId !== photoId),
      registration,
    ],
    revision: args.twin.revision + 1,
  };
  return { twin, photo, registration };
}
