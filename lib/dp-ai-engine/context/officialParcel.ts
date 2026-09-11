import type { Point2D } from "../types";

export const WEB_MERCATOR_LIMIT = 20_037_508.342789244;

export type LonLat = [number, number];
export type ParcelGeometry =
  | { type: "Polygon"; coordinates: LonLat[][] }
  | { type: "MultiPolygon"; coordinates: LonLat[][][] };

export type OfficialParcelContext = {
  normalizedAddress: string;
  longitude: number;
  latitude: number;
  municipality: string;
  cityCode: string;
  section: string;
  parcelNumber: string;
  parcelReference: string;
  parcelAreaM2: number;
  parcelGeometry: ParcelGeometry;
};

export type MetricFrame = {
  longitude: number;
  latitude: number;
  widthMeters: number;
  heightMeters: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isLonLat(value: unknown): value is LonLat {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]))
    && Number(value[0]) >= -180
    && Number(value[0]) <= 180
    && Number(value[1]) >= -90
    && Number(value[1]) <= 90;
}

export function parseParcelGeometry(value: unknown): ParcelGeometry {
  if (!value || typeof value !== "object") throw new Error("La géométrie cadastrale officielle est absente.");
  const raw = value as { type?: unknown; coordinates?: unknown };
  if (raw.type === "Polygon" && Array.isArray(raw.coordinates)) {
    const rings = raw.coordinates as unknown[];
    if (!rings.length || !rings.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isLonLat))) {
      throw new Error("La géométrie cadastrale Polygon reçue est invalide.");
    }
    return { type: "Polygon", coordinates: rings as LonLat[][] };
  }
  if (raw.type === "MultiPolygon" && Array.isArray(raw.coordinates)) {
    const polygons = raw.coordinates as unknown[];
    if (!polygons.length || !polygons.every((polygon) => Array.isArray(polygon)
      && polygon.length > 0
      && polygon.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isLonLat)))) {
      throw new Error("La géométrie cadastrale MultiPolygon reçue est invalide.");
    }
    return { type: "MultiPolygon", coordinates: polygons as LonLat[][][] };
  }
  throw new Error(`Type de géométrie cadastrale non pris en charge : ${String(raw.type ?? "inconnu")}.`);
}

export function parcelRings(geometry: ParcelGeometry): LonLat[][] {
  return geometry.type === "Polygon"
    ? geometry.coordinates
    : geometry.coordinates.flatMap((polygon) => polygon);
}

export function parcelPoints(geometry: ParcelGeometry): LonLat[] {
  return parcelRings(geometry).flat();
}

export function largestParcelRing(geometry: ParcelGeometry): LonLat[] {
  return [...parcelRings(geometry)].sort((a, b) => b.length - a.length)[0] ?? [];
}

export function toWebMercator(longitude: number, latitude: number) {
  const boundedLatitude = clamp(latitude, -85.05112878, 85.05112878);
  return {
    x: (longitude * WEB_MERCATOR_LIMIT) / 180,
    y: (Math.log(Math.tan(((90 + boundedLatitude) * Math.PI) / 360)) * WEB_MERCATOR_LIMIT) / Math.PI,
  };
}

export function fromWebMercator(x: number, y: number) {
  return {
    longitude: (x / WEB_MERCATOR_LIMIT) * 180,
    latitude: (Math.atan(Math.sinh((y / WEB_MERCATOR_LIMIT) * Math.PI)) * 180) / Math.PI,
  };
}

async function fetchOfficialParcel(args: { cityCode: string; section: string; parcelNumber: string }) {
  const url = new URL("https://apicarto.ign.fr/api/cadastre/parcelle");
  url.searchParams.set("code_insee", args.cityCode);
  url.searchParams.set("section", args.section);
  url.searchParams.set("numero", args.parcelNumber);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`APICARTO Cadastre indisponible (${response.status}).`);
  const payload = await response.json() as {
    features?: Array<{ geometry?: unknown; properties?: { contenance?: number; idu?: string } }>;
  };
  const feature = payload.features?.[0];
  if (!feature?.geometry) throw new Error("APICARTO n'a retourné aucune géométrie pour la parcelle cible.");
  const geometry = parseParcelGeometry(feature.geometry);
  const areaM2 = Number(feature.properties?.contenance);
  if (!Number.isFinite(areaM2) || areaM2 <= 0) throw new Error("APICARTO n'a retourné aucune superficie cadastrale fiable.");
  return { geometry, areaM2, idu: String(feature.properties?.idu ?? "").trim() };
}

/**
 * Universal cadastral anchor used before any roof understanding.
 * It deliberately resolves address -> parcel -> APICARTO vector geometry once,
 * so document-specific engines cannot silently disagree about the target site.
 */
export async function resolveOfficialParcelContext(address: string): Promise<OfficialParcelContext> {
  const cleanAddress = address.trim();
  if (cleanAddress.length < 8) throw new Error("Adresse trop imprécise pour les sources IGN.");

  const search = new URL("https://data.geopf.fr/geocodage/search");
  search.searchParams.set("q", cleanAddress);
  search.searchParams.set("index", "address");
  search.searchParams.set("limit", "1");
  const geocode = await fetch(search, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!geocode.ok) throw new Error(`Géocodage IGN indisponible (${geocode.status}).`);
  const payload = await geocode.json() as {
    features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> }>;
  };
  const feature = payload.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  if (!coordinates) throw new Error("Adresse non retrouvée par l'IGN.");
  const [longitude, latitude] = coordinates;
  const props = feature?.properties ?? {};
  const cityCode = String(props.citycode ?? "").trim();
  if (!cityCode) throw new Error("Le code INSEE de la commune n'a pas été déterminé par l'IGN.");

  const reverse = new URL("https://data.geopf.fr/geocodage/reverse");
  reverse.searchParams.set("lon", String(longitude));
  reverse.searchParams.set("lat", String(latitude));
  reverse.searchParams.set("index", "parcel");
  reverse.searchParams.set("limit", "1");
  const reverseResponse = await fetch(reverse, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!reverseResponse.ok) throw new Error(`Cadastre IGN indisponible (${reverseResponse.status}).`);
  const reversePayload = await reverseResponse.json() as { features?: Array<{ properties?: Record<string, unknown> }> };
  const parcel = reversePayload.features?.[0]?.properties ?? {};
  const section = String(parcel.section ?? "").trim();
  const parcelNumber = String(parcel.number ?? parcel.numero ?? "").trim();
  const reverseParcelId = String(parcel.idu ?? parcel.id ?? parcel.parcelle ?? "").trim();
  if (!section || !parcelNumber) throw new Error("La section ou le numéro cadastral n'a pas été déterminé avec certitude.");

  const official = await fetchOfficialParcel({ cityCode, section, parcelNumber });
  const parcelReference = [section, parcelNumber].filter(Boolean).join(" ") || official.idu || reverseParcelId;
  return {
    normalizedAddress: String(props.label ?? props.name ?? cleanAddress),
    longitude,
    latitude,
    municipality: String(props.city ?? ""),
    cityCode,
    section,
    parcelNumber,
    parcelReference,
    parcelAreaM2: official.areaM2,
    parcelGeometry: official.geometry,
  };
}

export function metricFrameForParcel(
  geometry: ParcelGeometry,
  fallbackLongitude: number,
  fallbackLatitude: number,
  options: {
    aspect?: number;
    minWidthMeters?: number;
    maxWidthMeters?: number;
    compactParcelWidthMeters?: number;
    compactParcelHeightMeters?: number;
    parcelScale?: number;
    fallbackWidthMeters?: number;
  } = {},
): MetricFrame {
  const aspect = options.aspect ?? (1000 / 1400);
  const projected = parcelPoints(geometry).map(([longitude, latitude]) => toWebMercator(longitude, latitude));
  if (!projected.length) throw new Error("Parcelle officielle sans coordonnées exploitables.");
  const minParcelX = Math.min(...projected.map((point) => point.x));
  const maxParcelX = Math.max(...projected.map((point) => point.x));
  const minParcelY = Math.min(...projected.map((point) => point.y));
  const maxParcelY = Math.max(...projected.map((point) => point.y));
  const parcelWidth = Math.max(1, maxParcelX - minParcelX);
  const parcelHeight = Math.max(1, maxParcelY - minParcelY);
  const compactParcel = parcelWidth <= (options.compactParcelWidthMeters ?? 120)
    && parcelHeight <= (options.compactParcelHeightMeters ?? 90);
  const center = compactParcel
    ? fromWebMercator((minParcelX + maxParcelX) / 2, (minParcelY + maxParcelY) / 2)
    : { longitude: fallbackLongitude, latitude: fallbackLatitude };
  const scale = options.parcelScale ?? 2.2;
  const desiredWidth = compactParcel
    ? Math.max(options.minWidthMeters ?? 45, parcelWidth * scale, (parcelHeight * scale) / aspect)
    : (options.fallbackWidthMeters ?? 90);
  const widthMeters = clamp(desiredWidth, options.minWidthMeters ?? 45, options.maxWidthMeters ?? 140);
  const heightMeters = widthMeters * aspect;
  const centerMercator = toWebMercator(center.longitude, center.latitude);
  return {
    longitude: center.longitude,
    latitude: center.latitude,
    widthMeters,
    heightMeters,
    minX: centerMercator.x - widthMeters / 2,
    maxX: centerMercator.x + widthMeters / 2,
    minY: centerMercator.y - heightMeters / 2,
    maxY: centerMercator.y + heightMeters / 2,
  };
}

export function projectParcelRingNormalized(geometry: ParcelGeometry, frame: MetricFrame): Point2D[] {
  const ring = largestParcelRing(geometry).map(([longitude, latitude]) => {
    const point = toWebMercator(longitude, latitude);
    return {
      x: (point.x - frame.minX) / (frame.maxX - frame.minX),
      y: (frame.maxY - point.y) / (frame.maxY - frame.minY),
    };
  });
  if (ring.length < 4 || ring.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error("La parcelle officielle ne peut pas être projetée de manière fiable dans l'emprise métrique.");
  }
  return ring;
}
