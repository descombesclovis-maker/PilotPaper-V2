import { fromWebMercator, toWebMercator } from "@/lib/dp-ai-engine/context/officialParcel";
import type { AdvancedRoofTruth } from "@/lib/geometry/advanced-roof-truth";
import type { SiteTwinPropertyLock } from "./propertyLock";
import type { GeometryEngineRoofResult } from "./geometryEngineClient";
import type { SiteTwinBuilding, SiteTwinRoofEdge, SiteTwinRoofFace, TwinXY, TwinXYZ } from "./types";

const SHARED_EDGE_TOLERANCE_M = 0.28;
const MIN_SHARED_EDGE_M = 0.45;

type MetricPoint = { x: number; y: number };
type MetricSegment = { a: MetricPoint; b: MetricPoint };

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function polygonArea(points: MetricPoint[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
}

function polygonCentroid(points: MetricPoint[]): MetricPoint {
  if (!points.length) return { x: 0, y: 0 };
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    cx += (current.x + next.x) * cross;
    cy += (current.y + next.y) * cross;
  }
  if (Math.abs(twiceArea) < 1e-9) {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }
  return { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) };
}

function pointInPolygon(point: [number, number], polygon: Array<[number, number]>) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    const intersects = ((yi > point[1]) !== (yj > point[1]))
      && point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function buildingCentroid(building: SiteTwinBuilding) {
  const metric = building.polygonLonLat.map(([longitude, latitude]) => toWebMercator(longitude, latitude));
  const center = polygonCentroid(metric);
  return center;
}

function chooseBuilding(property: SiteTwinPropertyLock, polygonLonLat: Array<[number, number]>) {
  const firstTarget = property.buildings.find((building) => property.targetBuildingIds.includes(building.id)) ?? property.buildings[0];
  if (!firstTarget) return null;
  const metric = polygonLonLat.map(([longitude, latitude]) => toWebMercator(longitude, latitude));
  const centerMetric = polygonCentroid(metric);
  const centerLonLat = fromWebMercator(centerMetric.x, centerMetric.y);
  const center: [number, number] = [centerLonLat.longitude, centerLonLat.latitude];
  const targets = property.buildings.filter((building) => property.targetBuildingIds.includes(building.id));
  const containing = targets.find((building) => pointInPolygon(center, building.polygonLonLat));
  if (containing) return containing;
  return targets
    .map((building) => {
      const candidate = buildingCentroid(building);
      return { building, distance: Math.hypot(candidate.x - centerMetric.x, candidate.y - centerMetric.y) };
    })
    .sort((left, right) => left.distance - right.distance)[0]?.building ?? firstTarget;
}

function distanceToLine(point: MetricPoint, segment: MetricSegment) {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return Number.POSITIVE_INFINITY;
  return Math.abs(dx * (segment.a.y - point.y) - (segment.a.x - point.x) * dy) / length;
}

function overlappingSegment(first: MetricSegment, second: MetricSegment): MetricSegment | null {
  const firstDx = first.b.x - first.a.x;
  const firstDy = first.b.y - first.a.y;
  const firstLength = Math.hypot(firstDx, firstDy);
  const secondDx = second.b.x - second.a.x;
  const secondDy = second.b.y - second.a.y;
  const secondLength = Math.hypot(secondDx, secondDy);
  if (firstLength < MIN_SHARED_EDGE_M || secondLength < MIN_SHARED_EDGE_M) return null;
  const cross = Math.abs(firstDx * secondDy - firstDy * secondDx) / (firstLength * secondLength);
  if (cross > Math.sin(5 * Math.PI / 180)) return null;
  if (distanceToLine(second.a, first) > SHARED_EDGE_TOLERANCE_M || distanceToLine(second.b, first) > SHARED_EDGE_TOLERANCE_M) return null;
  const ux = firstDx / firstLength;
  const uy = firstDy / firstLength;
  const projection = (point: MetricPoint) => (point.x - first.a.x) * ux + (point.y - first.a.y) * uy;
  const secondValues = [projection(second.a), projection(second.b)].sort((a, b) => a - b);
  const start = Math.max(0, secondValues[0]!);
  const end = Math.min(firstLength, secondValues[1]!);
  if (end - start < MIN_SHARED_EDGE_M) return null;
  return {
    a: { x: first.a.x + ux * start, y: first.a.y + uy * start },
    b: { x: first.a.x + ux * end, y: first.a.y + uy * end },
  };
}

function zAt(face: SiteTwinRoofFace, point: TwinXY) {
  return face.plane.a * point.x + face.plane.b * point.y + face.plane.c;
}

function classifySharedEdge(left: SiteTwinRoofFace, right: SiteTwinRoofFace, segment: MetricSegment) {
  const midpoint = { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 };
  const edgeZ = (zAt(left, midpoint) + zAt(right, midpoint)) / 2;
  const leftDelta = edgeZ - zAt(left, left.centerLocalM);
  const rightDelta = edgeZ - zAt(right, right.centerLocalM);
  const verticalChange = Math.abs(zAt(left, segment.b) - zAt(left, segment.a));
  if (leftDelta > 0.10 && rightDelta > 0.10) return verticalChange <= 0.20 ? "ridge" as const : "hip" as const;
  if (leftDelta < -0.10 && rightDelta < -0.10) return "valley" as const;
  return "unknown" as const;
}

function xyz(face: SiteTwinRoofFace, point: MetricPoint): TwinXYZ {
  return { x: point.x, y: point.y, z: zAt(face, point) };
}

function makeEdges(faces: SiteTwinRoofFace[]) {
  const edges: SiteTwinRoofEdge[] = [];
  const sharedByFace = new Map<string, MetricSegment[]>();
  let sequence = 1;

  for (let firstIndex = 0; firstIndex < faces.length; firstIndex += 1) {
    const left = faces[firstIndex]!;
    for (let secondIndex = firstIndex + 1; secondIndex < faces.length; secondIndex += 1) {
      const right = faces[secondIndex]!;
      if (left.buildingId !== right.buildingId) continue;
      for (let li = 0; li < left.polygonLocalM.length; li += 1) {
        const leftSegment = { a: left.polygonLocalM[li]!, b: left.polygonLocalM[(li + 1) % left.polygonLocalM.length]! };
        for (let ri = 0; ri < right.polygonLocalM.length; ri += 1) {
          const rightSegment = { a: right.polygonLocalM[ri]!, b: right.polygonLocalM[(ri + 1) % right.polygonLocalM.length]! };
          const overlap = overlappingSegment(leftSegment, rightSegment);
          if (!overlap) continue;
          const kind = classifySharedEdge(left, right, overlap);
          const id = `advanced-edge-${sequence++}`;
          const averagedA = (zAt(left, overlap.a) + zAt(right, overlap.a)) / 2;
          const averagedB = (zAt(left, overlap.b) + zAt(right, overlap.b)) / 2;
          edges.push({
            id,
            a: { x: overlap.a.x, y: overlap.a.y, z: averagedA },
            b: { x: overlap.b.x, y: overlap.b.y, z: averagedB },
            kind,
            adjacentFaceIds: [left.id, right.id],
          });
          left.edgeIds.push(id);
          right.edgeIds.push(id);
          sharedByFace.set(left.id, [...(sharedByFace.get(left.id) ?? []), overlap]);
          sharedByFace.set(right.id, [...(sharedByFace.get(right.id) ?? []), overlap]);
        }
      }
    }
  }

  for (const face of faces) {
    const shared = sharedByFace.get(face.id) ?? [];
    for (let index = 0; index < face.polygonLocalM.length; index += 1) {
      const segment = { a: face.polygonLocalM[index]!, b: face.polygonLocalM[(index + 1) % face.polygonLocalM.length]! };
      const length = Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
      const covered = shared.some((candidate) => {
        const overlap = overlappingSegment(segment, candidate);
        return overlap && Math.hypot(overlap.b.x - overlap.a.x, overlap.b.y - overlap.a.y) >= Math.max(MIN_SHARED_EDGE_M, length * 0.7);
      });
      if (covered || length < 0.20) continue;
      const midpoint = { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 };
      const kind = zAt(face, midpoint) + 0.05 < zAt(face, face.centerLocalM) ? "eave" as const : "unknown" as const;
      const id = `advanced-edge-${sequence++}`;
      edges.push({ id, a: xyz(face, segment.a), b: xyz(face, segment.b), kind, adjacentFaceIds: [face.id] });
      face.edgeIds.push(id);
    }
  }
  return edges;
}

/**
 * Converts a provider roof model into the canonical metric Site Twin only when
 * the provider supplies georeferenced facet polygons plus slope/azimuth. This
 * is a fail-closed fallback for addresses without DSM/LiDAR coverage; it never
 * fabricates a roof outline from panel counts or imagery prompts.
 */
export function buildAdvancedRoofMetricFallback(args: {
  property: SiteTwinPropertyLock;
  advanced: AdvancedRoofTruth;
  terrainElevationM?: number;
}): GeometryEngineRoofResult | null {
  const usable = args.advanced.facets.filter((facet) => (
    facet.polygonLonLat && facet.polygonLonLat.length >= 3
    && finite(facet.slopeDeg) !== null
    && finite(facet.azimuthDeg) !== null
  ));
  if (!args.advanced.usable || !usable.length) return null;

  const allMetric = usable.flatMap((facet) => facet.polygonLonLat!.map(([longitude, latitude]) => toWebMercator(longitude, latitude)));
  const originMetric = polygonCentroid(allMetric);
  const originLonLat = fromWebMercator(originMetric.x, originMetric.y);
  const origin: [number, number] = [originLonLat.longitude, originLonLat.latitude];

  const faces: SiteTwinRoofFace[] = usable.flatMap((facet, index) => {
    const polygonLonLat = facet.polygonLonLat!;
    const building = chooseBuilding(args.property, polygonLonLat);
    if (!building) return [];
    const polygonLocalM = polygonLonLat.map(([longitude, latitude]) => {
      const projected = toWebMercator(longitude, latitude);
      return { x: projected.x - originMetric.x, y: projected.y - originMetric.y };
    });
    const horizontalArea = polygonArea(polygonLocalM);
    if (horizontalArea < 1.0) return [];
    const slopeDeg = Number(facet.slopeDeg);
    const azimuthDeg = ((Number(facet.azimuthDeg) % 360) + 360) % 360;
    const tangent = Math.tan(slopeDeg * Math.PI / 180);
    const azimuth = azimuthDeg * Math.PI / 180;
    const a = -tangent * Math.sin(azimuth);
    const b = -tangent * Math.cos(azimuth);
    const relative = polygonLocalM.map((point) => a * point.x + b * point.y);
    const maxRelative = Math.max(...relative);
    const buildingTop = finite(building.heightM);
    const terrain = finite(args.terrainElevationM);
    const absoluteTop = buildingTop !== null ? (terrain ?? 0) + buildingTop : null;
    const c = absoluteTop !== null ? absoluteTop - maxRelative : -maxRelative;
    const areaM2 = finite(facet.areaM2) && Number(facet.areaM2) > 0
      ? Number(facet.areaM2)
      : horizontalArea / Math.max(0.15, Math.cos(slopeDeg * Math.PI / 180));
    const confidence = Math.min(0.94,
      0.80
      + (facet.areaM2 ? 0.03 : 0)
      + (buildingTop !== null ? 0.04 : 0)
      + (terrain !== null ? 0.03 : 0));
    return [{
      id: `advanced-${String(facet.id || index + 1).replace(/[^a-zA-Z0-9_-]/g, "-")}`,
      displayLabel: `Pan avancé ${index + 1}`,
      buildingId: building.id,
      polygonLocalM,
      polygonLonLat,
      plane: { a, b, c },
      slopeDeg,
      azimuthDeg,
      areaM2,
      centerLocalM: polygonCentroid(polygonLocalM),
      edgeIds: [],
      obstacles: [],
      evidence: [{
        source: "advanced-roof-model",
        confidence,
        reference: args.advanced.projectId ? String(args.advanced.projectId) : facet.id,
        notes: [
          "Facette géoréférencée fournie par le moteur géométrique avancé et rattachée au bâtiment cadastral verrouillé.",
          buildingTop !== null
            ? "Altitude verticale ancrée par la hauteur BD TOPO du bâtiment."
            : "Altitude absolue non cotée faute de hauteur bâtiment vérifiée ; pente et emprise restent métriques.",
        ],
      }],
      confidence,
    } satisfies SiteTwinRoofFace];
  });

  if (!faces.length) return null;
  const edges = makeEdges(faces);
  const sharedTopologicalEdges = edges.filter((edge) => edge.adjacentFaceIds.length > 1).length;
  const confidence = Math.min(...faces.map((face) => face.confidence));
  return {
    engineVersion: "advanced-roof-model/metric-fallback-v1",
    source: "advanced-roof-model",
    origin,
    faces,
    edges,
    confidence,
    diagnostics: [
      `Fallback métrique avancé : ${faces.length} facette(s) géoréférencée(s) convertie(s) en Site Twin.`,
      `Topologie reconstruite : ${sharedTopologicalEdges} arête(s) partagée(s).`,
      "Le modèle avancé devient source primaire uniquement parce que DSM/LiDAR local n'était pas exploitable.",
    ],
  };
}
