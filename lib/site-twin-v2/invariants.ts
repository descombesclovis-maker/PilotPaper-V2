import type { PvFaceEligibility, PvLayoutSnapshot, SiteTwin } from "./types";

function unique(values: string[]) {
  return new Set(values).size === values.length;
}

export function assertSiteTwinGeometry(twin: SiteTwin) {
  if (twin.version !== "pilotpaper-site-twin-v2") throw new Error("Site Twin V2 requis.");
  if (!twin.targetBuildingIds.length) throw new Error("Aucun bâtiment cible verrouillé.");
  if (!twin.roof.faces.length) throw new Error("Aucun pan physique de toiture détecté.");

  const buildingIds = new Set(twin.buildings.map((building) => building.id));
  if (!twin.targetBuildingIds.every((id) => buildingIds.has(id))) {
    throw new Error("Le Site Twin référence un bâtiment cible absent du modèle.");
  }

  const faceIds = twin.roof.faces.map((face) => face.id);
  if (!unique(faceIds)) throw new Error("Les identifiants physiques des pans doivent être uniques.");
  const displayLabels = twin.roof.faces.map((face) => face.displayLabel);
  if (!unique(displayLabels)) throw new Error("Les libellés visibles des pans doivent être uniques dans une révision.");

  for (const face of twin.roof.faces) {
    if (!buildingIds.has(face.buildingId)) throw new Error(`Pan ${face.id} rattaché à un bâtiment inconnu.`);
    if (face.polygonLocalM.length < 3) throw new Error(`Pan ${face.id} sans polygone physique exploitable.`);
    if (!(face.areaM2 > 0)) throw new Error(`Pan ${face.id} sans surface physique exploitable.`);
    if (!Number.isFinite(face.slopeDeg) || face.slopeDeg < 0 || face.slopeDeg >= 90) {
      throw new Error(`Pan ${face.id} avec pente invalide.`);
    }
  }

  return twin;
}

/**
 * A PV request may mark faces as incompatible, but it can never delete real
 * physical faces from the Site Twin. This invariant directly prevents the
 * regression where an L-shaped roof lost two slopes because 2x6 panels did not
 * fit or because DP3 could not draw a section yet.
 */
export function assertEligibilityDoesNotRedefineRoof(
  twin: SiteTwin,
  eligibility: PvFaceEligibility[],
) {
  const physicalFaceIds = new Set(twin.roof.faces.map((face) => face.id));
  const eligibilityIds = new Set(eligibility.map((entry) => entry.faceId));

  for (const faceId of eligibilityIds) {
    if (!physicalFaceIds.has(faceId)) throw new Error(`Éligibilité PV pour un pan physique inconnu : ${faceId}.`);
  }

  if (eligibilityIds.size !== physicalFaceIds.size) {
    throw new Error(
      "Chaque pan physique doit conserver un état d'éligibilité explicite ; les pans incompatibles ne doivent jamais disparaître.",
    );
  }

  return eligibility;
}

export function assertLayoutUsesOneTwin(twin: SiteTwin, layout: PvLayoutSnapshot) {
  if (layout.siteTwinId !== twin.id || layout.siteTwinRevision !== twin.revision) {
    throw new Error("Le calepinage ne correspond pas à la révision du Site Twin utilisée pour les documents.");
  }

  const faceIds = new Set(twin.roof.faces.map((face) => face.id));
  for (const selectedId of layout.selectedFaceIds) {
    if (!faceIds.has(selectedId)) throw new Error(`Le calepinage sélectionne un pan inconnu : ${selectedId}.`);
  }
  for (const module of layout.modules) {
    if (!faceIds.has(module.faceId)) throw new Error(`Module ${module.moduleIndex} placé sur un pan inconnu.`);
  }

  return layout;
}
