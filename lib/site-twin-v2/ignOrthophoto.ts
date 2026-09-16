const IGN_WMS_ENDPOINT = "https://data.geopf.fr/wms-r/wms";
const ORTHO_LAYER = "HR.ORTHOIMAGERY.ORTHOPHOTOS";
const WEB_MERCATOR_LIMIT = 20_037_508.342789244;
const REFERENCE_SPAN_M = 160;
const REFERENCE_PIXELS = 1600;
const MAX_ATTEMPTS = 3;

function toWebMercator(longitude: number, latitude: number) {
  const boundedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  return {
    x: (longitude * WEB_MERCATOR_LIMIT) / 180,
    y: (Math.log(Math.tan(((90 + boundedLatitude) * Math.PI) / 360)) * WEB_MERCATOR_LIMIT) / Math.PI,
  };
}

function requestUrl(longitude: number, latitude: number) {
  const center = toWebMercator(longitude, latitude);
  const half = REFERENCE_SPAN_M / 2;
  const url = new URL(IGN_WMS_ENDPOINT);
  const params: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: ORTHO_LAYER,
    STYLES: "normal",
    CRS: "EPSG:3857",
    BBOX: [center.x - half, center.y - half, center.x + half, center.y + half].join(","),
    WIDTH: String(REFERENCE_PIXELS),
    HEIGHT: String(REFERENCE_PIXELS),
    FORMAT: "image/geotiff",
    TRANSPARENT: "false",
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

function isTiff(bytes: Uint8Array) {
  if (bytes.length < 8) return false;
  const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00;
  const bigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a;
  return littleEndian || bigEndian;
}

async function downloadOnce(longitude: number, latitude: number) {
  const response = await fetch(requestUrl(longitude, latitude), {
    headers: { Accept: "image/geotiff,image/tiff;q=0.9,*/*;q=0.1" },
    signal: AbortSignal.timeout(35_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`orthophoto IGN HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 50_000) {
    const preview = Buffer.from(bytes.subarray(0, Math.min(300, bytes.length))).toString("utf8").replace(/\s+/g, " ");
    throw new Error(`orthophoto IGN anormalement petite (${bytes.length} octets${preview ? `, réponse ${preview.slice(0, 120)}` : ""})`);
  }
  if (!isTiff(bytes)) throw new Error("orthophoto IGN reçue dans un format qui n'est pas TIFF/GeoTIFF");
  return bytes;
}

/**
 * Public georeferenced orthophoto used only as a camera-registration reference.
 * It never changes Site Twin roof geometry or PV coordinates.
 */
export async function fetchIgnOrthophotoGeoTiff(args: { longitude: number; latitude: number }) {
  const failures: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return {
        bytes: await downloadOnce(args.longitude, args.latitude),
        source: "ign-orthophoto" as const,
        reference: `${ORTHO_LAYER}:EPSG3857:${REFERENCE_SPAN_M}m`,
        attempts: attempt,
      };
    } catch (error) {
      failures.push(`tentative ${attempt}: ${error instanceof Error ? error.message : "échec inconnu"}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw new Error(`Orthophoto IGN géoréférencée indisponible après ${MAX_ATTEMPTS} tentatives : ${failures.join(" | ")}`);
}
