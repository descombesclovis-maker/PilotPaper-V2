import { resolveOfficialParcelContext } from "../context/officialParcel";
import { resolveTargetBuilding } from "./buildingResolver";
import { sampleBuildingLidarHeights } from "./lidarAltimetry";
import { buildRoofModelFromLidar } from "./roofGeometryEngine";
import type { SiteModel } from "./types";

export class AssistedRecoveryRequiredError extends Error {
  readonly code = "SITE_MODEL_ASSISTED_RECOVERY_REQUIRED";
  constructor(message: string) {
    super(message);
    this.name = "AssistedRecoveryRequiredError";
  }
}

export function inspectAutomaticSiteModel(model: SiteModel) {
  const issues: string[] = [];
  if (!model.building.polygon.length || (model.building.areaM2 ?? 0) < 12) {
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

/**
 * Geometry-first site understanding. No generative vision is permitted to
 * create metric roof geometry in this path.
 */
export async function buildAutomaticSiteModel(address: string): Promise<SiteModel> {
  const parcel = await resolveOfficialParcelContext(address);
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
