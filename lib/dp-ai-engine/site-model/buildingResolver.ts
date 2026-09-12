import {
  largestParcelRing,
  parcelRings,
  toWebMercator,
  fromWebMercator,
  type LonLat,
  type OfficialParcelContext,
} from "../context/officialParcel";
import type { BuildingFootprint } from "./types";

type GeoJsonFeature = {
  id?: string | number;
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
};

function cleanLonLat(value: unknown): LonLat | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const lon = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return undefined;
  return [lon, lat];
}

function exteriorRings(feature: GeoJsonFeature): LonLat[][] {
  const geometry = feature.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === "Polygon") {
    const outer = (geometry.coordinates as unknown[])[0];
    if (!Array.isArray(outer)) return [];
    const ring = outer.map(cleanLonLat).filter((point): point is LonLat => Boolean(point));
    return ring.length >= 4 ? [ring] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as unknown[]).flatMap((polygon) => {
      if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) return [];
      const ring = (polygon[0] as unknown[]).map(cleanLonLat).filter((point): point is LonLat => Boolean(point));
      return ring.length >= 4 ? [ring] : [];
    });
  }
  return [];
}

function pointOnSegment(point: LonLat, a: LonLat, b: LonLat, epsilon = 1e-10) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx ** 2 + dy ** 2;

  if (lengthSq <= epsilon ** 2) {
    return Math.hypot(point[0] - a[0], point[1] - a[1]) <= epsilon;
  }

  const cross = (point[1] - a[1]) * dx - (point[0] - a[0]) * dy;
  if (Math.abs(cross) > epsilon) return false;
  const dot = (point[0] - a[0]) * dx + (point[1] - a[1]) * dy;
  if (dot < -epsilon) return false;
  return dot <= lengthSq + epsilon;
}

export function pointInLonLatPolygon(point: LonLat, polygon: LonLat[]) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (pointOnSegment(point, a, b)) return true;
    const intersects = (a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / ((b[1] - a[1]) || 1e-12) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonAreaM2(polygon: LonLat[]) {
  const projected = polygon.map(([lon, lat]) => toWebMercator(lon, lat));
  let area2 = 0;
  for (let i = 0; i < projected.length; i += 1) {
    const a = projected[i]!;
    const b = projected[(i + 1) % projected.length]!;
    area2 += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area2) / 2;
}

function polygonCentroid(polygon: LonLat[]): LonLat {
  const projected = polygon.map(([lon, lat]) => toWebMercator(lon, lat));
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < projected.length; i += 1) {
    const a = projected[i]!;
    const b = projected[(i + 1) % projected.length]!;
    const cross = a.x * b.y - b.x * a.y;
    area2 += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(area2) < 1e-9) {
    const meanX = projected.reduce((sum, p) => sum + p.x, 0) / projected.length;
    const meanY = projected.reduce((sum, p) => sum + p.y, 0) / projected.length;
    const fallback = fromWebMercator(meanX, meanY);
    return [fallback.longitude, fallback.latitude];
  }
  const centroid = fromWebMercator(cx / (3 * area2), cy / (3 * area2));
  return [centroid.longitude, centroid.latitude];
}

function distanceM(a: LonLat, b: LonLat) {
  const pa = toWebMercator(a[0], a[1]);
  const pb = toWebMercator(b[0], b[1]);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

function pointToSegmentDistanceM(point: LonLat, a: LonLat, b: LonLat) {
  const p = toWebMercator(point[0], point[1]);
  const p1 = toWebMercator(a[0], a[1]);
  const p2 = toWebMercator(b[0], b[1]);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 1e-9) return Math.hypot(p.x - p1.x, p.y - p1.y);
  const t = Math.max(0, Math.min(1, ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / lengthSq));
  return Math.hypot(p.x - (p1.x + t * dx), p.y - (p1.y + t * dy));
}

function pointToBuildingDistanceM(point: LonLat, building: BuildingFootprint) {
  if (pointInLonLatPolygon(point, building.polygon)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < building.polygon.length; index += 1) {
    const a = building.polygon[index]!;
    const b = building.polygon[(index + 1) % building.polygon.length]!;
    best = Math.min(best, pointToSegmentDistanceM(point, a, b));
  }
  return best;
}

export function distanceBetweenBuildingsM(a: BuildingFootprint, b: BuildingFootprint) {
  if (pointInLonLatPolygon(a.centroid, b.polygon) || pointInLonLatPolygon(b.centroid, a.polygon)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (const point of a.polygon) best = Math.min(best, pointToBuildingDistanceM(point, b));
  for (const point of b.polygon) best = Math.min(best, pointToBuildingDistanceM(point, a));
  return best;
}

function candidateFromFeature(feature: GeoJsonFeature): BuildingFootprint | undefined {
  const rings = exteriorRings(feature);
  if (!rings.length) return undefined;
  const polygon = [...rings].sort((a, b) => polygonAreaM2(b) - polygonAreaM2(a))[0]!;
  const props = feature.properties ?? {};
  const heightRaw = Number(props.hauteur ?? props.hauteur_moyenne ?? props.hauteur_maximale);
  return {
    id: String(feature.id ?? props.cleabs ?? props.id ?? props.id_bati ?? "bdtopo-building"),
    polygon,
    centroid: polygonCentroid(polygon),
    areaM2: polygonAreaM2(polygon),
    heightM: Number.isFinite(heightRaw) && heightRaw > 0 ? heightRaw : undefined,
    source: "BDTOPO_V3:batiment",
  };
}

function buildingTouchesParcel(building: BuildingFootprint, parcel: OfficialParcelContext) {
  const rings = parcelRings(parcel.parcelGeometry);
  if (rings.some((ring) => pointInLonLatPolygon(building.centroid, ring))) return true;
  if (building.polygon.some((point) => rings.some((ring) => pointInLonLatPolygon(point, ring)))) return true;
  return rings.some((ring) => ring.some((point) => pointInLonLatPolygon(point, building.polygon)));
}

async function fetchBuildingCandidates(parcel: OfficialParcelContext) {
  const center = toWebMercator(parcel.longitude, parcel.latitude);
  const radiusM = 70;
  const url = new URL("https://data.geopf.fr/wfs/ows");
  url.searchParams.set("SERVICE", "WFS");
  url.searchParams.set("VERSION", "2.0.0");
  url.searchParams.set("REQUEST", "GetFeature");
  url.searchParams.set("TYPENAMES", "BDTOPO_V3:batiment");
  url.searchParams.set("SRSNAME", "EPSG:4326");
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("COUNT", "100");
  url.searchParams.set(
    "BBOX",
    `${center.x - radiusM},${center.y - radiusM},${center.x + radiusM},${center.y + radiusM},EPSG:3857`,
  );
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`BD TOPO indisponible (${response.status}).`);
  const payload = await response.json() as { features?: GeoJsonFeature[] };
  return (payload.features ?? [])
    .map(candidateFromFeature)
    .filter((item): item is BuildingFootprint => Boolean(item));
}

export function selectTargetBuilding(
  candidates: BuildingFootprint[],
  addressPoint: LonLat,
  parcel: OfficialParcelContext,
) {
  if (!candidates.length) throw new Error("BD TOPO : aucun bâtiment trouvé autour de l'adresse.");
  const parcelOuter = largestParcelRing(parcel.parcelGeometry);
  const parcelRingsAll = parcelRings(parcel.parcelGeometry);
  const scored = candidates.map((building) => {
    const containsAddress = pointInLonLatPolygon(addressPoint, building.polygon);
    const centroidInsideParcel = parcelRingsAll.some((ring) => pointInLonLatPolygon(building.centroid, ring));
    const addressDistance = distanceM(addressPoint, building.centroid);
    const parcelPenalty = centroidInsideParcel ? 0 : 500;
    const containmentBonus = containsAddress ? -1000 : 0;
    const smallAreaPenalty = building.areaM2 && building.areaM2 < 12 ? 100 : 0;
    const residentialScaleBonus = Math.min(35, Math.max(0, (building.areaM2 ?? 0) - 25) * 0.18);
    return {
      building,
      score: addressDistance + parcelPenalty + smallAreaPenalty - containmentBonus - residentialScaleBonus,
    };
  }).sort((a, b) => a.score - b.score);
  const best = scored[0]?.building;
  if (!best) throw new Error("BD TOPO : aucun bâtiment cible fiable.");
  const insideParcel = parcelOuter.length >= 4 && pointInLonLatPolygon(best.centroid, parcelOuter);
  const containsAddress = pointInLonLatPolygon(addressPoint, best.polygon);
  if (!insideParcel && !containsAddress) {
    throw new Error("BD TOPO : le bâtiment le plus proche n'est pas démontré sur la parcelle cible.");
  }
  return best;
}

/**
 * Returns the physical building group belonging to the target address.
 * BD TOPO can split one real house into several touching polygons (wings,
 * old/new volumes, covered passages). Starting from the address anchor, we
 * include only parcel-contained footprints that physically touch or are
 * separated by a very small modelling gap. Detached garages/outbuildings and
 * neighbouring parcels stay out of the cluster.
 */
export async function resolveTargetBuildingCluster(parcel: OfficialParcelContext) {
  const all = await fetchBuildingCandidates(parcel);
  const parcelCandidates = all.filter((building) => buildingTouchesParcel(building, parcel));
  const anchor = selectTargetBuilding(
    parcelCandidates.length ? parcelCandidates : all,
    [parcel.longitude, parcel.latitude],
    parcel,
  );

  const cluster: BuildingFootprint[] = [anchor];
  const remaining = (parcelCandidates.length ? parcelCandidates : all)
    .filter((candidate) => candidate.id !== anchor.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const candidate = remaining[index]!;
      const connected = cluster.some((member) => distanceBetweenBuildingsM(member, candidate) <= 1.5);
      if (!connected) continue;
      cluster.push(candidate);
      remaining.splice(index, 1);
      changed = true;
    }
  }

  return cluster.sort((a, b) => (a.id === anchor.id ? -1 : b.id === anchor.id ? 1 : (b.areaM2 ?? 0) - (a.areaM2 ?? 0)));
}

export function closestBuildingToPoint(
  buildings: BuildingFootprint[],
  point: LonLat,
  maxDistanceM = Number.POSITIVE_INFINITY,
) {
  const ranked = buildings
    .map((building) => ({ building, distanceM: pointToBuildingDistanceM(point, building) }))
    .sort((a, b) => a.distanceM - b.distanceM || (b.building.areaM2 ?? 0) - (a.building.areaM2 ?? 0));
  const best = ranked[0];
  return best && best.distanceM <= maxDistanceM ? best.building : undefined;
}

/** Resolve the physical project building from the official address + parcel. */
export async function resolveTargetBuilding(parcel: OfficialParcelContext): Promise<BuildingFootprint> {
  const cluster = await resolveTargetBuildingCluster(parcel);
  return cluster[0]!;
}
