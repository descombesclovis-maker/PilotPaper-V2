import { SiteTwinError } from "./errors";

export type GoogleSolarDataLayers = {
  imageryDate?: { year?: number; month?: number; day?: number };
  imageryProcessedDate?: { year?: number; month?: number; day?: number };
  imageryQuality?: "HIGH" | "MEDIUM" | "BASE" | string;
  dsmUrl: string;
  rgbUrl?: string;
  maskUrl?: string;
};

const dataLayerCache = new Map<string, Promise<GoogleSolarDataLayers>>();
const geoTiffCache = new Map<string, Promise<Uint8Array>>();

function solarApiKey() {
  return (
    process.env.GOOGLE_SOLAR_API_KEY
    || process.env.SOLAR_API_KEY
    || process.env.GOOGLE_MAPS_API_KEY
    || ""
  ).trim();
}

function authenticatedGeoTiffUrl(url: string, apiKey: string) {
  const parsed = new URL(url);
  if (!parsed.searchParams.has("key")) parsed.searchParams.set("key", apiKey);
  return parsed.toString();
}

function dataLayerKey(latitude: number, longitude: number, radiusMeters: number, pixelSizeMeters: number) {
  return `${latitude.toFixed(6)}|${longitude.toFixed(6)}|${radiusMeters.toFixed(1)}|${pixelSizeMeters.toFixed(2)}`;
}

async function fetchGoogleSolarDataLayersUncached(args: {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  pixelSizeMeters: number;
}): Promise<GoogleSolarDataLayers> {
  const key = solarApiKey();
  if (!key) throw new SiteTwinError("GOOGLE_DATALAYERS_UNAVAILABLE", "Google Solar dataLayers : clé API absente.");

  const url = new URL("https://solar.googleapis.com/v1/dataLayers:get");
  url.searchParams.set("location.latitude", String(args.latitude));
  url.searchParams.set("location.longitude", String(args.longitude));
  url.searchParams.set("radiusMeters", String(args.radiusMeters));
  url.searchParams.set("view", "IMAGERY_LAYERS");
  url.searchParams.set("requiredQuality", "BASE");
  url.searchParams.set("exactQualityRequired", "false");
  url.searchParams.set("pixelSizeMeters", String(args.pixelSizeMeters));
  url.searchParams.set("key", key);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    throw new SiteTwinError(
      "GOOGLE_DATALAYERS_UNAVAILABLE",
      "Google Solar dataLayers n'a pas répondu à temps.",
      { recoverable: true, cause: error },
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new SiteTwinError(
      "GOOGLE_DATALAYERS_UNAVAILABLE",
      `Google Solar dataLayers indisponible (${response.status})${body ? ` : ${body.slice(0, 180)}` : ""}.`,
      { recoverable: true },
    );
  }

  const payload = await response.json() as Partial<GoogleSolarDataLayers>;
  if (!payload.dsmUrl) {
    throw new SiteTwinError(
      "GOOGLE_DATALAYERS_UNAVAILABLE",
      "Google Solar dataLayers n'a renvoyé aucun DSM exploitable.",
      { recoverable: true },
    );
  }

  return {
    imageryDate: payload.imageryDate,
    imageryProcessedDate: payload.imageryProcessedDate,
    imageryQuality: payload.imageryQuality,
    dsmUrl: authenticatedGeoTiffUrl(payload.dsmUrl, key),
    rgbUrl: payload.rgbUrl ? authenticatedGeoTiffUrl(payload.rgbUrl, key) : undefined,
    maskUrl: payload.maskUrl ? authenticatedGeoTiffUrl(payload.maskUrl, key) : undefined,
  };
}

export function fetchGoogleSolarDataLayers(args: {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  pixelSizeMeters?: number;
}): Promise<GoogleSolarDataLayers> {
  // Use one stable metric envelope for roof reconstruction and every photo
  // projection in the dossier. This prevents DP4/5/6 from obtaining a different
  // imagery vintage or reference URL than the Site Twin built moments earlier.
  const radiusMeters = Math.max(70, Math.min(100, args.radiusMeters ?? 70));
  const pixelSizeMeters = Math.max(0.1, Math.min(0.5, args.pixelSizeMeters ?? 0.1));
  const cacheKey = dataLayerKey(args.latitude, args.longitude, radiusMeters, pixelSizeMeters);
  const existing = dataLayerCache.get(cacheKey);
  if (existing) return existing;
  const promise = fetchGoogleSolarDataLayersUncached({
    latitude: args.latitude,
    longitude: args.longitude,
    radiusMeters,
    pixelSizeMeters,
  }).catch((error) => {
    dataLayerCache.delete(cacheKey);
    throw error;
  });
  dataLayerCache.set(cacheKey, promise);
  return promise;
}

async function downloadGoogleGeoTiffUncached(url: string, label: "DSM" | "RGB" | "MASK") {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "image/tiff,application/octet-stream" },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new SiteTwinError(
      "GOOGLE_DSM_DOWNLOAD_FAILED",
      `Téléchargement Google Solar ${label} interrompu.`,
      { recoverable: true, cause: error },
    );
  }
  if (!response.ok) {
    throw new SiteTwinError(
      "GOOGLE_DSM_DOWNLOAD_FAILED",
      `Téléchargement Google Solar ${label} impossible (${response.status}).`,
      { recoverable: true },
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 2_048) {
    throw new SiteTwinError("GOOGLE_DSM_DOWNLOAD_FAILED", `Google Solar ${label} vide ou anormalement petit.`);
  }
  const tiffMagic = (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
    || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  );
  if (!tiffMagic) {
    throw new SiteTwinError("GOOGLE_DSM_DOWNLOAD_FAILED", `Google Solar ${label} n'est pas un GeoTIFF valide.`);
  }
  return bytes;
}

export function downloadGoogleGeoTiff(url: string, label: "DSM" | "RGB" | "MASK") {
  const cacheKey = `${label}|${url}`;
  const existing = geoTiffCache.get(cacheKey);
  if (existing) return existing.then((bytes) => new Uint8Array(bytes));
  const promise = downloadGoogleGeoTiffUncached(url, label).catch((error) => {
    geoTiffCache.delete(cacheKey);
    throw error;
  });
  geoTiffCache.set(cacheKey, promise);
  return promise.then((bytes) => new Uint8Array(bytes));
}
