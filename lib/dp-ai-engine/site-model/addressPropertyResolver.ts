import {
  parseParcelGeometry,
  parcelRings,
  toWebMercator,
  fromWebMercator,
  type LonLat,
  type OfficialParcelContext,
} from "../context/officialParcel";
import {
  distanceBetweenBuildingsM,
  pointInLonLatPolygon,
} from "./buildingResolver";
import type { BuildingFootprint } from "./types";

type GeoJsonFeature = {
  id?: string | number;
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
};

type AddressAnchor = {
  normalizedAddress: string;
  longitude: number;
  latitude: number;
  municipality: string;
  cityCode: string;
};

function cleanLonLat(value: unknown): LonLat | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const longitude = Number(value[0]);
  const latitude = Number(value[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return undefined;
  return [longitude, latitude];
}

function polygonAreaM2(polygon: LonLat[]) {
  const projected = polygon.map(([longitude, latitude]) => toWebMercator(longitude, latitude));
  let area2 = 0;
  for (let index = 0; index < projected.length; index += 1) {
    const a = projected[index]!;
    const b = projected[(index + 1) % projected.length]!;
    area2 += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area2) / 2;
}

function polygonCentroid(polygon: LonLat[]): LonLat {
  const projected = polygon.map(([longitude, latitude]) => toWebMercator(longitude, latitude));
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < projected.length; index += 1) {
    const a = projected[index]!;
    const b = projected[(index + 1) % projected.length]!;
    const cross = a.x * b.y - b.x * a.y;
    area2 += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(area2) < 1e-9) {
    const meanX = projected.reduce((sum, point) => sum + point.x, 0) / projected.length;
    const meanY = projected.reduce((sum, point) => sum + point.y, 0) / projected.length;
    const fallback = fromWebMercator(meanX, meanY);
    return [fallback.longitude, fallback.latitude];
  }
  const centroid = fromWebMercator(cx / (3 * area2), cy / (3 * area2));
  return [centroid.longitude, centroid.latitude];
}

function exteriorRing(feature: GeoJsonFeature): LonLat[] | undefined {
  const geometry = feature.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) return undefined;
  const rawRings = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : [];
  const rings = (rawRings as unknown[]).flatMap((polygon) => {
    if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) return [];
    const ring = (polygon[0] as unknown[]).map(cleanLonLat).filter((point): point is LonLat => Boolean(point));
    return ring.length >= 4 ? [ring] : [];
  });
  return [...rings].sort((a, b) => polygonAreaM2(b) - polygonAreaM2(a))[0];
}

function buildingFromFeature(feature: GeoJsonFeature): BuildingFootprint | undefined {
  const polygon = exteriorRing(feature);
  if (!polygon) return undefined;
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
    best = Math.min(
      best,
      pointToSegmentDistanceM(point, building.polygon[index]!, building.polygon[(index + 1) % building.polygon.length]!),
    );
  }
  return best;
}

function distanceM(a: LonLat, b: LonLat) {
  const pa = toWebMercator(a[0], a[1]);
  const pb = toWebMercator(b[0], b[1]);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

async function geocodeAddress(address: string): Promise<AddressAnchor> {
  const cleanAddress = address.trim();
  if (cleanAddress.length < 8) throw new Error("Adresse trop imprécise pour les sources IGN.");
  const url = new URL("https://data.geopf.fr/geocodage/search");
  url.searchParams.set("q", cleanAddress);
  url.searchParams.set("index", "address");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Géocodage IGN indisponible (${response.status}).`);
  const payload = await response.json() as {
    features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> }>;
  };
  const feature = payload.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  if (!coordinates) throw new Error("Adresse non retrouvée par l'IGN.");
  const props = feature?.properties ?? {};
  const cityCode = String(props.citycode ?? "").trim();
  if (!cityCode) throw new Error("Le code INSEE de l'adresse n'a pas été déterminé.");
  return {
    normalizedAddress: String(props.label ?? props.name ?? cleanAddress),
    longitude: coordinates[0],
    latitude: coordinates[1],
    municipality: String(props.city ?? ""),
    cityCode,
  };
}

async function fetchBuildingsAround(point: LonLat, radiusM = 55) {
  const center = toWebMercator(point[0], point[1]);
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
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`BD TOPO indisponible (${response.status}).`);
  const payload = await response.json() as { features?: GeoJsonFeature[] };
  return (payload.features ?? []).map(buildingFromFeature).filter((item): item is BuildingFootprint => Boolean(item));
}

function selectAddressBuilding(buildings: BuildingFootprint[], addressPoint: LonLat) {
  if (!buildings.length) throw new Error("BD TOPO : aucun bâtiment trouvé autour du numéro d'adresse.");
  const ranked = buildings.map((building) => {
    const edgeDistance = pointToBuildingDistanceM(addressPoint, building);
    const centroidDistance = distanceM(addressPoint, building.centroid);
    const tinyPenalty = (building.areaM2 ?? 0) < 18 ? 18 : 0;
    return {
      building,
      edgeDistance,
      score: edgeDistance * 10 + centroidDistance * 0.12 + tinyPenalty,
    };
  }).sort((a, b) => a.score - b.score);
  const best = ranked[0];
  if (!best || best.edgeDistance > 35) {
    throw new Error("BD TOPO : aucun bâtiment ne correspond assez précisément au numéro d'adresse.");
  }
  return best.building;
}

async function fetchParcelGeometry(cityCode: string, section: string, parcelNumber: string) {
  const url = new URL("https://apicarto.ign.fr/api/cadastre/parcelle");
  url.searchParams.set("code_insee", cityCode);
  url.searchParams.set("section", section);
  url.searchParams.set("numero", parcelNumber);
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) return undefined;
  const payload = await response.json() as {
    features?: Array<{ geometry?: unknown; properties?: { contenance?: number; idu?: string } }>;
  };
  const feature = payload.features?.[0];
  if (!feature?.geometry) return undefined;
  const areaM2 = Number(feature.properties?.contenance);
  if (!Number.isFinite(areaM2) || areaM2 <= 0) return undefined;
  return {
    geometry: parseParcelGeometry(feature.geometry),
    areaM2,
    idu: String(feature.properties?.idu ?? "").trim(),
  };
}

async function parcelForBuilding(anchor: AddressAnchor, building: BuildingFootprint): Promise<OfficialParcelContext> {
  const [longitude, latitude] = building.centroid;
  const reverse = new URL("https://data.geopf.fr/geocodage/reverse");
  reverse.searchParams.set("lon", String(longitude));
  reverse.searchParams.set("lat", String(latitude));
  reverse.searchParams.set("index", "parcel");
  reverse.searchParams.set("limit", "5");
  const response = await fetch(reverse, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Cadastre IGN indisponible (${response.status}).`);
  const payload = await response.json() as { features?: Array<{ properties?: Record<string, unknown> }> };
  const candidates = payload.features ?? [];

  for (const candidate of candidates) {
    const props = candidate.properties ?? {};
    const section = String(props.section ?? "").trim();
    const parcelNumber = String(props.number ?? props.numero ?? "").trim();
    if (!section || !parcelNumber) continue;
    const official = await fetchParcelGeometry(anchor.cityCode, section, parcelNumber);
    if (!official) continue;
    const containsBuildingCenter = parcelRings(official.geometry)
      .some((ring) => pointInLonLatPolygon(building.centroid, ring));
    if (!containsBuildingCenter) continue;
    return {
      normalizedAddress: anchor.normalizedAddress,
      longitude: anchor.longitude,
      latitude: anchor.latitude,
      municipality: anchor.municipality,
      cityCode: anchor.cityCode,
      section,
      parcelNumber,
      parcelReference: [section, parcelNumber].filter(Boolean).join(" ") || official.idu,
      parcelAreaM2: official.areaM2,
      parcelGeometry: official.geometry,
    };
  }
  throw new Error("Cadastre : aucune parcelle officielle ne contient le bâtiment correspondant au numéro d'adresse.");
}

function buildingTouchesParcel(building: BuildingFootprint, parcel: OfficialParcelContext) {
  const rings = parcelRings(parcel.parcelGeometry);
  if (rings.some((ring) => pointInLonLatPolygon(building.centroid, ring))) return true;
  return building.polygon.some((point) => rings.some((ring) => pointInLonLatPolygon(point, ring)));
}

export async function resolveAddressPropertyContext(address: string) {
  const addressAnchor = await geocodeAddress(address);
  const addressPoint: LonLat = [addressAnchor.longitude, addressAnchor.latitude];
  const nearbyBuildings = await fetchBuildingsAround(addressPoint);
  const building = selectAddressBuilding(nearbyBuildings, addressPoint);
  const parcel = await parcelForBuilding(addressAnchor, building);

  if (!buildingTouchesParcel(building, parcel)) {
    throw new Error("Le bâtiment associé au numéro d'adresse n'appartient pas à la parcelle cadastrale résolue.");
  }

  // Same physical house only: the parcel is already locked, and extra BD TOPO
  // volumes must directly touch the addressed volume. No recursive 1.5 m chain.
  const buildings = [
    building,
    ...nearbyBuildings.filter((candidate) => (
      candidate.id !== building.id
      && buildingTouchesParcel(candidate, parcel)
      && distanceBetweenBuildingsM(building, candidate) <= 0.45
    )),
  ].sort((a, b) => (a.id === building.id ? -1 : b.id === building.id ? 1 : (b.areaM2 ?? 0) - (a.areaM2 ?? 0)));

  return { parcel, building, buildings };
}
