import {
  resolveOfficialParcelContext,
  type MetricFrame,
  type OfficialParcelContext,
} from "../context/officialParcel";
import { recoverRoofFromFourClicks, type AssistedRoofQuad } from "./assistedRoofRecovery";
import { resolveTargetBuilding } from "./buildingResolver";
import { sampleBuildingLidarHeights } from "./lidarAltimetry";
import { buildRoofModelFromLidar } from "./roofGeometryEngine";
import type { BuildingFootprint, SiteModel, SiteModelEvidence } from "./types";

export class AssistedRecoveryRequiredError extends Error {
  readonly code = "SITE_MODEL_ASSISTED_RECOVERY_REQUIRED";
  constructor(message: string) {
    super(message);
    this.name = "AssistedRecoveryRequiredError";
  }
}

export function inspectAutomaticSiteModel(model: SiteModel) {
  const issues: string[] = [];
  if (model.mode === "automatic" && (!model.building.polygon.length || (model.building.areaM2 ?? 0) < 12)) {
    issues.push("L'empreinte du bâtiment cible est trop faible ou absente.");
  }
  if (model.roof.coverageConfidence < 0.68) {
    issues.push(`Couverture géométrique LiDAR insuffisante (${Math.round(model.roof.coverageConfidence * 100)} %).`);
  }
  if (!model.roof.planes.length) issues.push("Aucun pan de toiture n'a été extrait.");
  for (const plane of model.roof.planes) {
    if (plane.sampleCount < 8) issues.push(`Pan ${plane.id} : trop peu d'échantillons LiDAR.`);
    if (plane.rmsErrorM > 0.32) issues.push(`Pan ${plane.id} : erreur de plan ${plane.rmsErrorM.toFixed(2)} m trop élevée.`);
    if (plane.slopeDeg < 2 || plane.slopeDeg > 65) issues.push(`Pan ${plane.id} : pente ${plane.slopeDeg.toFixed(1)}° hors domaine V1.`);
    if (plane.projectionQuadLocalM.length !== 4) issues.push(`Pan ${plane.id} : quadrilatère de projection incomplet.`);
  }
  return issues;
}

/** Geometry-first site understanding from an already resolved official parcel. */
export async function buildAutomaticSiteModelFromParcel(parcel: OfficialParcelContext): Promise<SiteModel> {
  const building = await resolveTargetBuilding(parcel);
  const lidar = await sampleBuildingLidarHeights(building);
  const roof = buildRoofModelFromLidar({
    building,
    samples: lidar.samples,
    samplingStepM: lidar.stepM,
    coverage: lidar.coverage,
  });
  const model: SiteModel = {
    version: "pilotpaper-site-model-v1",
    mode: "automatic",
    address: parcel.normalizedAddress,
    parcel: {
      reference: parcel.parcelReference,
      areaM2: parcel.parcelAreaM2,
      geometry: parcel.parcelGeometry,
    },
    building,
    roof,
    evidence: [
      {
        kind: "cadastre",
        source: `APICARTO Cadastre · ${parcel.parcelReference}`,
        confidence: 1,
      },
      {
        kind: "bdtopo",
        source: `BDTOPO_V3:batiment · ${building.id}`,
        confidence: 0.98,
      },
      {
        kind: "lidar-altimetry",
        source: `${lidar.resource} · pas ${lidar.stepM.toFixed(2)} m · ${lidar.samples.length}/${lidar.requestedPointCount} points`,
        confidence: roof.coverageConfidence,
      },
    ],
    warnings: [],
  };
  const issues = inspectAutomaticSiteModel(model);
  if (issues.length) {
    throw new AssistedRecoveryRequiredError(`SiteModel automatique non démontré : ${issues.join(" ")}`);
  }
  return model;
}

/**
 * Assisted mode changes only one thing: the operator identifies the intended
 * physical roof face with four clicks. Metric geometry, slope and obstacles are
 * still derived from LiDAR and validated by the same SiteModel contract.
 *
 * This path deliberately remains usable when BD TOPO is the failing evidence:
 * the four-click polygon becomes the traced support while LiDAR remains the
 * metric source of truth.
 */
export async function buildAssistedSiteModelFromParcel(args: {
  parcel: OfficialParcelContext;
  frame: MetricFrame;
  quadNormalized: AssistedRoofQuad;
  faceId?: string;
}): Promise<SiteModel> {
  const recovered = await recoverRoofFromFourClicks({
    frame: args.frame,
    quadNormalized: args.quadNormalized,
    faceId: args.faceId,
  });

  let building: BuildingFootprint = recovered.support;
  let buildingWarning = "BD TOPO non requis pour la récupération : le support correspond aux 4 coins sélectionnés.";
  let buildingEvidence: SiteModelEvidence = {
    kind: "manual",
    source: "Support sélectionné par 4 coins",
    confidence: 1,
    notes: ["Sélection uniquement ; aucune dimension métrique saisie."],
  };
  try {
    const officialBuilding = await resolveTargetBuilding(args.parcel);
    building = officialBuilding;
    buildingWarning = "Le pan a été sélectionné manuellement ; l'empreinte BD TOPO reste une preuve de contexte uniquement.";
    buildingEvidence = {
      kind: "bdtopo",
      source: `BDTOPO_V3:batiment · ${officialBuilding.id}`,
      confidence: 0.98,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "BD TOPO indisponible";
    buildingWarning = `Support assisté utilisé car BD TOPO n'a pas pu être démontré : ${reason}`;
  }

  const model: SiteModel = {
    version: "pilotpaper-site-model-v1",
    mode: "assisted",
    address: args.parcel.normalizedAddress,
    parcel: {
      reference: args.parcel.parcelReference,
      areaM2: args.parcel.parcelAreaM2,
      geometry: args.parcel.parcelGeometry,
    },
    building,
    roof: recovered.roof,
    evidence: [
      {
        kind: "cadastre",
        source: `APICARTO Cadastre · ${args.parcel.parcelReference}`,
        confidence: 1,
      },
      buildingEvidence,
      {
        kind: "manual",
        source: "4 coins du pan sélectionnés par l'opérateur",
        confidence: 1,
        notes: ["Sélection uniquement ; aucune dimension métrique saisie."],
      },
      {
        kind: "lidar-altimetry",
        source: recovered.evidence.join(" · "),
        confidence: recovered.roof.coverageConfidence,
      },
    ],
    warnings: [
      "SiteModel récupéré en mode assisté après échec ou ambiguïté de l'automatique.",
      buildingWarning,
    ],
  };
  const issues = inspectAutomaticSiteModel(model);
  if (issues.length) {
    throw new AssistedRecoveryRequiredError(`SiteModel assisté non démontré : ${issues.join(" ")}`);
  }
  return model;
}

/**
 * Geometry-first site understanding. No generative vision is permitted to
 * create metric roof geometry in this path.
 */
export async function buildAutomaticSiteModel(address: string): Promise<SiteModel> {
  const parcel = await resolveOfficialParcelContext(address);
  return buildAutomaticSiteModelFromParcel(parcel);
}
