import {
  parcelRings,
  toWebMercator,
  type LonLat,
  type OfficialParcelContext,
} from "../context/officialParcel";
import {
  fetchGoogleSolarBuildingInsights,
  type GoogleSolarBuildingInsights,
} from "../providers/googleSolar";
import { resolveAddressPropertyContext } from "./addressPropertyResolver";
import {
  closestBuildingToPoint,
  pointInLonLatPolygon,
} from "./buildingResolver";
import type { BuildingFootprint } from "./types";

export type TargetRoofContext = {
  parcel: OfficialParcelContext;
  building: BuildingFootprint;
  buildings: BuildingFootprint[];
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

function contextBuildings(context: Pick<TargetRoofContext, "building"> & Partial<Pick<TargetRoofContext, "buildings">>) {
  return context.buildings?.length ? context.buildings : [context.building];
}

export function pointBelongsToTargetProperty(
  point: { longitude: number; latitude: number },
  context: Pick<TargetRoofContext, "parcel" | "building"> & Partial<Pick<TargetRoofContext, "buildings">>,
) {
  const lonLat: LonLat = [point.longitude, point.latitude];
  if (!pointInsideParcel(lonLat, context.parcel)) return false;
  return Boolean(closestBuildingToPoint(contextBuildings(context), lonLat, 3.5));
}

function faceEvidencePoints(solar: GoogleSolarBuildingInsights, segmentIndex: number) {
  const segment = solar.solarPotential.roofSegmentStats[segmentIndex];
  if (!segment) return [] as LonLat[];
  const points: LonLat[] = [[segment.center.longitude, segment.center.latitude]];

  if (segment.boundingBox) {
    const { sw, ne } = segment.boundingBox;
    points.push(
      [sw.longitude, sw.latitude],
      [ne.longitude, ne.latitude],
      [sw.longitude, ne.latitude],
      [ne.longitude, sw.latitude],
      [(sw.longitude + ne.longitude) / 2, (sw.latitude + ne.latitude) / 2],
    );
  }

  for (const panel of solar.solarPotential.solarPanels) {
    if (panel.segmentIndex !== segmentIndex) continue;
    points.push([panel.center.longitude, panel.center.latitude]);
  }
  return points;
}

export function buildingForGoogleSolarFace(
  solar: GoogleSolarBuildingInsights,
  segmentIndex: number,
  context: Pick<TargetRoofContext, "parcel" | "building"> & Partial<Pick<TargetRoofContext, "buildings">>,
) {
  const buildings = contextBuildings(context);
  const points = faceEvidencePoints(solar, segmentIndex)
    .filter((point) => pointInsideParcel(point, context.parcel));
  if (!points.length) return undefined;

  const ranked = buildings.map((building) => {
    const distances = points.map((point) => distanceToBuildingFootprintM(point, building));
    const nearCount = distances.filter((distance) => distance <= 3.5).length;
    const veryNearCount = distances.filter((distance) => distance <= 1.75).length;
    const minDistance = Math.min(...distances);
    const meanDistance = distances.reduce((sum, distance) => sum + distance, 0) / distances.length;
    return {
      building,
      nearCount,
      veryNearCount,
      minDistance,
      meanDistance,
      score: veryNearCount * 20 + nearCount * 8 - minDistance * 4 - meanDistance,
    };
  }).sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.nearCount < 1 || best.minDistance > 3.5) return undefined;
  return best.building;
}

export function googleSolarMatchesTargetBuilding(
  solar: GoogleSolarBuildingInsights,
  context: Pick<TargetRoofContext, "parcel" | "building"> & Partial<Pick<TargetRoofContext, "buildings">>,
) {
  return solar.solarPotential.roofSegmentStats.some((_, index) => (
    Boolean(buildingForGoogleSolarFace(solar, index, context))
  ));
}

function googleSolarTargetScore(
  solar: GoogleSolarBuildingInsights,
  context: Pick<TargetRoofContext, "parcel" | "building"> & Partial<Pick<TargetRoofContext, "buildings">>,
) {
  let matchingFaces = 0;
  for (let index = 0; index < solar.solarPotential.roofSegmentStats.length; index += 1) {
    if (buildingForGoogleSolarFace(solar, index, context)) matchingFaces += 1;
  }
  const matchingPanels = solar.solarPotential.solarPanels.filter((panel) => (
    pointBelongsToTargetProperty(panel.center, context)
  )).length;
  const centerNearAddressedBuilding = Boolean(closestBuildingToPoint(
    contextBuildings(context),
    [solar.center.longitude, solar.center.latitude],
    8,
  ));
  return matchingFaces * 100 + matchingPanels * 2 + (centerNearAddressedBuilding ? 15 : 0);
}

/**
 * Single automatic roof context for every DP piece.
 * Address number -> addressed BD TOPO building -> cadastral parcel containing
 * that building -> Google Solar payload whose physical roof evidence belongs
 * to that same building. Google Solar never chooses or changes the property.
 */
export async function resolveTargetRoofContext(address: string): Promise<TargetRoofContext> {
  const property = await resolveAddressPropertyContext(address);
  const { parcel, building, buildings } = property;

  const solarCandidates: GoogleSolarBuildingInsights[] = [];
  const seenCenters = new Set<string>();
  for (const candidate of buildings.slice(0, 5)) {
    try {
      const [longitude, latitude] = candidate.centroid;
      const solar = await fetchGoogleSolarBuildingInsights({ latitude, longitude });
      const key = `${solar.center.latitude.toFixed(7)}:${solar.center.longitude.toFixed(7)}`;
      if (!seenCenters.has(key)) {
        seenCenters.add(key);
        solarCandidates.push(solar);
      }
    } catch {
      // A second component of the same addressed house can still lead Google
      // Solar to the correct physical building.
    }
  }

  if (!solarCandidates.length) {
    throw new Error("Google Solar API : aucune toiture exploitable n'a été trouvée sur le bâtiment correspondant au numéro d'adresse.");
  }

  const ranked = solarCandidates
    .map((candidate) => ({
      candidate,
      score: googleSolarTargetScore(candidate, { parcel, building, buildings }),
    }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 100) {
    throw new Error("Google Solar : aucun pan n'a pu être rattaché avec certitude au bâtiment correspondant à l'adresse.");
  }

  return { parcel, building, buildings, solar: best.candidate };
}
