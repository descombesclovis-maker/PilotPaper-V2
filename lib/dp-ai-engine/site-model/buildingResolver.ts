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
  const cross = (point[1] - a[1]) * (b[0] - a[0]) - (point[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(cross) > epsilon) return false;
  const dot = (point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1]);
  if (dot < -epsilon) return false;
  const lengthSq = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
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
  for (let i = 0; i < projected.length; i++) {
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
  for (let i = 0; i < projected.length; i++) {
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
    const areaPenalty = building.areaM2 && building.areaM2 < 12 ? 60 : 0;
    return { building, score: addressDistance + parcelPenalty + containmentBonus + areaPenalty };
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

/** Resolve the physical project building from the official address + parcel. */
export async function resolveTargetBuilding(parcel: OfficialParcelContext): Promise<BuildingFootprint> {
  const center = toWebMercator(parcel.longitude, parcel.latitude);
  const radiusM = 60;
  const url = new URL("https://data.geopf.fr/wfs/ows");
  url.searchParams.set("SERVICE", "WFS");
  url.searchParams.set("VERSION", "2.0.0");
  url.searchParams.set("REQUEST", "GetFeature");
  url.searchParams.set("TYPENAMES", "BDTOPO_V3:batiment");
  url.searchParams.set("SRSNAME", "EPSG:4326");
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("COUNT", "80");
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
  const candidates = (payload.features ?? []).map(candidateFromFeature).filter((item): item is BuildingFootprint => Boolean(item));
  return selectTargetBuilding(candidates, [parcel.longitude, parcel.latitude], parcel);
}
