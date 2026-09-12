import { toWebMercator } from "../context/officialParcel";
import type { GoogleSolarBuildingInsights } from "../providers/googleSolar";
import type { Point2D } from "../types";
import { listGoogleSolarFaces } from "./googleSolarFaceSelection";

export type ObservedRoofFaceForIdentity = {
  id: string;
  roofPolygonNormalized: Point2D[];
};

export type StableRoofFaceIdentityMatch = {
  observedId: string;
  faceId: string;
  originalSegmentIndex: number;
  centerNormalized: Point2D;
  distanceNormalized: number;
};

function centroid(points: Point2D[]) {
  const valid = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!valid.length) return undefined;
  return {
    x: valid.reduce((sum, point) => sum + point.x, 0) / valid.length,
    y: valid.reduce((sum, point) => sum + point.y, 0) / valid.length,
  };
}

export function googleSolarFaceCentersNormalized(args: {
  insights: GoogleSolarBuildingInsights;
  imageCenter: { longitude: number; latitude: number };
  groundWidthMeters: number;
  groundHeightMeters: number;
}) {
  const imageCenter = toWebMercator(args.imageCenter.longitude, args.imageCenter.latitude);
  return listGoogleSolarFaces(args.insights).map((face) => {
    const center = toWebMercator(face.segment.center.longitude, face.segment.center.latitude);
    return {
      ...face,
      centerNormalized: {
        x: 0.5 + (center.x - imageCenter.x) / args.groundWidthMeters,
        y: 0.5 - (center.y - imageCenter.y) / args.groundHeightMeters,
      },
    };
  });
}

/**
 * Binds the independent IGN/OpenAI polygons to the stable A/B/C identities
 * already shown to the user from Google Solar. Matching is one-to-one and
 * spatial. A face is never renamed merely because the vision model returned
 * another alphabetical order.
 */
export function matchObservedRoofFacesToGoogleSolarIds(args: {
  insights: GoogleSolarBuildingInsights;
  observedFaces: ObservedRoofFaceForIdentity[];
  imageCenter: { longitude: number; latitude: number };
  groundWidthMeters: number;
  groundHeightMeters: number;
  maximumDistanceNormalized?: number;
}): StableRoofFaceIdentityMatch[] {
  const maximumDistance = Math.max(0.02, args.maximumDistanceNormalized ?? 0.24);
  const stableFaces = googleSolarFaceCentersNormalized(args);
  const candidates = args.observedFaces.flatMap((observed) => {
    const observedCenter = centroid(observed.roofPolygonNormalized);
    if (!observedCenter) return [];
    return stableFaces.map((stable) => ({
      observedId: observed.id,
      faceId: stable.faceId,
      originalSegmentIndex: stable.originalSegmentIndex,
      centerNormalized: stable.centerNormalized,
      distanceNormalized: Math.hypot(
        observedCenter.x - stable.centerNormalized.x,
        observedCenter.y - stable.centerNormalized.y,
      ),
    }));
  }).sort((a, b) => a.distanceNormalized - b.distanceNormalized);

  const usedObserved = new Set<string>();
  const usedStable = new Set<string>();
  const matches: StableRoofFaceIdentityMatch[] = [];
  for (const candidate of candidates) {
    if (candidate.distanceNormalized > maximumDistance) continue;
    if (usedObserved.has(candidate.observedId) || usedStable.has(candidate.faceId)) continue;
    usedObserved.add(candidate.observedId);
    usedStable.add(candidate.faceId);
    matches.push(candidate);
  }
  return matches;
}
