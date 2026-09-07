import { env } from "cloudflare:workers";
import { ensureProjectSchema } from "@/lib/ensure-project-schema";
import { getRequestUser } from "@/lib/request-user";

const IGN_WMS_ENDPOINT = "https://data.geopf.fr/wms-r/wms";
const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 1000;
const SITUATION_GROUND_WIDTH_METERS = 196;
const SITUATION_GROUND_HEIGHT_METERS = 140;
const MASS_GROUND_WIDTH_METERS = 56;
const MASS_GROUND_HEIGHT_METERS = 40;
const WEB_MERCATOR_LIMIT = 20_037_508.342789244;

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toWebMercator(longitude: number, latitude: number) {
  const boundedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const x = (longitude * WEB_MERCATOR_LIMIT) / 180;
  const y =
    (Math.log(Math.tan(((90 + boundedLatitude) * Math.PI) / 360)) *
      WEB_MERCATOR_LIMIT) /
    Math.PI;
  return { x, y };
}

function buildIgnImageUrl(
  longitude: number,
  latitude: number,
  groundWidthMeters: number,
  groundHeightMeters: number,
) {
  const { x, y } = toWebMercator(longitude, latitude);
  const url = new URL(IGN_WMS_ENDPOINT);
  const bbox = [
    x - groundWidthMeters / 2,
    y - groundHeightMeters / 2,
    x + groundWidthMeters / 2,
    y + groundHeightMeters / 2,
  ].join(",");
  const parameters = {
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS:
      "HR.ORTHOIMAGERY.ORTHOPHOTOS,CADASTRALPARCELS.PARCELLAIRE_EXPRESS",
    STYLES: "normal,normal",
    CRS: "EPSG:3857",
    BBOX: bbox,
    WIDTH: String(IMAGE_WIDTH),
    HEIGHT: String(IMAGE_HEIGHT),
    FORMAT: "image/png",
    TRANSPARENT: "false",
  };
  Object.entries(parameters).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  return url;
}

async function fetchIgnPng(sourceUrl: URL) {
  let response: Response;
  try {
    response = await fetch(sourceUrl, {
      headers: { Accept: "image/png" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("La vue aérienne officielle IGN est temporairement indisponible.");
  }
  if (!response.ok) {
    throw new Error(`La Géoplateforme IGN a refusé la vue aérienne (${response.status}).`);
  }
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
  const bytes = await response.arrayBuffer();
  if (contentType !== "image/png" || bytes.byteLength < 50_000 || bytes.byteLength > 15 * 1024 * 1024) {
    throw new Error("La réponse IGN n’est pas une vue aérienne exploitable.");
  }
  return bytes;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = getRequestUser(request.headers);
  if (!user) {
    return Response.json({ error: "Authentification requise." }, { status: 401 });
  }
  await ensureProjectSchema();

  const { id: projectId } = await context.params;
  const project = await env.DB.prepare(
    "SELECT id FROM projects WHERE id = ? AND owner_email = ? LIMIT 1",
  )
    .bind(projectId, user.email)
    .first<{ id: string }>();
  if (!project) {
    return Response.json({ error: "Dossier introuvable." }, { status: 404 });
  }

  const input = (await request.json().catch(() => null)) as {
    longitude?: number;
    latitude?: number;
  } | null;
  const longitude = Number(input?.longitude);
  const latitude = Number(input?.latitude);
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -85 ||
    latitude > 85
  ) {
    return Response.json(
      { error: "Les coordonnées IGN du projet sont invalides." },
      { status: 400 },
    );
  }

  const sourceUrl = buildIgnImageUrl(
    longitude,
    latitude,
    SITUATION_GROUND_WIDTH_METERS,
    SITUATION_GROUND_HEIGHT_METERS,
  );
  const massSourceUrl = buildIgnImageUrl(
    longitude,
    latitude,
    MASS_GROUND_WIDTH_METERS,
    MASS_GROUND_HEIGHT_METERS,
  );
  let bytes: ArrayBuffer;
  let massBytes: ArrayBuffer;
  try {
    [bytes, massBytes] = await Promise.all([
      fetchIgnPng(sourceUrl),
      fetchIgnPng(massSourceUrl),
    ]);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Les vues aériennes IGN sont indisponibles." },
      { status: 503 },
    );
  }

  const sha256 = toHex(await crypto.subtle.digest("SHA-256", bytes));
  const massSha256 = toHex(await crypto.subtle.digest("SHA-256", massBytes));
  const fileId = crypto.randomUUID();
  const massFileId = crypto.randomUUID();
  const fileName = `vue-satellite-ign-${projectId}.png`;
  const massFileName = `vue-satellite-masse-ign-${projectId}.png`;
  const objectKey = `projects/${projectId}/sources/satellite/${fileId}-${fileName}`;
  const massObjectKey = `projects/${projectId}/sources/satellite_mass/${massFileId}-${massFileName}`;
  await Promise.all([
    env.BUCKET.put(objectKey, bytes, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: {
        projectId,
        ownerEmail: user.email,
        kind: "satellite",
        sha256,
        source: "IGN Geoplateforme WMS-Raster",
        groundWidthMeters: String(SITUATION_GROUND_WIDTH_METERS),
        groundHeightMeters: String(SITUATION_GROUND_HEIGHT_METERS),
      },
    }),
    env.BUCKET.put(massObjectKey, massBytes, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: {
        projectId,
        ownerEmail: user.email,
        kind: "satellite_mass",
        sha256: massSha256,
        source: "IGN Geoplateforme WMS-Raster",
        groundWidthMeters: String(MASS_GROUND_WIDTH_METERS),
        groundHeightMeters: String(MASS_GROUND_HEIGHT_METERS),
      },
    }),
  ]);

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO project_files (
          id, project_id, owner_email, kind, file_name, mime_type,
          size_bytes, sha256, object_key
        ) VALUES (?, ?, ?, 'satellite', ?, 'image/png', ?, ?, ?)`,
      ).bind(fileId, projectId, user.email, fileName, bytes.byteLength, sha256, objectKey),
      env.DB.prepare(
        `INSERT INTO project_files (
          id, project_id, owner_email, kind, file_name, mime_type,
          size_bytes, sha256, object_key
        ) VALUES (?, ?, ?, 'satellite_mass', ?, 'image/png', ?, ?, ?)`,
      ).bind(massFileId, projectId, user.email, massFileName, massBytes.byteLength, massSha256, massObjectKey),
    ]);
    return Response.json(
      {
        file: { id: fileId, kind: "satellite", fileName, mimeType: "image/png", sizeBytes: bytes.byteLength, sha256 },
        massFile: { id: massFileId, kind: "satellite_mass", fileName: massFileName, mimeType: "image/png", sizeBytes: massBytes.byteLength, sha256: massSha256 },
        source: {
          provider: "IGN Géoplateforme",
          service: "WMS-Raster",
          layer: "HR.ORTHOIMAGERY.ORTHOPHOTOS + Parcellaire Express PCI",
          url: sourceUrl.toString(),
          widthPixels: IMAGE_WIDTH,
          heightPixels: IMAGE_HEIGHT,
          groundWidthMeters: SITUATION_GROUND_WIDTH_METERS,
          groundHeightMeters: SITUATION_GROUND_HEIGHT_METERS,
          metersPerPixel: SITUATION_GROUND_WIDTH_METERS / IMAGE_WIDTH,
          generatedAt: new Date().toISOString(),
        },
        massSource: {
          provider: "IGN Géoplateforme",
          service: "WMS-Raster",
          layer: "HR.ORTHOIMAGERY.ORTHOPHOTOS + Parcellaire Express PCI",
          url: massSourceUrl.toString(),
          widthPixels: IMAGE_WIDTH,
          heightPixels: IMAGE_HEIGHT,
          groundWidthMeters: MASS_GROUND_WIDTH_METERS,
          groundHeightMeters: MASS_GROUND_HEIGHT_METERS,
          metersPerPixel: MASS_GROUND_WIDTH_METERS / IMAGE_WIDTH,
          generatedAt: new Date().toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    await Promise.all([env.BUCKET.delete(objectKey), env.BUCKET.delete(massObjectKey)]);
    throw error;
  }
}
