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

function pointInsideParcel(point: LonLat, parcel: OfficialParcelContext) {
  return parcelRings(parcel.parcelGeometry).some((ring) => pointInLonLatPolygon(point, ring));
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
  if (!pointInsideParcel(lonLat, context.parcel)) return false;
  return distanceToBuildingFootprintM(lonLat, context.building) <= 1.75;
}

function evidenceRatio<T>(
  items: T[],
  predicate: (item: T) => boolean,
) {
  if (!items.length) return 0;
  return items.filter(predicate).length / items.length;
}

/**
 * Google Solar's building-level `center` is useful, but it is not precise enough
 * to be the only identity proof. Some valid houses have a center displaced by
 * several metres while their roof segments and panel cells still overlap the
 * exact BD TOPO footprint.
 *
 * We therefore accept Solar only when at least one independent geometric signal
 * strongly matches BOTH the official parcel and the target building. Individual
 * roof faces are still filtered more strictly afterwards by
 * pointBelongsToTargetProperty(), so accepting a compound Solar payload cannot
 * make a neighbouring face selectable.
 */
export function googleSolarMatchesTargetBuilding(
  solar: GoogleSolarBuildingInsights,
  context: Pick<TargetRoofContext, "parcel" | "building">,
) {
  const center: LonLat = [solar.center.longitude, solar.center.latitude];
  const centerInsideParcel = pointInsideParcel(center, context.parcel);
  const centerDistance = distanceToBuildingFootprintM(center, context.building);

  const segments = solar.solarPotential.roofSegmentStats ?? [];
  const panels = solar.solarPotential.solarPanels ?? [];

  const segmentInsideParcelRatio = evidenceRatio(segments, (segment) => (
    pointInsideParcel([segment.center.longitude, segment.center.latitude], context.parcel)
  ));
  const segmentNearBuildingRatio = evidenceRatio(segments, (segment) => (
    distanceToBuildingFootprintM(
      [segment.center.longitude, segment.center.latitude],
      context.building,
    ) <= 3.5
  ));
  const matchingSegmentCount = segments.filter((segment) => {
    const point: LonLat = [segment.center.longitude, segment.center.latitude];
    return pointInsideParcel(point, context.parcel)
      && distanceToBuildingFootprintM(point, context.building) <= 3.5;
  }).length;

  const panelInsideParcelRatio = evidenceRatio(panels, (panel) => (
    pointInsideParcel([panel.center.longitude, panel.center.latitude], context.parcel)
  ));
  const panelNearBuildingRatio = evidenceRatio(panels, (panel) => (
    distanceToBuildingFootprintM(
      [panel.center.longitude, panel.center.latitude],
      context.building,
    ) <= 2.75
  ));
  const matchingPanelCount = panels.filter((panel) => {
    const point: LonLat = [panel.center.longitude, panel.center.latitude];
    return pointInsideParcel(point, context.parcel)
      && distanceToBuildingFootprintM(point, context.building) <= 2.75;
  }).length;

  const centerEvidence = centerInsideParcel && centerDistance <= 6;
  const segmentEvidence = matchingSegmentCount >= 1
    && segmentInsideParcelRatio >= 0.5
    && segmentNearBuildingRatio >= 0.35;
  const panelEvidence = matchingPanelCount >= 3
    && panelInsideParcelRatio >= 0.5
    && panelNearBuildingRatio >= 0.35;

  return centerEvidence || segmentEvidence || panelEvidence;
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

  if (!googleSolarMatchesTargetBuilding(solar, { parcel, building })) {
    throw new Error(
      "Google Solar n'a pas pu démontrer avec suffisamment de certitude qu'il s'agit du bâtiment cadastral de l'adresse.",
    );
  }

  return { parcel, building, solar };
}
