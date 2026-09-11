import {
  fromWebMercator,
  toWebMercator,
  type LonLat,
  type MetricFrame,
} from "../context/officialParcel";
import { assertValidProjectiveQuad } from "../geometry/panelProjection";
import type { Point2D } from "../types";
import { samplePolygonLidarHeights } from "./lidarAltimetry";
import { buildRoofModelFromLidar } from "./roofGeometryEngine";
import type { BuildingFootprint, SiteRoofModel } from "./types";

export type AssistedRoofQuad = [Point2D, Point2D, Point2D, Point2D];

function normalized(point: Point2D) {
  return Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1
    && point.y >= 0 && point.y <= 1;
}

function orderQuadAroundCentroid(quad: AssistedRoofQuad): AssistedRoofQuad {
  const centroid = {
    x: quad.reduce((sum, point) => sum + point.x, 0) / 4,
    y: quad.reduce((sum, point) => sum + point.y, 0) / 4,
  };
  const ordered = [...quad].sort((a, b) => (
    Math.atan2(a.y - centroid.y, a.x - centroid.x)
    - Math.atan2(b.y - centroid.y, b.x - centroid.x)
  ));
  return ordered as AssistedRoofQuad;
}

export function normalizedPointToLonLat(point: Point2D, frame: MetricFrame): LonLat {
  if (!normalized(point)) throw new Error("Assisted Recovery : coin hors de l'image métrique.");
  const x = frame.minX + point.x * (frame.maxX - frame.minX);
  const y = frame.maxY - point.y * (frame.maxY - frame.minY);
  const geo = fromWebMercator(x, y);
  return [geo.longitude, geo.latitude];
}

export function assistedQuadToLonLat(quad: AssistedRoofQuad, frame: MetricFrame) {
  if (quad.length !== 4 || !quad.every(normalized)) {
    throw new Error("Assisted Recovery : exactement quatre coins normalisés sont requis.");
  }
  const ordered = orderQuadAroundCentroid(quad);
  assertValidProjectiveQuad(ordered);
  return ordered.map((point) => normalizedPointToLonLat(point, frame)) as [LonLat, LonLat, LonLat, LonLat];
}

function polygonAreaM2(polygon: LonLat[]) {
  const points = polygon.map(([lon, lat]) => toWebMercator(lon, lat));
  let area2 = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area2 += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area2) / 2;
}

function polygonCentroid(polygon: LonLat[]): LonLat {
  const points = polygon.map(([lon, lat]) => toWebMercator(lon, lat));
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const geo = fromWebMercator(meanX, meanY);
  return [geo.longitude, geo.latitude];
}

/**
 * Assisted Recovery never asks the operator for metric dimensions. Four clicks
 * only select the physical roof face. LiDAR is then sampled inside that polygon
 * and the same deterministic roof/obstacle engine derives the metric geometry.
 */
export async function recoverRoofFromFourClicks(args: {
  frame: MetricFrame;
  quadNormalized: AssistedRoofQuad;
  faceId?: string;
}): Promise<{
  roof: SiteRoofModel;
  support: BuildingFootprint;
  selectedPlaneId: string;
  polygonLonLat: [LonLat, LonLat, LonLat, LonLat];
  evidence: string[];
}> {
  const polygonLonLat = assistedQuadToLonLat(args.quadNormalized, args.frame);
  const areaM2 = polygonAreaM2(polygonLonLat);
  if (areaM2 < 8 || areaM2 > 1_500) {
    throw new Error(`Assisted Recovery : surface sélectionnée incohérente (${areaM2.toFixed(1)} m²).`);
  }
  const lidar = await samplePolygonLidarHeights(polygonLonLat, 0.60);
  const syntheticSupport: BuildingFootprint = {
    id: "assisted-roof-selection",
    polygon: [...polygonLonLat, polygonLonLat[0]],
    centroid: polygonCentroid(polygonLonLat),
    areaM2,
    source: "assisted-selection",
  };
  const roof = buildRoofModelFromLidar({
    building: syntheticSupport,
    samples: lidar.samples,
    samplingStepM: lidar.stepM,
    coverage: lidar.coverage,
  });
  if (!roof.planes.length) throw new Error("Assisted Recovery : aucun plan fiable dans la zone sélectionnée.");
  const primary = [...roof.planes].sort((a, b) => b.sampleCount - a.sampleCount || b.confidence - a.confidence)[0]!;
  const originalPlaneId = primary.id;
  const selectedPlaneId = args.faceId?.trim() || originalPlaneId;
  if (primary.rmsErrorM > 0.30 || primary.confidence < 0.60) {
    throw new Error(
      `Assisted Recovery : le pan sélectionné reste géométriquement insuffisant `
      + `(RMS ${primary.rmsErrorM.toFixed(2)} m, confiance ${Math.round(primary.confidence * 100)} %).`,
    );
  }
  primary.id = selectedPlaneId;
  const reassignedObstacles = roof.obstacles
    .filter((obstacle) => obstacle.roofPlaneId === originalPlaneId)
    .map((obstacle) => ({ ...obstacle, roofPlaneId: selectedPlaneId }));
  return {
    roof: { ...roof, planes: [primary], obstacles: reassignedObstacles },
    support: syntheticSupport,
    selectedPlaneId,
    polygonLonLat,
    evidence: [
      "4 coins utilisateur : sélection du pan uniquement, aucune dimension saisie",
      `LiDAR HD MNX : ${lidar.samples.length}/${lidar.requestedPointCount} points utiles`,
      `Plan ajusté mathématiquement : pente ${primary.slopeDeg.toFixed(1)}°, RMS ${primary.rmsErrorM.toFixed(2)} m`,
    ],
  };
}
