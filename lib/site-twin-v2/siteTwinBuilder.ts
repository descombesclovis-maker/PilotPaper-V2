import { createHash } from "node:crypto";
import { fetchGoogleSolarBuildingInsights } from "@/lib/dp-ai-engine/providers/googleSolar";
import { assertSiteTwinGeometry } from "./invariants";
import { lockSiteTwinProperty } from "./propertyLock";
import { assertTwinReadyForAutomaticDocuments } from "./policy";
import { SiteTwinError, asSiteTwinError } from "./errors";
import { downloadGoogleGeoTiff, fetchGoogleSolarDataLayers } from "./googleSolarDataLayers";
import { checkGeometryEngine, reconstructRoofWithGeometryEngine } from "./geometryEngineClient";
import type { SiteTwin, SiteTwinEvidence } from "./types";

function stableTwinId(parcelReference: string, buildingIds: string[]) {
  return `site-${createHash("sha256")
    .update(`${parcelReference}|${[...buildingIds].sort().join("|")}`)
    .digest("hex")
    .slice(0, 20)}`;
}

function sourceEvidence(notes: string[]): SiteTwinEvidence {
  return {
    source: "google-solar",
    confidence: 0.96,
    reference: "Solar API dataLayers DSM",
    notes,
  };
}

/**
 * Canonical Site Twin V2 builder.
 *
 * Important: PV configuration is deliberately NOT an input. Physical roof
 * detection must happen once and cannot change because the user asks for 8, 12
 * or 24 modules.
 */
export async function buildSiteTwin(address: string): Promise<SiteTwin> {
  const property = await lockSiteTwinProperty(address).catch((error) => {
    throw asSiteTwinError(error, "PROPERTY_LOCK_FAILED", "Le verrouillage de la propriété a échoué.");
  });

  const engine = await checkGeometryEngine();
  if (!engine.available) {
    throw new SiteTwinError(
      "GEOMETRY_ENGINE_OFFLINE",
      "Le moteur métrique PilotPaper Geometry Engine doit être démarré avant la reconstruction automatique.",
      { recoverable: true, details: { reason: engine.reason } },
    );
  }

  const [longitude, latitude] = property.addressPoint;
  const layers = await fetchGoogleSolarDataLayers({ latitude, longitude, radiusMeters: 45, pixelSizeMeters: 0.1 });
  const dsm = await downloadGoogleGeoTiff(layers.dsmUrl, "DSM");
  const rgb = layers.rgbUrl
    ? await downloadGoogleGeoTiff(layers.rgbUrl, "RGB").catch(() => undefined)
    : undefined;

  const geometry = await reconstructRoofWithGeometryEngine({
    property,
    source: "google-dsm",
    elevationGeoTiff: dsm,
    imagery: rgb,
  });

  // Google BuildingInsights is now a cross-check only. It can no longer delete
  // or create the canonical physical faces reconstructed from metric elevation.
  let crossCheckNotes: string[] = [];
  try {
    const solar = await fetchGoogleSolarBuildingInsights({ latitude, longitude });
    const googleSegmentCount = solar.solarPotential.roofSegmentStats.length;
    if (googleSegmentCount !== geometry.faces.length) {
      crossCheckNotes = [
        `BuildingInsights annonce ${googleSegmentCount} segments, tandis que le DSM métrique reconstruit ${geometry.faces.length} pans.`,
        "PilotPaper conserve la géométrie métrique ; BuildingInsights reste une source de contrôle seulement.",
      ];
    } else {
      crossCheckNotes = [`BuildingInsights et DSM convergent sur ${geometry.faces.length} pans physiques.`];
    }
  } catch (error) {
    crossCheckNotes = [
      `BuildingInsights indisponible pour le contrôle croisé : ${error instanceof Error ? error.message : "erreur inconnue"}.`,
      "La reconstruction DSM reste utilisable car elle est indépendante de ce contrôle.",
    ];
  }

  const twin: SiteTwin = {
    version: "pilotpaper-site-twin-v2",
    id: stableTwinId(property.parcel.reference, property.targetBuildingIds),
    address,
    normalizedAddress: property.normalizedAddress,
    addressPoint: property.addressPoint,
    parcel: property.parcel,
    buildings: property.buildings,
    targetBuildingIds: property.targetBuildingIds,
    roof: {
      origin: geometry.origin,
      faces: geometry.faces,
      edges: geometry.edges,
    },
    photos: [],
    cameraRegistrations: [],
    sources: {
      lidar: "not-checked",
      orthoReference: layers.rgbUrl ? "Google Solar RGB dataLayer" : undefined,
      googleSolarBuildingCenter: property.addressPoint,
    },
    evidence: [
      ...property.evidence,
      sourceEvidence([
        `DSM Google Solar téléchargé à 0,1 m/pixel lorsque cette résolution est disponible.`,
        `Moteur géométrique : ${geometry.engineVersion}.`,
        ...geometry.diagnostics,
        ...crossCheckNotes,
      ]),
    ],
    confidence: geometry.confidence,
    revision: 1,
  };

  assertSiteTwinGeometry(twin);
  assertTwinReadyForAutomaticDocuments(twin);
  return twin;
}
