import { createHash } from "node:crypto";
import { fetchGoogleSolarBuildingInsights } from "@/lib/dp-ai-engine/providers/googleSolar";
import { resolveAdvancedRoofTruth, type AdvancedRoofFacet } from "@/lib/geometry/advanced-roof-truth";
import { buildAdvancedRoofMetricFallback } from "./advancedRoofFallback";
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
import type { SiteTwin, SiteTwinEvidence, SiteTwinEvidenceSource, SiteTwinRoofFace } from "./types";

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

function angularDistance(a: number, b: number) {
  const delta = Math.abs((a - b) % 360);
  return Math.min(delta, 360 - delta);
}

function facetPair(local: SiteTwinRoofFace, remote: AdvancedRoofFacet) {
  const azimuthDelta = remote.azimuthDeg == null ? null : angularDistance(local.azimuthDeg, remote.azimuthDeg);
  const slopeDelta = remote.slopeDeg == null ? null : Math.abs(local.slopeDeg - remote.slopeDeg);
  const areaRelativeError = remote.areaM2 == null || remote.areaM2 <= 0
    ? null
    : Math.abs(local.areaM2 - remote.areaM2) / Math.max(local.areaM2, remote.areaM2);
  const components = [
    azimuthDelta == null ? null : azimuthDelta / 25,
    slopeDelta == null ? null : slopeDelta / 10,
    areaRelativeError == null ? null : areaRelativeError / 0.4,
  ].filter((value): value is number => value !== null);
  const score = components.length ? components.reduce((sum, value) => sum + value, 0) / components.length : Number.POSITIVE_INFINITY;
  const close = components.length > 0
    && (azimuthDelta == null || azimuthDelta <= 15)
    && (slopeDelta == null || slopeDelta <= 7)
    && (areaRelativeError == null || areaRelativeError <= 0.30);
  return { azimuthDelta, slopeDelta, areaRelativeError, score, close, metricCount: components.length };
}

function compareAdvancedFacets(localFaces: SiteTwinRoofFace[], remoteFacets: AdvancedRoofFacet[]) {
  const notes: string[] = [];
  const unused = new Set(remoteFacets.map((_, index) => index));
  let matched = 0;
  let closeMatched = 0;
  let metricMatches = 0;

  for (const local of localFaces) {
    let bestIndex: number | null = null;
    let best = { score: Number.POSITIVE_INFINITY, close: false, metricCount: 0, azimuthDelta: null as number | null, slopeDelta: null as number | null, areaRelativeError: null as number | null };
    for (const index of unused) {
      const candidate = facetPair(local, remoteFacets[index]!);
      if (candidate.score < best.score) {
        bestIndex = index;
        best = candidate;
      }
    }
    if (bestIndex == null || !Number.isFinite(best.score)) continue;
    unused.delete(bestIndex);
    matched += 1;
    metricMatches += best.metricCount > 0 ? 1 : 0;
    if (best.close) closeMatched += 1;
    const remote = remoteFacets[bestIndex]!;
    notes.push([
      `Pan ${local.displayLabel} ↔ facette distante ${remote.id}`,
      best.azimuthDelta == null ? "azimut n/a" : `Δazimut ${best.azimuthDelta.toFixed(1)}°`,
      best.slopeDelta == null ? "pente n/a" : `Δpente ${best.slopeDelta.toFixed(1)}°`,
      best.areaRelativeError == null ? "surface n/a" : `Δsurface ${(best.areaRelativeError * 100).toFixed(0)} %`,
      best.close ? "accord géométrique" : "écart à contrôler",
    ].join(" · "));
  }

  const comparable = Math.min(localFaces.length, remoteFacets.length);
  const closeRatio = comparable > 0 ? closeMatched / comparable : 0;
  let confidenceDelta = 0;
  if (metricMatches > 0 && localFaces.length === remoteFacets.length && closeRatio >= 0.75) confidenceDelta = 0.025;
  if (metricMatches > 0 && (Math.abs(localFaces.length - remoteFacets.length) >= 2 || closeRatio < 0.4)) confidenceDelta = -0.04;

  return { notes, matched, closeMatched, metricMatches, closeRatio, confidenceDelta };
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
    throw new SiteTwinError(
      "GEOMETRY_RECONSTRUCTION_FAILED",
      "Aucune source métrique locale n'a permis de reconstruire automatiquement la toiture.",
      { recoverable: true, details: { failures } },
    );
  }

  return { geometry, googleLayers, googleRgb, lidarReference, failures };
}

function failuresFrom(error: unknown) {
  if (error instanceof SiteTwinError && Array.isArray(error.details?.failures)) {
    return (error.details.failures as unknown[]).map((item) => String(item));
  }
  return [error instanceof Error ? error.message : "Échec inconnu de la reconstruction métrique locale."];
}

/** Canonical Site Twin V2 builder. PV configuration never changes roof truth. */
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

  const localRoofPromise = reconstructMetricRoof(property)
    .then((value) => ({ ok: true as const, value }))
    .catch((error) => ({ ok: false as const, error }));
  const [localRoof, terrainElevationM, advancedRoof] = await Promise.all([
    localRoofPromise,
    sampleIgnTerrainElevation(property),
    resolveAdvancedRoofTruth(address),
  ]);

  let metricRoof: Awaited<ReturnType<typeof reconstructMetricRoof>>;
  if (localRoof.ok) {
    metricRoof = localRoof.value;
  } else {
    const fallback = buildAdvancedRoofMetricFallback({ property, advanced: advancedRoof, terrainElevationM });
    if (!fallback) {
      throw new SiteTwinError(
        "GEOMETRY_RECONSTRUCTION_FAILED",
        "Aucune source géométrique vérifiable n'a permis de reconstruire automatiquement la toiture. PilotPaper refuse d'inventer les pans.",
        {
          recoverable: true,
          details: {
            failures: [
              ...failuresFrom(localRoof.error),
              ...(advancedRoof.warnings.length ? advancedRoof.warnings : ["Moteur géométrique avancé : facettes géoréférencées/pentes insuffisantes."]),
            ],
          },
        },
      );
    }
    metricRoof = {
      geometry: fallback,
      googleLayers: undefined,
      googleRgb: undefined,
      lidarReference: undefined,
      failures: failuresFrom(localRoof.error),
    };
  }

  const { geometry, googleLayers, lidarReference, failures } = metricRoof;
  const [longitude, latitude] = property.addressPoint;

  let crossCheckNotes: string[] = [];
  try {
    const solar = await fetchGoogleSolarBuildingInsights({ latitude, longitude });
    const googleSegmentCount = solar.solarPotential.roofSegmentStats.length;
    if (googleSegmentCount !== geometry.faces.length) {
      crossCheckNotes = [
        `BuildingInsights annonce ${googleSegmentCount} segments, la reconstruction primaire en démontre ${geometry.faces.length}.`,
        "PilotPaper conserve la géométrie primaire ; BuildingInsights reste un contrôle secondaire.",
      ];
    } else {
      crossCheckNotes = [`BuildingInsights et la reconstruction primaire convergent sur ${geometry.faces.length} pans physiques.`];
    }
  } catch (error) {
    crossCheckNotes = [
      `BuildingInsights indisponible pour le contrôle croisé : ${error instanceof Error ? error.message : "erreur inconnue"}.`,
      "La reconstruction primaire reste indépendante de ce contrôle.",
    ];
  }

  const advancedIsPrimary = geometry.source === "advanced-roof-model";
  const advancedComparison = advancedRoof.usable && !advancedIsPrimary
    ? compareAdvancedFacets(geometry.faces, advancedRoof.facets)
    : { notes: [] as string[], matched: 0, closeMatched: 0, metricMatches: 0, closeRatio: 0, confidenceDelta: 0 };

  const adjustedGeometryConfidence = Math.max(0, Math.min(0.99, geometry.confidence + advancedComparison.confidenceDelta));
  const tiles3d = await checkGooglePhotorealistic3dTiles();
  const primaryEvidenceSource: SiteTwinEvidenceSource = geometry.source === "google-dsm"
    ? "google-solar-dsm"
    : geometry.source === "ign-mns"
      ? "ign-mns"
      : geometry.source === "ign-lidar"
        ? "ign-lidar-hd"
        : geometry.source === "advanced-roof-model"
          ? "advanced-roof-model"
          : "photogrammetry";

  const evidence: SiteTwinEvidence[] = [
    ...property.evidence,
    sourceEvidence(
      primaryEvidenceSource,
      geometry.source,
      adjustedGeometryConfidence,
      [
        `Source géométrique primaire : ${geometry.source}.`,
        `Moteur géométrique : ${geometry.engineVersion}.`,
        ...geometry.diagnostics,
        ...crossCheckNotes,
        ...(terrainElevationM != null ? [`Terrain IGN : ${terrainElevationM.toFixed(2)} m.`] : ["Terrain officiel non disponible : toute hauteur absolue non démontrée restera non cotée."]),
        ...(failures.length ? [`Sources locales essayées avant succès : ${failures.join(" | ")}`] : []),
      ],
    ),
  ];

  if (advancedRoof.available && !advancedIsPrimary) {
    const countConverges = advancedRoof.usable && advancedRoof.roofFacetCount === geometry.faces.length;
    const metricConverges = advancedComparison.metricMatches > 0 && advancedComparison.closeRatio >= 0.75;
    evidence.push(sourceEvidence(
      "advanced-roof-model",
      advancedRoof.projectId ? `advanced-project:${advancedRoof.projectId}` : "advanced-project",
      advancedRoof.usable ? (countConverges && (advancedComparison.metricMatches === 0 || metricConverges) ? 0.92 : 0.74) : 0.45,
      [
        advancedRoof.usable
          ? `Modèle toiture distant exploitable : ${advancedRoof.roofFacetCount} pans.`
          : "Modèle toiture distant joignable mais sans facettes suffisamment exploitables.",
        advancedRoof.usable
          ? (countConverges
              ? `Comptage indépendant convergent avec les ${geometry.faces.length} pans métriques PilotPaper.`
              : `Comptage indépendant divergent : ${advancedRoof.roofFacetCount} pans distants contre ${geometry.faces.length} pans métriques PilotPaper.`)
          : "PilotPaper conserve sa reconstruction métrique locale comme vérité géométrique.",
        ...(advancedComparison.notes.length ? advancedComparison.notes : ["Les propriétés facette par facette ne sont pas suffisamment structurées pour un rapprochement métrique complet."]),
        advancedComparison.confidenceDelta > 0
          ? "L'accord facette par facette renforce légèrement la confiance géométrique du Site Twin."
          : advancedComparison.confidenceDelta < 0
            ? "Le désaccord facette par facette réduit la confiance et doit être résolu avant automatisation aveugle."
            : "Le contrôle distant reste neutre dans le score de confiance.",
        advancedRoof.autoDesignAvailable
          ? "Un modèle automatique de projet distant est disponible comme preuve secondaire."
          : "Aucun modèle automatique distant exploitable n'est encore disponible.",
        ...(advancedRoof.warnings.length ? [`Le moteur distant a signalé ${advancedRoof.warnings.length} avertissement(s) interne(s), conservé(s) hors interface utilisateur.`] : []),
      ],
    ));
  }

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
      lidar: geometry.source === "ign-lidar" || geometry.source === "ign-mns" ? "available" : geometry.source === "advanced-roof-model" ? "unavailable" : "not-checked",
      lidarReference,
      terrainElevationM,
      orthoReference: googleLayers?.rgbUrl ? "Google Solar RGB dataLayer" : undefined,
      googleSolarBuildingCenter: property.addressPoint,
      googleDsmReference: googleLayers?.dsmUrl,
      google3dTilesReference: tiles3d.available ? tiles3d.reference : undefined,
      geometryEngineVersion: geometry.engineVersion,
      geometryPrimarySource: geometry.source,
      advancedRoofProjectId: advancedRoof.projectId ?? undefined,
      advancedRoofFacetCount: advancedRoof.roofFacetCount || undefined,
      advancedRoofAutoDesignAvailable: advancedRoof.autoDesignAvailable || undefined,
    },
    evidence,
    confidence: adjustedGeometryConfidence,
    revision: 1,
  };

  assertSiteTwinGeometry(twin);
  assertTwinReadyForAutomaticDocuments(twin);
  return twin;
}
