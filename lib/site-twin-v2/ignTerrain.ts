import { fromWebMercator, toWebMercator } from "@/lib/dp-ai-engine/context/officialParcel";
import type { SiteTwinPropertyLock } from "./propertyLock";
import type { TwinLonLat } from "./types";

const ENDPOINT = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json";
const RESOURCE = "ign_lidar_hd_mnt_multi_wld";

function validElevation(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > -99_000 ? parsed : null;
}

/**
 * Samples the official IGN LiDAR HD terrain model at exact geographic points.
 * The returned array keeps the same point order. A null entry means IGN did
 * not provide a usable elevation for that exact sample; callers must not invent it.
 */
export async function sampleIgnTerrainElevations(points: TwinLonLat[]): Promise<Array<number | null> | undefined> {
  if (!points.length) return undefined;
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        lon: points.map((point) => point[0].toFixed(8)).join("|"),
        lat: points.map((point) => point[1].toFixed(8)).join("|"),
        resource: RESOURCE,
        delimiter: "|",
        indent: "false",
        measures: "false",
        zonly: "true",
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return undefined;
    const payload = await response.json() as { elevations?: unknown[] };
    if (!Array.isArray(payload.elevations) || payload.elevations.length !== points.length) return undefined;
    return payload.elevations.map(validElevation);
  } catch {
    return undefined;
  }
}

export async function sampleIgnTerrainElevation(property: SiteTwinPropertyLock) {
  const [longitude, latitude] = property.addressPoint;
  const center = toWebMercator(longitude, latitude);
  const offsets = [
    [0, 0],
    [-3, -3],
    [3, -3],
    [3, 3],
    [-3, 3],
  ] as const;
  const points: TwinLonLat[] = offsets.map(([dx, dy]) => {
    const point = fromWebMercator(center.x + dx, center.y + dy);
    return [point.longitude, point.latitude];
  });
  const sampled = await sampleIgnTerrainElevations(points);
  if (!sampled) return undefined;
  const elevations = sampled.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (!elevations.length) return undefined;
  return elevations[Math.floor(elevations.length / 2)];
}
