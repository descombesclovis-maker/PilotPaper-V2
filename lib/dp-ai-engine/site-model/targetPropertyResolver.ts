import {
  parcelRings,
  type OfficialParcelContext,
  type LonLat,
} from "../context/officialParcel";
import { pointInLonLatPolygon } from "./buildingResolver";

/**
 * Re-centres automatic building work only when the provider's physical point is
 * still inside the parcel established from the user's address.
 *
 * A roof provider is evidence about a building, never authority to replace the
 * cadastral project parcel. If Google Solar points to a neighbour, the original
 * address parcel remains locked and downstream face filtering rejects it.
 */
export async function resolveTargetParcelFromBuildingCenter(args: {
  addressContext: OfficialParcelContext;
  buildingCenter: { latitude: number; longitude: number };
}): Promise<OfficialParcelContext> {
  const point: LonLat = [args.buildingCenter.longitude, args.buildingCenter.latitude];
  const insideOriginalParcel = parcelRings(args.addressContext.parcelGeometry)
    .some((ring) => pointInLonLatPolygon(point, ring));

  if (!insideOriginalParcel) return args.addressContext;

  return {
    ...args.addressContext,
    longitude: args.buildingCenter.longitude,
    latitude: args.buildingCenter.latitude,
  };
}
