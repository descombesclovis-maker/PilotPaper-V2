import { fromWebMercator, toWebMercator } from "@/lib/dp-ai-engine/context/officialParcel";
import type { SiteTwinPropertyLock } from "./propertyLock";
import { SiteTwinError } from "./errors";

const IGN_MNX_RESOURCE = "ign_lidar_hd_mnx_multi_wld";
const ALTITUDE_ENDPOINT = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json";
const COPC_WFS_ENDPOINT = "https://data.geopf.fr/wfs/ows";

export type IgnElevationPoint = {
  longitude: number;
  latitude: number;
  z: number;
};

export type IgnCopcTile = {
  id: string;
  url: string;
};

type IgnElevationResponse = {
  elevations?: Array<{
    lon?: number;
    lat?: number;
    z?: number;
    measures?: Array<{ z?: number; source_name?: string; title?: string }>;
  } | number>;
};

function bboxForProperty(property: SiteTwinPropertyLock, bufferM = 0.8) {
  const points = property.buildings.flatMap((building) => building.polygonLonLat)
    .map(([longitude, latitude]) => toWebMercator(longitude, latitude));
  if (!points.length) throw new SiteTwinError("IGN_ELEVATION_UNAVAILABLE", "Aucune emprise bâtiment disponible pour interroger le LiDAR IGN.");
  return {
    minX: Math.min(...points.map((point) => point.x)) - bufferM,
    minY: Math.min(...points.map((point) => point.y)) - bufferM,
    maxX: Math.max(...points.map((point) => point.x)) + bufferM,
    maxY: Math.max(...points.map((point) => point.y)) + bufferM,
  };
}

function metricGrid(property: SiteTwinPropertyLock, spacingM = 0.5) {
  const bounds = bboxForProperty(property);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  let spacing = Math.max(0.35, spacingM);
  const estimated = Math.ceil(width / spacing) * Math.ceil(height / spacing);
  if (estimated > 4_800) {
    spacing = Math.sqrt((width * height) / 4_500);
  }
  const points: Array<{ longitude: number; latitude: number }> = [];
  for (let y = bounds.minY; y <= bounds.maxY + 1e-6; y += spacing) {
    for (let x = bounds.minX; x <= bounds.maxX + 1e-6; x += spacing) {
      const lonLat = fromWebMercator(x, y);
      points.push({ longitude: lonLat.longitude, latitude: lonLat.latitude });
    }
  }
  return points.slice(0, 4_950);
}

function surfaceZ(item: Exclude<NonNullable<IgnElevationResponse["elevations"]>[number], number>) {
  const candidates = (item.measures ?? [])
    .filter((measure) => Number.isFinite(Number(measure.z)))
    .map((measure) => ({
      z: Number(measure.z),
      label: `${measure.source_name ?? ""} ${measure.title ?? ""}`.toLowerCase(),
    }));
  const explicitSurface = candidates.filter((candidate) => /mns|sursol|surface/.test(candidate.label));
  if (explicitSurface.length) return Math.max(...explicitSurface.map((candidate) => candidate.z));
  // MNX can expose MNT + MNS in the measures array. The surface elevation is
  // necessarily the highest valid value at a building point.
  if (candidates.length) return Math.max(...candidates.map((candidate) => candidate.z));
  const direct = Number(item.z);
  return Number.isFinite(direct) ? direct : undefined;
}

export async function sampleIgnLidarSurface(property: SiteTwinPropertyLock): Promise<IgnElevationPoint[]> {
  const samples = metricGrid(property, 0.5);
  if (!samples.length) throw new SiteTwinError("IGN_ELEVATION_UNAVAILABLE", "Grille LiDAR IGN vide.");

  const response = await fetch(ALTITUDE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      lon: samples.map((point) => point.longitude.toFixed(8)).join("|"),
      lat: samples.map((point) => point.latitude.toFixed(8)).join("|"),
      resource: IGN_MNX_RESOURCE,
      delimiter: "|",
      indent: "false",
      measures: "true",
      zonly: "false",
    }),
    signal: AbortSignal.timeout(45_000),
  }).catch((error) => {
    throw new SiteTwinError("IGN_ELEVATION_UNAVAILABLE", "L'API altimétrique LiDAR HD IGN n'a pas répondu.", {
      recoverable: true,
      cause: error,
    });
  });

  if (!response.ok) {
    throw new SiteTwinError("IGN_ELEVATION_UNAVAILABLE", `API LiDAR HD IGN indisponible (${response.status}).`, { recoverable: true });
  }
  const payload = await response.json() as IgnElevationResponse;
  const elevations = payload.elevations ?? [];
  const result: IgnElevationPoint[] = [];
  for (let index = 0; index < elevations.length; index += 1) {
    const item = elevations[index];
    if (typeof item === "number") {
      if (Number.isFinite(item) && item > -99_000) result.push({ ...samples[index]!, z: item });
      continue;
    }
    if (!item) continue;
    const z = surfaceZ(item);
    if (z == null || z <= -99_000) continue;
    result.push({
      longitude: Number.isFinite(Number(item.lon)) ? Number(item.lon) : samples[index]!.longitude,
      latitude: Number.isFinite(Number(item.lat)) ? Number(item.lat) : samples[index]!.latitude,
      z,
    });
  }
  if (result.length < 120) {
    throw new SiteTwinError(
      "IGN_ELEVATION_UNAVAILABLE",
      `Couverture LiDAR HD IGN insuffisante sur ce bâtiment (${result.length} points valides).`,
      { recoverable: true, details: { validPoints: result.length, requestedPoints: samples.length } },
    );
  }
  return result;
}

export async function discoverIgnCopcTiles(property: SiteTwinPropertyLock): Promise<IgnCopcTile[]> {
  const bounds = bboxForProperty(property, 2);
  const sw = fromWebMercator(bounds.minX, bounds.minY);
  const ne = fromWebMercator(bounds.maxX, bounds.maxY);
  const url = new URL(COPC_WFS_ENDPOINT);
  url.searchParams.set("SERVICE", "WFS");
  url.searchParams.set("VERSION", "2.0.0");
  url.searchParams.set("REQUEST", "GetFeature");
  url.searchParams.set("TYPENAMES", "IGNF_NUAGES-DE-POINTS-LIDAR-HD:dalle");
  url.searchParams.set("SRSNAME", "EPSG:4326");
  url.searchParams.set("OUTPUTFORMAT", "application/json");
  url.searchParams.set("COUNT", "8");
  url.searchParams.set("BBOX", `${sw.longitude},${sw.latitude},${ne.longitude},${ne.latitude},EPSG:4326`);

  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return [];
    const payload = await response.json() as { features?: Array<{ id?: string; properties?: Record<string, unknown> }> };
    return (payload.features ?? []).flatMap((feature, index) => {
      const directUrl = String(feature.properties?.url ?? feature.properties?.URL ?? "").trim();
      return /^https:\/\//i.test(directUrl)
        ? [{ id: String(feature.id ?? `ign-copc-${index}`), url: directUrl }]
        : [];
    });
  } catch {
    return [];
  }
}
