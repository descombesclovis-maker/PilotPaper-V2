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
  const inlierRatio = result.matches > 0 ? result.inliers / result.matches : 0;
  if (
    result.reprojectionErrorPx > SITE_TWIN_POLICY.maximumAutomaticReprojectionErrorPx
    || result.inliers < SITE_TWIN_POLICY.minimumAutomaticCameraInliers
    || inlierRatio < SITE_TWIN_POLICY.minimumAutomaticCameraInlierRatio
  ) {
    throw new SiteTwinError(
      "CAMERA_REGISTRATION_FAILED",
      [
        `Recalage automatique rejeté (${result.reprojectionErrorPx.toFixed(1)} px).`,
        `${result.inliers}/${result.matches} correspondances cohérentes (${Math.round(inlierRatio * 100)} %).`,
      ].join(" "),
      {
        recoverable: true,
        details: {
          ...result,
          inlierRatio,
          minimumInliers: SITE_TWIN_POLICY.minimumAutomaticCameraInliers,
          minimumInlierRatio: SITE_TWIN_POLICY.minimumAutomaticCameraInlierRatio,
        },
      },
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
  const registrationConfidence = Math.max(
    0.5,
    Math.min(
      0.99,
      0.55
      + Math.min(0.24, inlierRatio * 0.32)
      + Math.min(0.20, Math.max(0, 1 - result.reprojectionErrorPx / SITE_TWIN_POLICY.maximumAutomaticReprojectionErrorPx) * 0.20),
    ),
  );
  const registration: SiteTwinCameraRegistration = {
    photoId,
    status: "automatic",
    homography: result.homography,
    reprojectionErrorPx: result.reprojectionErrorPx,
    evidence: [{
      source: result.method.includes("lightglue") ? "lightglue" : "photogrammetry",
      confidence: registrationConfidence,
      reference: result.method,
      notes: [
        `${result.inliers}/${result.matches} correspondances validées (${Math.round(inlierRatio * 100)} %).`,
        `Erreur médiane de reprojection : ${result.reprojectionErrorPx.toFixed(2)} px.`,
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
