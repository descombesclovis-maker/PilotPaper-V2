import { createHash } from "node:crypto";
import { fetchGoogleSolarBuildingInsights } from "@/lib/dp-ai-engine/providers/googleSolar";
import { assertSiteTwinGeometry } from "./invariants";
import { lockSiteTwinProperty } from "./propertyLock";
import { assertTwinReadyForAutomaticDocuments } from "./policy";
import { SiteTwinError, asSiteTwinError } from "./errors";
import { downloadGoogleGeoTiff, fetchGoogleSolarDataLayers } from "./googleSolarDataLayers";
import { discoverIgnCopcTiles, sampleIgnLidarSurface } from "./ignLidar";
import { sampleIgnTerrainElevation } from "./ignTerrain";
import { checkGooglePhotorealistic3dTiles } from "./googlePhotorealistic3d";
import {
  checkGeometryEngine,
  reconstructRoofWithGeometryEngine,
  type GeometryEngineRoofResult,
} from "./geometryEngineClient";
import type { SiteTwin, SiteTwinEvidence, SiteTwinEvidenceSource } from "./types";

function stableTwinId(parcelReference: string, buildingIds: string[]) {
  return `site-${createHash("sha256")
    .update(`${parcelReference}|${[...buildingIds].sort().join("|")}`)
    .digest("hex")
    .slice(0, 20)}`;
}

function sourceEvidence(
  source: SiteTwinEvidenceSource,
  reference: string,
  confidence: number,
  notes: string[],
): SiteTwinEvidence {
  return { source, confidence, reference, notes };
}

async function reconstructMetricRoof(property: Awaited<ReturnType<typeof lockSiteTwinProperty>>) {
  const [longitude, latitude] = property.addressPoint;
  const failures: string[] = [];
  let geometry: GeometryEngineRoofResult | undefined;
  let googleLayers: Awaited<ReturnType<typeof fetchGoogleSolarDataLayers>> | undefined;
  let googleRgb: Uint8Array | undefined;
  let lidarReference: string | undefined;

  try {
    googleLayers = await fetchGoogleSolarDataLayers({ latitude, longitude, radiusMeters: 45, pixelSizeMeters: 0.1 });
    const dsm = await downloadGoogleGeoTiff(googleLayers.dsmUrl, "DSM");
    googleRgb = googleLayers.rgbUrl
      ? await downloadGoogleGeoTiff(googleLayers.rgbUrl, "RGB").catch(() => undefined)
      : undefined;
    geometry = await reconstructRoofWithGeometryEngine({
      property,
      source: "google-dsm",
      elevationGeoTiff: dsm,
      imagery: googleRgb,
    });
  } catch (error) {
    failures.push(`Google DSM : ${error instanceof Error ? error.message : "échec inconnu"}`);
  }

  if (!geometry) {
    try {
      const tiles = await discoverIgnCopcTiles(property);
      if (!tiles.length) throw new Error("aucune dalle COPC trouvée par le WFS IGN");
      lidarReference = tiles.map((tile) => tile.url).join(";");
      geometry = await reconstructRoofWithGeometryEngine({
        property,
        source: "ign-lidar",
        copcTiles: tiles,
      });
    } catch (error) {
      failures.push(`IGN COPC : ${error instanceof Error ? error.message : "échec inconnu"}`);
    }
  }

  if (!geometry) {
    try {
      const samples = await sampleIgnLidarSurface(property);
      lidarReference = "ign_lidar_hd_mnx_multi_wld";
      geometry = await reconstructRoofWithGeometryEngine({
        property,
        source: "ign-mns",
        sampledPoints: samples,
      });
    } catch (error) {
      failures.push(`IGN MNX : ${error instanceof Error ? error.message : "échec inconnu"}`);
    }
  }

  if (!geometry) {
    throw new SiteTwinError(
      "GEOMETRY_RECONSTRUCTION_FAILED",
      "Aucune source métrique n'a permis de reconstruire automatiquement la toiture. PilotPaper refuse d'inventer les pans.",
      { recoverable: true, details: { failures } },
    );
  }

  return { geometry, googleLayers, googleRgb, lidarReference, failures };
}

/**
 * Canonical Site Twin V2 builder. PV configuration is deliberately NOT an
 * input: changing the requested modules can never change physical roof truth.
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

  const [{ geometry, googleLayers, lidarReference, failures }, terrainElevationM] = await Promise.all([
    reconstructMetricRoof(property),
    sampleIgnTerrainElevation(property),
  ]);
  const [longitude, latitude] = property.addressPoint;

  let crossCheckNotes: string[] = [];
  try {
    const solar = await fetchGoogleSolarBuildingInsights({ latitude, longitude });
    const googleSegmentCount = solar.solarPotential.roofSegmentStats.length;
    if (googleSegmentCount !== geometry.faces.length) {
      crossCheckNotes = [
        `BuildingInsights annonce ${googleSegmentCount} segments, la reconstruction métrique en démontre ${geometry.faces.length}.`,
        "PilotPaper conserve la géométrie métrique ; BuildingInsights reste un contrôle secondaire.",
      ];
    } else {
      crossCheckNotes = [`BuildingInsights et la reconstruction métrique convergent sur ${geometry.faces.length} pans physiques.`];
    }
  } catch (error) {
    crossCheckNotes = [
      `BuildingInsights indisponible pour le contrôle croisé : ${error instanceof Error ? error.message : "erreur inconnue"}.`,
      "La reconstruction métrique reste indépendante de ce contrôle.",
    ];
  }

  const tiles3d = await checkGooglePhotorealistic3dTiles();
  const primaryEvidenceSource: SiteTwinEvidenceSource = geometry.source === "google-dsm"
    ? "google-solar-dsm"
    : geometry.source === "ign-mns"
      ? "ign-mns"
      : geometry.source === "ign-lidar"
        ? "ign-lidar-hd"
        : "photogrammetry";

  const evidence: SiteTwinEvidence[] = [
    ...property.evidence,
    sourceEvidence(
      primaryEvidenceSource,
      geometry.source,
      geometry.confidence,
      [
        `Source géométrique primaire : ${geometry.source}.`,
        `Moteur géométrique : ${geometry.engineVersion}.`,
        ...geometry.diagnostics,
        ...crossCheckNotes,
        ...(terrainElevationM != null ? [`Terrain IGN MNT : ${terrainElevationM.toFixed(2)} m.`] : ["Terrain MNT non disponible : DP3 métrique devra refuser toute hauteur inventée."]),
        ...(failures.length ? [`Sources essayées avant succès : ${failures.join(" | ")}`] : []),
      ],
    ),
  ];
  if (tiles3d.available) {
    evidence.push(sourceEvidence(
      "google-3d-tiles",
      tiles3d.reference,
      0.65,
      [
        "Photorealistic 3D Tiles activé uniquement pour contrôle visuel/UX.",
        "Cette source n'est jamais autorisée à changer la parcelle, le bâtiment ou la géométrie métrique du toit.",
      ],
    ));
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
      lidar: geometry.source === "ign-lidar" || geometry.source === "ign-mns" ? "available" : "not-checked",
      lidarReference,
      terrainElevationM,
      orthoReference: googleLayers?.rgbUrl ? "Google Solar RGB dataLayer" : undefined,
      googleSolarBuildingCenter: property.addressPoint,
      googleDsmReference: googleLayers?.dsmUrl,
      google3dTilesReference: tiles3d.available ? tiles3d.reference : undefined,
      geometryEngineVersion: geometry.engineVersion,
      geometryPrimarySource: geometry.source,
    },
    evidence,
    confidence: geometry.confidence,
    revision: 1,
  };

  assertSiteTwinGeometry(twin);
  assertTwinReadyForAutomaticDocuments(twin);
  return twin;
}
