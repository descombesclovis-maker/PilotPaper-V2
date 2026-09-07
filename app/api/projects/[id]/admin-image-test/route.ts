import { env } from "cloudflare:workers";
import { ensureProjectSchema } from "@/lib/ensure-project-schema";
import { getRequestUser, isPilotPaperAdmin } from "@/lib/request-user";
import { OpenAIVisionAnalyzer } from "@/lib/dp-ai-engine/providers/openaiVision";
import { TestFallbackVisionAnalyzer } from "@/lib/dp-ai-engine/providers/testFallbackVision";
import { OpenAIImageEditor } from "@/lib/dp-ai-engine/providers/openaiImage";
import { dpImagePrompt } from "@/lib/dp-ai-engine/prompts/dpImage";
import type { InputPhoto, ProjectForm, RoofCovering, RoofTopology } from "@/lib/dp-ai-engine/types";

const IGN_WMS_ENDPOINT = "https://data.geopf.fr/wms-r/wms";
const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 1000;
const SITUATION_GROUND_WIDTH_METERS = 196;
const SITUATION_GROUND_HEIGHT_METERS = 140;
const MASS_GROUND_WIDTH_METERS = 56;
const MASS_GROUND_HEIGHT_METERS = 40;
const WEB_MERCATOR_LIMIT = 20_037_508.342789244;

type ProjectRow = {
  id: string;
  siteAddress: string;
  formData: string;
};

type FileRow = {
  kind: string;
  fileName: string;
  mimeType: string;
  sha256: string;
  objectKey: string;
};

type TestInput = {
  dp?: 4 | 6;
  moduleReference?: string;
  moduleWidthMm?: number;
  moduleHeightMm?: number;
  moduleCount?: number;
  rows?: number;
  columns?: number;
  orientation?: "portrait" | "landscape";
  layoutMode?: "fixed" | "automatic";
  panelGapMm?: number;
  gutterClearanceMm?: number;
  ridgeClearanceMm?: number;
  placement?: "centered" | "left" | "right";
  roofFace?: string;
  roofPitchDeg?: number;
  roofTopology?: RoofTopology;
  covering?: RoofCovering;
  frameColor?: string;
};

function configured(name: string) {
  const workerEnv = env as unknown as Record<string, unknown>;
  const value = workerEnv[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
  return typeof value === "string" ? value.trim() : "";
}

function parseRecord(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toWebMercator(longitude: number, latitude: number) {
  const boundedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const x = (longitude * WEB_MERCATOR_LIMIT) / 180;
  const y = (Math.log(Math.tan(((90 + boundedLatitude) * Math.PI) / 360)) * WEB_MERCATOR_LIMIT) / Math.PI;
  return { x, y };
}

function buildIgnImageUrl(longitude: number, latitude: number, groundWidthMeters: number, groundHeightMeters: number) {
  const { x, y } = toWebMercator(longitude, latitude);
  const url = new URL(IGN_WMS_ENDPOINT);
  const bbox = [x - groundWidthMeters / 2, y - groundHeightMeters / 2, x + groundWidthMeters / 2, y + groundHeightMeters / 2].join(",");
  const params = {
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: "HR.ORTHOIMAGERY.ORTHOPHOTOS,CADASTRALPARCELS.PARCELLAIRE_EXPRESS",
    STYLES: "normal,normal",
    CRS: "EPSG:3857",
    BBOX: bbox,
    WIDTH: String(IMAGE_WIDTH),
    HEIGHT: String(IMAGE_HEIGHT),
    FORMAT: "image/png",
    TRANSPARENT: "false",
  };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

async function fetchIgnPng(url: URL) {
  const response = await fetch(url, {
    headers: { Accept: "image/png" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`IGN ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (contentType !== "image/png" || bytes.byteLength < 50_000) {
    throw new Error("La vue IGN reçue n'est pas exploitable.");
  }
  return bytes;
}

async function projectCoordinates(address: string, details: Record<string, unknown>) {
  const storedLongitude = Number(details.siteLongitude);
  const storedLatitude = Number(details.siteLatitude);
  if (Number.isFinite(storedLongitude) && Number.isFinite(storedLatitude) && Math.abs(storedLatitude) <= 85 && Math.abs(storedLongitude) <= 180) {
    return { longitude: storedLongitude, latitude: storedLatitude };
  }

  const url = new URL("https://data.geopf.fr/geocodage/search");
  url.searchParams.set("q", address);
  url.searchParams.set("index", "address");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Géocodage IGN ${response.status}`);
  const payload = await response.json() as { features?: Array<{ geometry?: { coordinates?: [number, number] } }> };
  const coordinates = payload.features?.[0]?.geometry?.coordinates;
  if (!coordinates) throw new Error("L'adresse du dossier n'a pas pu être géocodée par l'IGN.");
  return { longitude: coordinates[0], latitude: coordinates[1] };
}

function pngSize(bytes: Uint8Array) {
  if (bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function base64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

async function latestProjectPhotos(projectId: string, email: string) {
  const rows = await env.DB.prepare(
    `SELECT kind, file_name AS fileName, mime_type AS mimeType, sha256, object_key AS objectKey
     FROM project_files
     WHERE project_id = ? AND owner_email = ? AND kind IN ('near', 'roof')
     ORDER BY created_at DESC`,
  ).bind(projectId, email).all<FileRow>();

  const latest = new Map<string, FileRow>();
  for (const row of rows.results ?? []) if (!latest.has(row.kind)) latest.set(row.kind, row);
  const result: InputPhoto[] = [];
  for (const role of ["near", "roof"] as const) {
    const row = latest.get(role);
    if (!row) throw new Error(role === "near" ? "La photo proche manque." : "La photo oblique toiture manque.");
    const object = await env.BUCKET.get(row.objectKey);
    if (!object) throw new Error(`Le fichier ${row.fileName} n'est plus disponible.`);
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (row.mimeType !== "image/png") throw new Error(`La vue ${role} doit être normalisée en PNG avant le test.`);
    const size = pngSize(bytes);
    result.push({ role, mimeType: "image/png", base64: base64(bytes), filename: row.fileName, widthPx: size?.width, heightPx: size?.height });
  }
  return result;
}

function positive(value: unknown, label: string, minimum = 1) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) throw new Error(`${label} invalide.`);
  return number;
}

function makeForm(projectId: string, address: string, input: TestInput): ProjectForm {
  const count = Math.trunc(positive(input.moduleCount, "Quantité de panneaux"));
  const rows = Math.trunc(positive(input.rows ?? 1, "Nombre de rangées"));
  const columns = Math.trunc(positive(input.columns ?? count, "Nombre de colonnes"));
  const layoutMode = input.layoutMode === "automatic" ? "automatic" : "fixed";
  if (layoutMode === "fixed" && rows * columns !== count) {
    throw new Error(`Le calepinage fixe ${rows}×${columns} doit contenir exactement ${count} panneaux.`);
  }
  return {
    projectId,
    address,
    panel: {
      model: input.moduleReference?.trim() || "Module test",
      widthMm: positive(input.moduleWidthMm, "Largeur module"),
      heightMm: positive(input.moduleHeightMm, "Hauteur module"),
      frameColor: input.frameColor?.trim() || "noir",
    },
    requestedPanelCount: count,
    array: {
      rows,
      columns,
      orientation: input.orientation === "landscape" ? "landscape" : "portrait",
      roofFace: input.roofFace?.trim() || "A",
      placement: input.placement === "left" || input.placement === "right" ? input.placement : "centered",
      layoutMode,
      allowSplitAcrossFaces: layoutMode === "automatic",
      gutterClearanceMm: Math.max(0, Number(input.gutterClearanceMm ?? 300)),
      ridgeClearanceMm: Math.max(0, Number(input.ridgeClearanceMm ?? 0)),
      interPanelGapMm: Math.max(0, Number(input.panelGapMm ?? 20)),
    },
    roofGeometry: {
      slopeDeg: Math.max(0, Math.min(75, Number(input.roofPitchDeg ?? 0))),
      source: "ign-derived",
    },
    roofSelection: input.roofFace?.trim()
      ? { mode: "priority", priorityFaceId: input.roofFace.trim() }
      : { mode: "automatic" },
    support: {
      topology: input.roofTopology ?? "unknown",
      covering: input.covering ?? "unknown",
      existingStructure: true,
    },
    notes: "ADMIN IMAGE LAB — rendu isolé sans génération du dossier DP complet.",
  };
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = getRequestUser(request.headers);
  if (!user) return Response.json({ error: "Authentification requise." }, { status: 401 });
  if (!isPilotPaperAdmin(user.email, configured("PILOTPAPER_ADMIN_EMAILS"))) {
    return Response.json({ error: "Laboratoire réservé aux administrateurs PilotPaper." }, { status: 403 });
  }

  await ensureProjectSchema();
  const { id: projectId } = await context.params;
  const project = await env.DB.prepare(
    `SELECT id, site_address AS siteAddress, form_data AS formData
     FROM projects WHERE id = ? AND owner_email = ? LIMIT 1`,
  ).bind(projectId, user.email).first<ProjectRow>();
  if (!project) return Response.json({ error: "Dossier introuvable." }, { status: 404 });

  const input = await request.json().catch(() => null) as TestInput | null;
  if (!input || (input.dp !== 4 && input.dp !== 6)) {
    return Response.json({ error: "Sélectionnez DP4 ou DP6." }, { status: 400 });
  }

  const apiKey = configured("OPENAI_API_KEY");
  if (!apiKey) return Response.json({ error: "OPENAI_API_KEY manque." }, { status: 503 });

  try {
    const details = parseRecord(project.formData);
    const { longitude, latitude } = await projectCoordinates(project.siteAddress, details);
    const [near, roof] = await latestProjectPhotos(projectId, user.email);
    if (!near || !roof) throw new Error("Les deux photographies de laboratoire sont requises.");

    const situationUrl = buildIgnImageUrl(longitude, latitude, SITUATION_GROUND_WIDTH_METERS, SITUATION_GROUND_HEIGHT_METERS);
    const massUrl = buildIgnImageUrl(longitude, latitude, MASS_GROUND_WIDTH_METERS, MASS_GROUND_HEIGHT_METERS);
    const [satelliteBytes, massBytes] = await Promise.all([fetchIgnPng(situationUrl), fetchIgnPng(massUrl)]);
    const satellite: InputPhoto = {
      role: "satellite", mimeType: "image/png", base64: base64(satelliteBytes), filename: "ign-satellite.png",
      widthPx: IMAGE_WIDTH, heightPx: IMAGE_HEIGHT, metersPerPixel: SITUATION_GROUND_WIDTH_METERS / IMAGE_WIDTH,
    };
    const satelliteMass: InputPhoto = {
      role: "satellite_mass", mimeType: "image/png", base64: base64(massBytes), filename: "ign-satellite-mass.png",
      widthPx: IMAGE_WIDTH, heightPx: IMAGE_HEIGHT, metersPerPixel: MASS_GROUND_WIDTH_METERS / IMAGE_WIDTH,
    };

    const form = makeForm(projectId, project.siteAddress, input);
    const strictAnalyzer = new OpenAIVisionAnalyzer(apiKey, configured("DP_ANALYSIS_MODEL") || "gpt-5.6-sol", 2);
    const analyzer = new TestFallbackVisionAnalyzer(strictAnalyzer);
    const contextResult = await analyzer.analyze(form, [near, roof, satellite, satelliteMass]);

    const editor = new OpenAIImageEditor(apiKey, configured("DP_IMAGE_MODEL") || "gpt-image-2");
    const renderPhotos = input.dp === 4 ? [roof, near] : [near, roof];
    const asset = await editor.edit({
      dp: input.dp,
      context: contextResult,
      photos: renderPhotos,
      prompt: dpImagePrompt(input.dp, contextResult),
    });
    if (!asset.base64) throw new Error("GPT Image n'a renvoyé aucune image exploitable.");

    const bytes = new Uint8Array(Buffer.from(asset.base64, "base64"));
    const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
    const fileId = crypto.randomUUID();
    const fileName = `PilotPaper-ADMIN-TEST-DP${input.dp}-${projectId.slice(0, 8)}-${Date.now()}.png`;
    const objectKey = `projects/${projectId}/admin-tests/${fileId}-${fileName}`;
    const createdAt = new Date().toISOString();
    await env.BUCKET.put(objectKey, bytes, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: {
        projectId,
        ownerEmail: user.email,
        kind: `admin_dp${input.dp}_test`,
        sha256,
        status: "test_unverified",
        sourceRole: asset.sourceRole ?? "unknown",
        createdAt,
      },
    });
    await env.DB.prepare(
      `INSERT INTO project_files (
        id, project_id, owner_email, kind, file_name, mime_type,
        size_bytes, sha256, object_key, status
      ) VALUES (?, ?, ?, ?, ?, 'image/png', ?, ?, ?, 'test_unverified')`,
    ).bind(fileId, projectId, user.email, `admin_dp${input.dp}_test`, fileName, bytes.byteLength, sha256, objectKey).run();

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "X-PilotPaper-Admin-Lab": "true",
        "X-PilotPaper-DP": String(input.dp),
        "X-PilotPaper-Source-Role": asset.sourceRole ?? "unknown",
        "X-PilotPaper-SHA256": sha256,
        "X-PilotPaper-Roof-Confidence": String(contextResult.roof.confidence),
        "X-PilotPaper-Panel-Count": String(contextResult.exactPanelCount),
      },
    });
  } catch (error) {
    console.error("[PilotPaper][ADMIN-LAB] generation failed", error);
    return Response.json({
      error: error instanceof Error ? error.message : "Le laboratoire d'image a échoué.",
    }, { status: 422 });
  }
}
