import type { PvLayoutSnapshot, SiteTwin } from "./types";
import { SiteTwinError } from "./errors";

export const SITE_TWIN_POLICY = Object.freeze({
  minimumFaceConfidence: 0.72,
  minimumTwinConfidence: 0.78,
  maximumAutomaticReprojectionErrorPx: 8,
  preferredGutterClearanceMm: 300,
  minimumPhysicalFaceAreaM2: 2,
  minimumRoofSlopeDeg: 0,
  maximumRoofSlopeDeg: 85,
  maximumAutomaticBuildingDistanceFromAddressM: 35,
  maximumSameHouseComponentGapM: 0.45,
  neverAllowGoogleToMoveParcel: true,
  neverHidePhysicalFacesForPvCompatibility: true,
  neverAllowGenerativeAiToChoosePanelCoordinates: true,
  neverAllowRendererToRedetectProperty: true,
  requireNormalizedPhotosBeforeVision: true,
  requireOneTwinRevisionAcrossAllPieces: true,
  requireExactPanelCount: true,
  requireRegressionFixtureForConfirmedFailure: true,
});

/**
 * These are architectural restrictions, not UI preferences. They deliberately
 * fail closed when a renderer or layout tries to bypass the canonical Site Twin.
 */
export function assertTwinReadyForAutomaticDocuments(twin: SiteTwin) {
  if (twin.version !== "pilotpaper-site-twin-v2") {
    throw new SiteTwinError("ROOF_GEOMETRY_LOW_CONFIDENCE", "La génération automatique exige Site Twin V2.");
  }
  if (!twin.parcel.reference || twin.parcel.polygonLonLat.length < 3) {
    throw new SiteTwinError("PROPERTY_LOCK_FAILED", "La parcelle cadastrale n'est pas verrouillée.");
  }
  if (!twin.targetBuildingIds.length) {
    throw new SiteTwinError("PROPERTY_LOCK_FAILED", "Aucun bâtiment cible n'est verrouillé.");
  }
  if (!twin.roof.faces.length) {
    throw new SiteTwinError("GEOMETRY_RECONSTRUCTION_FAILED", "Aucun pan physique de toiture n'a été reconstruit.");
  }
  if (twin.confidence < SITE_TWIN_POLICY.minimumTwinConfidence) {
    throw new SiteTwinError(
      "ROOF_GEOMETRY_LOW_CONFIDENCE",
      `Confiance Site Twin insuffisante (${Math.round(twin.confidence * 100)} %).`,
      { recoverable: true, details: { confidence: twin.confidence } },
    );
  }
  for (const face of twin.roof.faces) {
    if (face.areaM2 < SITE_TWIN_POLICY.minimumPhysicalFaceAreaM2) {
      throw new SiteTwinError("ROOF_FACE_COUNT_SUSPECT", `Pan ${face.displayLabel} trop petit pour être accepté automatiquement.`);
    }
    if (face.confidence < SITE_TWIN_POLICY.minimumFaceConfidence) {
      throw new SiteTwinError(
        "ROOF_GEOMETRY_LOW_CONFIDENCE",
        `Pan ${face.displayLabel} insuffisamment démontré (${Math.round(face.confidence * 100)} %).`,
        { recoverable: true, details: { faceId: face.id, confidence: face.confidence } },
      );
    }
  }
  return twin;
}

export function assertLayoutPolicy(twin: SiteTwin, layout: PvLayoutSnapshot) {
  if (layout.siteTwinId !== twin.id || layout.siteTwinRevision !== twin.revision) {
    throw new SiteTwinError("PV_LAYOUT_INVALID", "Le calepinage ne correspond pas à la révision Site Twin active.");
  }
  if (SITE_TWIN_POLICY.requireExactPanelCount && layout.modules.length !== layout.configuration.panelCount) {
    throw new SiteTwinError(
      "PV_LAYOUT_INVALID",
      `Le calepinage contient ${layout.modules.length} modules au lieu de ${layout.configuration.panelCount}.`,
    );
  }
  const physicalFaces = new Set(twin.roof.faces.map((face) => face.id));
  const eligibilityFaces = new Set(layout.eligibility.map((entry) => entry.faceId));
  if (SITE_TWIN_POLICY.neverHidePhysicalFacesForPvCompatibility && eligibilityFaces.size !== physicalFaces.size) {
    throw new SiteTwinError(
      "PV_LAYOUT_INVALID",
      "Chaque pan physique doit conserver un état d'éligibilité, même lorsqu'il est incompatible.",
    );
  }
  for (const faceId of physicalFaces) {
    if (!eligibilityFaces.has(faceId)) {
      throw new SiteTwinError("PV_LAYOUT_INVALID", `Le pan physique ${faceId} a disparu de l'éligibilité PV.`);
    }
  }
  for (const placedModule of layout.modules) {
    if (!physicalFaces.has(placedModule.faceId)) {
      throw new SiteTwinError("PV_LAYOUT_INVALID", `Module ${placedModule.moduleIndex} placé sur un pan inexistant.`);
    }
  }
  return layout;
}

export function assertCameraRegistrationForDp6(twin: SiteTwin, photoId: string) {
  const registration = twin.cameraRegistrations.find((item) => item.photoId === photoId);
  if (!registration || registration.status === "unregistered" || !registration.homography) {
    throw new SiteTwinError(
      "CAMERA_REGISTRATION_FAILED",
      "DP6 refuse toute insertion tant que la photographie n'est pas recalée sur le Site Twin.",
      { recoverable: true, details: { photoId } },
    );
  }
  if (
    registration.reprojectionErrorPx != null
    && registration.reprojectionErrorPx > SITE_TWIN_POLICY.maximumAutomaticReprojectionErrorPx
  ) {
    throw new SiteTwinError(
      "CAMERA_REGISTRATION_FAILED",
      `Erreur de reprojection trop élevée (${registration.reprojectionErrorPx.toFixed(1)} px).`,
      { recoverable: true, details: { photoId, reprojectionErrorPx: registration.reprojectionErrorPx } },
    );
  }
  return registration;
}
