export type GoogleSolarLatLng = { latitude: number; longitude: number };
export type GoogleSolarLatLngBox = { sw: GoogleSolarLatLng; ne: GoogleSolarLatLng };

export type GoogleSolarRoofSegment = {
  pitchDegrees: number;
  azimuthDegrees: number;
  stats?: {
    areaMeters2?: number;
    groundAreaMeters2?: number;
    sunshineQuantiles?: number[];
  };
  center: GoogleSolarLatLng;
  boundingBox?: GoogleSolarLatLngBox;
  planeHeightAtCenterMeters?: number;
};

export type GoogleSolarPanel = {
  center: GoogleSolarLatLng;
  orientation: "PORTRAIT" | "LANDSCAPE" | "SOLAR_PANEL_ORIENTATION_UNSPECIFIED";
  yearlyEnergyDcKwh?: number;
  segmentIndex: number;
};

export type GoogleSolarBuildingInsights = {
  name?: string;
  center: GoogleSolarLatLng;
  boundingBox?: GoogleSolarLatLngBox;
  imageryDate?: { year?: number; month?: number; day?: number };
  imageryProcessedDate?: { year?: number; month?: number; day?: number };
  imageryQuality?: "HIGH" | "MEDIUM" | "BASE" | string;
  solarPotential: {
    maxArrayPanelsCount?: number;
    panelCapacityWatts?: number;
    panelHeightMeters: number;
    panelWidthMeters: number;
    roofSegmentStats: GoogleSolarRoofSegment[];
    solarPanels: GoogleSolarPanel[];
    solarPanelConfigs?: Array<{
      panelsCount?: number;
      yearlyEnergyDcKwh?: number;
      roofSegmentSummaries?: Array<{
        pitchDegrees?: number;
        azimuthDegrees?: number;
        panelsCount?: number;
        yearlyEnergyDcKwh?: number;
        segmentIndex?: number;
      }>;
    }>;
  };
};

function solarApiKey() {
  return (
    process.env.GOOGLE_SOLAR_API_KEY
    || process.env.SOLAR_API_KEY
    || process.env.GOOGLE_MAPS_API_KEY
    || ""
  ).trim();
}

export function googleSolarConfigured() {
  return solarApiKey().length > 12;
}

function validInsights(value: unknown): value is GoogleSolarBuildingInsights {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<GoogleSolarBuildingInsights>;
  const potential = record.solarPotential;
  return Boolean(
    record.center
    && Number.isFinite(record.center.latitude)
    && Number.isFinite(record.center.longitude)
    && potential
    && Number.isFinite(potential.panelHeightMeters)
    && Number.isFinite(potential.panelWidthMeters)
    && Array.isArray(potential.roofSegmentStats)
    && potential.roofSegmentStats.length > 0
    && Array.isArray(potential.solarPanels)
    && potential.solarPanels.length > 0,
  );
}

async function requestInsights(args: {
  latitude: number;
  longitude: number;
  quality: "MEDIUM" | "BASE";
  expandedCoverage?: boolean;
}) {
  const key = solarApiKey();
  if (!key) throw new Error("Google Solar API : clé absente.");
  const url = new URL("https://solar.googleapis.com/v1/buildingInsights:findClosest");
  url.searchParams.set("location.latitude", String(args.latitude));
  url.searchParams.set("location.longitude", String(args.longitude));
  url.searchParams.set("requiredQuality", args.quality);
  url.searchParams.set("exactQualityRequired", "false");
  if (args.expandedCoverage) url.searchParams.append("experiments", "EXPANDED_COVERAGE");
  url.searchParams.set("key", key);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Google Solar API indisponible (${response.status})${body ? ` : ${body.slice(0, 180)}` : ""}.`);
  }
  const payload = await response.json() as unknown;
  if (!validInsights(payload)) {
    throw new Error("Google Solar API : réponse sans géométrie/panneaux exploitables.");
  }
  return payload;
}

/**
 * Primary automatic rooftop provider for PilotPaper V1.
 * MEDIUM accepts HIGH or MEDIUM data. BASE expanded coverage is only a fallback.
 */
export async function fetchGoogleSolarBuildingInsights(args: {
  latitude: number;
  longitude: number;
}): Promise<GoogleSolarBuildingInsights> {
  if (!googleSolarConfigured()) throw new Error("Google Solar API : clé non configurée.");

  const standard = await requestInsights({
    latitude: args.latitude,
    longitude: args.longitude,
    quality: "MEDIUM",
  });
  if (standard) return standard;

  const expanded = await requestInsights({
    latitude: args.latitude,
    longitude: args.longitude,
    quality: "BASE",
    expandedCoverage: true,
  });
  if (expanded) return expanded;

  throw new Error("Google Solar API : aucun bâtiment solaire exploitable à cet emplacement.");
}
