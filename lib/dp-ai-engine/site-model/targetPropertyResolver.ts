import {
  parseParcelGeometry,
  type OfficialParcelContext,
  type ParcelGeometry,
} from "../context/officialParcel";

async function officialParcel(args: { cityCode: string; section: string; parcelNumber: string }) {
  const url = new URL("https://apicarto.ign.fr/api/cadastre/parcelle");
  url.searchParams.set("code_insee", args.cityCode);
  url.searchParams.set("section", args.section);
  url.searchParams.set("numero", args.parcelNumber);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Target Property Resolver : APICARTO indisponible (${response.status}).`);
  const payload = await response.json() as {
    features?: Array<{ geometry?: unknown; properties?: { contenance?: number; idu?: string } }>;
  };
  const feature = payload.features?.[0];
  if (!feature?.geometry) throw new Error("Target Property Resolver : parcelle officielle absente.");
  const geometry: ParcelGeometry = parseParcelGeometry(feature.geometry);
  const areaM2 = Number(feature.properties?.contenance);
  if (!Number.isFinite(areaM2) || areaM2 <= 0) throw new Error("Target Property Resolver : superficie cadastrale invalide.");
  return { geometry, areaM2, idu: String(feature.properties?.idu ?? "").trim() };
}

/**
 * Corrects the common address-point-at-the-road problem: once a physical
 * building provider (Google Solar, later Aurora/Scanifly) identifies the
 * building center, the official parcel is resolved at that physical center.
 */
export async function resolveTargetParcelFromBuildingCenter(args: {
  addressContext: OfficialParcelContext;
  buildingCenter: { latitude: number; longitude: number };
}): Promise<OfficialParcelContext> {
  const reverse = new URL("https://data.geopf.fr/geocodage/reverse");
  reverse.searchParams.set("lon", String(args.buildingCenter.longitude));
  reverse.searchParams.set("lat", String(args.buildingCenter.latitude));
  reverse.searchParams.set("index", "parcel");
  reverse.searchParams.set("limit", "1");
  const response = await fetch(reverse, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Target Property Resolver : cadastre IGN indisponible (${response.status}).`);
  const payload = await response.json() as { features?: Array<{ properties?: Record<string, unknown> }> };
  const properties = payload.features?.[0]?.properties ?? {};
  const section = String(properties.section ?? "").trim();
  const parcelNumber = String(properties.number ?? properties.numero ?? "").trim();
  const cityCode = String(properties.citycode ?? properties.code_insee ?? args.addressContext.cityCode).trim();
  if (!section || !parcelNumber || !cityCode) {
    throw new Error("Target Property Resolver : le centre du bâtiment ne fournit pas une parcelle cadastrale certaine.");
  }

  const parcel = await officialParcel({ cityCode, section, parcelNumber });
  const parcelReference = [section, parcelNumber].filter(Boolean).join(" ") || parcel.idu;
  return {
    normalizedAddress: args.addressContext.normalizedAddress,
    longitude: args.buildingCenter.longitude,
    latitude: args.buildingCenter.latitude,
    municipality: args.addressContext.municipality,
    cityCode,
    section,
    parcelNumber,
    parcelReference,
    parcelAreaM2: parcel.areaM2,
    parcelGeometry: parcel.geometry,
  };
}
