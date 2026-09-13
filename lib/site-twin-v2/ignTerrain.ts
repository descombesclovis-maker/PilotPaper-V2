import { fromWebMercator, toWebMercator } from "@/lib/dp-ai-engine/context/officialParcel";
import type { SiteTwinPropertyLock } from "./propertyLock";

const ENDPOINT = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json";
const RESOURCE = "ign_lidar_hd_mnt_multi_wld";

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
  const points = offsets.map(([dx, dy]) => fromWebMercator(center.x + dx, center.y + dy));
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        lon: points.map((point) => point.longitude.toFixed(8)).join("|"),
        lat: points.map((point) => point.latitude.toFixed(8)).join("|"),
        resource: RESOURCE,
        delimiter: "|",
        indent: "false",
        measures: "false",
        zonly: "true",
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return undefined;
    const payload = await response.json() as { elevations?: number[] };
    const elevations = (payload.elevations ?? []).map(Number).filter((value) => Number.isFinite(value) && value > -99_000);
    if (!elevations.length) return undefined;
    elevations.sort((a, b) => a - b);
    return elevations[Math.floor(elevations.length / 2)];
  } catch {
    return undefined;
  }
}
