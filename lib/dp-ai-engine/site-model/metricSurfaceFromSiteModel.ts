import { fromWebMercator, toWebMercator, type LonLat } from "../context/officialParcel";
import type { MetricPoint2D, RoofFaceMetricGeometry } from "../types";
import type { RoofPlaneModel, SiteModelRoofFace, SiteObstacle, SiteRoofModel } from "./types";

type LocalPoint = { x: number; y: number };

function planeBasis(plane: RoofPlaneModel) {
  const norm = Math.hypot(plane.plane.a, plane.plane.b);
  const up = norm > 1e-9
    ? { x: plane.plane.a / norm, y: plane.plane.b / norm }
    : { x: 0, y: 1 };
  const along = { x: up.y, y: -up.x };
  const quadProjected = plane.projectionQuadLocalM.map((point) => ({
    u: point.x * along.x + point.y * along.y,
    v: point.x * up.x + point.y * up.y,
  }));
  const minU = Math.min(...quadProjected.map((p) => p.u));
  const maxU = Math.max(...quadProjected.map((p) => p.u));
  const minV = Math.min(...quadProjected.map((p) => p.v));
  const maxV = Math.max(...quadProjected.map((p) => p.v));
  const cosSlope = Math.max(0.25, Math.cos(plane.slopeDeg * Math.PI / 180));
  return {
    along,
    up,
    minU,
    maxU,
    minV,
    maxV,
    cosSlope,
    toMetric(point: LocalPoint): MetricPoint2D {
      const u = point.x * along.x + point.y * along.y;
      const v = point.x * up.x + point.y * up.y;
      return {
        xMm: (u - minU) * 1000,
        yMm: ((v - minV) / cosSlope) * 1000,
      };
    },
  };
}

function expandKeepout(points: MetricPoint2D[], marginMm: number) {
  const minX = Math.min(...points.map((p) => p.xMm)) - marginMm;
  const maxX = Math.max(...points.map((p) => p.xMm)) + marginMm;
  const minY = Math.min(...points.map((p) => p.yMm)) - marginMm;
  const maxY = Math.max(...points.map((p) => p.yMm)) + marginMm;
  return [
    { xMm: minX, yMm: minY },
    { xMm: maxX, yMm: minY },
    { xMm: maxX, yMm: maxY },
    { xMm: minX, yMm: maxY },
  ];
}

export function localPointToLonLat(origin: LonLat, point: LocalPoint): LonLat {
  const base = toWebMercator(origin[0], origin[1]);
  const geo = fromWebMercator(base.x + point.x, base.y + point.y);
  return [geo.longitude, geo.latitude];
}

export function sitePlaneProjectionQuadLonLat(origin: LonLat, plane: RoofPlaneModel) {
  return plane.projectionQuadLocalM.map((point) => localPointToLonLat(origin, point)) as [LonLat, LonLat, LonLat, LonLat];
}

export function metricSurfaceFromSitePlane(args: {
  plane: RoofPlaneModel;
  roof: SiteRoofModel;
  faceId?: string;
  label?: string;
}): SiteModelRoofFace {
  const { plane, roof } = args;
  const basis = planeBasis(plane);
  const obstacles = roof.obstacles.filter((obstacle) => obstacle.roofPlaneId === plane.id);
  const surfacePolygonMm = plane.polygonLocalM.map(basis.toMetric);
  const keepoutsMm = obstacles.map((obstacle) => {
    const raw = obstacle.polygonLocalM.map(basis.toMetric);
    return { id: obstacle.id, polygonMm: expandKeepout(raw, obstacle.keepoutMarginMm) };
  });
  const obstaclePolygonsMm = obstacles.map((obstacle, index) => ({
    type: obstacle.type,
    description: `LiDAR ${obstacle.id} · relief +${obstacle.maxHeightAbovePlaneM.toFixed(2)} m`,
    polygonMm: keepoutsMm[index]!.polygonMm,
  }));
  const geometry: RoofFaceMetricGeometry = {
    id: args.faceId ?? plane.id,
    label: args.label ?? `Pan ${plane.id}`,
    widthMm: Math.round((basis.maxU - basis.minU) * 1000),
    slopeLengthMm: Math.round(((basis.maxV - basis.minV) / basis.cosSlope) * 1000),
    slopeDeg: plane.slopeDeg,
    surfacePolygonMm,
    obstaclePolygonsMm,
    source: "external-data",
  };
  return {
    sitePlane: plane,
    metricGeometry: geometry,
    projectionQuadLocalM: plane.projectionQuadLocalM,
    keepoutsMm,
  };
}

export function choosePrimaryRoofPlane(roof: SiteRoofModel, requestedFaceId?: string) {
  if (!roof.planes.length) throw new Error("SiteModel : aucune surface de toiture disponible.");
  const requested = requestedFaceId
    ? roof.planes.find((plane) => plane.id.toUpperCase() === requestedFaceId.toUpperCase())
    : undefined;
  if (requested) return requested;
  return [...roof.planes].sort((a, b) => (
    b.confidence - a.confidence || b.sampleCount - a.sampleCount
  ))[0]!;
}
