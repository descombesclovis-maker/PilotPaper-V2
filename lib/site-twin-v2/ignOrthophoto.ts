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

function requestDefinition(longitude: number, latitude: number) {
  const center = toWebMercator(longitude, latitude);
  const half = REFERENCE_SPAN_M / 2;
  const bbox: [number, number, number, number] = [
    center.x - half,
    center.y - half,
    center.x + half,
    center.y + half,
  ];
  const url = new URL(IGN_WMS_ENDPOINT);
  const params: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: ORTHO_LAYER,
    STYLES: "normal",
    CRS: "EPSG:3857",
    BBOX: bbox.join(","),
    WIDTH: String(REFERENCE_PIXELS),
    HEIGHT: String(REFERENCE_PIXELS),
    FORMAT: "image/png",
    TRANSPARENT: "false",
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return { url, bbox };
}

function assertUsablePng(bytes: Uint8Array) {
  if (bytes.length < 20_000) {
    const preview = Buffer.from(bytes.subarray(0, Math.min(300, bytes.length))).toString("utf8").replace(/\s+/g, " ");
    throw new Error(`orthophoto IGN anormalement petite (${bytes.length} octets${preview ? `, réponse ${preview.slice(0, 120)}` : ""})`);
  }
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!pngSignature.every((value, index) => bytes[index] === value)) {
    throw new Error("orthophoto IGN reçue dans un format qui n'est pas PNG");
  }
  if (bytes.length < 24) throw new Error("orthophoto IGN PNG tronquée");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width < 512 || height < 512) {
    throw new Error(`orthophoto IGN trop petite pour le recalage (${width}×${height})`);
  }
  return { width, height };
}

async function downloadOnce(longitude: number, latitude: number) {
  const definition = requestDefinition(longitude, latitude);
  const response = await fetch(definition.url, {
    headers: { Accept: "image/png,*/*;q=0.1" },
    signal: AbortSignal.timeout(35_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`orthophoto IGN HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const dimensions = assertUsablePng(bytes);
  return { bytes, bbox: definition.bbox, ...dimensions };
}

/**
 * Public IGN orthophoto used only as a camera-registration reference.
 * WMS PNG pixels are accompanied by the exact EPSG:3857 request BBOX, so the
 * Geometry Engine can map geographic module corners into the reference image
 * deterministically without pretending the PNG itself embeds GeoTIFF metadata.
 */
export async function fetchIgnOrthophotoReference(args: { longitude: number; latitude: number }) {
  const failures: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await downloadOnce(args.longitude, args.latitude);
      return {
        bytes: result.bytes,
        mimeType: "image/png" as const,
        crs: "EPSG:3857",
        bbox: result.bbox,
        source: "ign-orthophoto" as const,
        reference: `${ORTHO_LAYER}:EPSG3857:${REFERENCE_SPAN_M}m`,
        attempts: attempt,
      };
    } catch (error) {
      failures.push(`tentative ${attempt}: ${error instanceof Error ? error.message : "échec inconnu"}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw new Error(`Orthophoto IGN indisponible après ${MAX_ATTEMPTS} tentatives : ${failures.join(" | ")}`);
}
