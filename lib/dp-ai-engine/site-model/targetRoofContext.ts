import {
  parcelRings,
  toWebMercator,
  resolveOfficialParcelContext,
  type LonLat,
  type OfficialParcelContext,
} from "../context/officialParcel";
import {
  fetchGoogleSolarBuildingInsights,
  type GoogleSolarBuildingInsights,
} from "../providers/googleSolar";
import { pointInLonLatPolygon, resolveTargetBuilding } from "./buildingResolver";
import type { BuildingFootprint } from "./types";

export type TargetRoofContext = {
  parcel: OfficialParcelContext;
  building: BuildingFootprint;
  solar: GoogleSolarBuildingInsights;
};

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

export function distanceToBuildingFootprintM(point: LonLat, building: BuildingFootprint) {
  if (pointInLonLatPolygon(point, building.polygon)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < building.polygon.length; index += 1) {
    const a = building.polygon[index]!;
    const b = building.polygon[(index + 1) % building.polygon.length]!;
    best = Math.min(best, pointToSegmentDistanceM(point, a, b));
  }
  return best;
}

export function pointBelongsToTargetProperty(
  point: { longitude: number; latitude: number },
  context: Pick<TargetRoofContext, "parcel" | "building">,
) {
  const lonLat: LonLat = [point.longitude, point.latitude];
  const insideParcel = parcelRings(context.parcel.parcelGeometry)
    .some((ring) => pointInLonLatPolygon(lonLat, ring));
  if (!insideParcel) return false;
  return distanceToBuildingFootprintM(lonLat, context.building) <= 1.75;
}

/**
 * Single source of truth for every automatic roof workflow.
 * Address -> official parcel -> exact BD TOPO building -> Google Solar on that
 * building. We never let the nearest neighbour returned around the address
 * silently become the project roof.
 */
export async function resolveTargetRoofContext(address: string): Promise<TargetRoofContext> {
  const parcel = await resolveOfficialParcelContext(address);
  const building = await resolveTargetBuilding(parcel);
  const [buildingLongitude, buildingLatitude] = building.centroid;
  const solar = await fetchGoogleSolarBuildingInsights({
    latitude: buildingLatitude,
    longitude: buildingLongitude,
  });

  const solarCenter: LonLat = [solar.center.longitude, solar.center.latitude];
  const solarInsideParcel = parcelRings(parcel.parcelGeometry)
    .some((ring) => pointInLonLatPolygon(solarCenter, ring));
  const solarBuildingDistance = distanceToBuildingFootprintM(solarCenter, building);
  if (!solarInsideParcel || solarBuildingDistance > 6) {
    throw new Error(
      "Google Solar a retourné un bâtiment qui ne correspond pas avec certitude au bâtiment cadastral de l'adresse.",
    );
  }

  return { parcel, building, solar };
}
