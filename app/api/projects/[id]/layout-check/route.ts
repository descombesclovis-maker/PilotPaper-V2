import { env } from "cloudflare:workers";
import { getRequestUser } from "@/lib/request-user";
import { ensureProjectSchema } from "@/lib/ensure-project-schema";
import { openaiJson } from "@/lib/dp-ai-engine/providers/openaiJson";
import { deriveMetricRoofFaces } from "@/lib/dp-ai-engine/providers/openaiVision";
import { resolveProjectLayout } from "@/lib/dp-ai-engine/geometry/projectLayout";
import { resolveVerifiedPvModule } from "@/lib/pv-module-catalog";
import type {
  InputPhoto,
  ProjectForm,
  RoofCovering,
  RoofFaceObservation,
  RoofTopology,
} from "@/lib/dp-ai-engine/types";

const point = {
  type: "object",
  additionalProperties: false,
  properties: {
    x: { type: "number", minimum: 0, maximum: 1 },
    y: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["x", "y"],
} as const;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    faces: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          slopeDeg: { type: ["number", "null"], minimum: 0, maximum: 75 },
          roofPolygonNormalized: { type: "array", minItems: 4, maxItems: 4, items: point },
          obstacles: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { type: "string" },
                description: { type: "string" },
                polygonNormalized: { type: ["array", "null"], items: point },
              },
              required: ["type", "description", "polygonNormalized"],
            },
          },
        },
        required: ["id", "label", "confidence", "slopeDeg", "roofPolygonNormalized", "obstacles"],
      },
    },
    uncertainties: { type: "array", items: { type: "string" } },
  },
  required: ["faces", "uncertainties"],
} as const;

type Payload = {
  moduleCount?: number;
  moduleReference?: string;
  panelGapMm?: number;
  layoutRows?: number;
  layoutColumns?: number;
  layoutMode?: "fixed" | "automatic";
  moduleOrientation?: "portrait" | "landscape";
  roofPitchDeg?: number;
  preferredGutterClearanceMm?: number;
  roofSelectionMode?: "automatic" | "priority";
  priorityRoofFaceId?: string;
  supportType?: string;
  roofTopology?: string;
  coveringType?: string;
};

type Raw = {
  faces: Array<{
    id: string;
    label: string;
    confidence: number;
    slopeDeg: number | null;
    roofPolygonNormalized: Array<{ x: number; y: number }>;
    obstacles: Array<{
      type: string;
      description: string;
      polygonNormalized?: Array<{ x: number; y: number }> | null;
    }>;
  }>;
  uncertainties: string[];
};

function configured(name: string) {
  const workerEnv = env as unknown as Record<string, unknown>;
  const value = workerEnv[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function topology(value: string | undefined): RoofTopology {
  if (["gable", "mono_pitch", "hipped", "flat", "carport", "canopy", "unknown"].includes(value ?? "")) {
    return value as RoofTopology;
  }
  return "unknown";
}

function covering(value: string | undefined): RoofCovering {
  if (["tile", "slate", "steel_sheet", "zinc", "membrane", "other", "unknown"].includes(value ?? "")) {
    return value as RoofCovering;
  }
  return "unknown";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = getRequestUser(request.headers);
  if (!user) return Response.json({ error: "Authentification requise." }, { status: 401 });
  await ensureProjectSchema();

  const { id } = await context.params;
  const project = await env.DB.prepare(
    "SELECT id, site_address AS siteAddress, form_data AS formData FROM projects WHERE id=? AND owner_email=? LIMIT 1",
  ).bind(id, user.email).first<{ id: string; siteAddress: string; formData: string }>();
  if (!project) return Response.json({ error: "Dossier introuvable." }, { status: 404 });

  const body = await request.json().catch(() => null) as Payload | null;
  if (!body) return Response.json({ error: "Configuration photovoltaïque absente." }, { status: 400 });

  const module = resolveVerifiedPvModule(body.moduleReference ?? "");
  if (!module) {
    return Response.json({
      code: "MODULE_REFERENCE_UNKNOWN",
      error: "La référence du module n'est pas présente dans le catalogue fabricant vérifié. Ajoutez sa fiche technique fabricant avant l'analyse du calepinage.",
    }, { status: 422 });
  }

  const count = Math.trunc(finiteNumber(body.moduleCount));
  if (count < 1) return Response.json({ error: "Nombre de panneaux requis." }, { status: 422 });

  const apiKey = configured("OPENAI_API_KEY");
  if (!apiKey) return Response.json({ error: "OPENAI_API_KEY manque pour analyser les pans." }, { status: 503 });

  const row = await env.DB.prepare(
    "SELECT file_name AS fileName,mime_type AS mimeType,object_key AS objectKey FROM project_files WHERE project_id=? AND owner_email=? AND kind='satellite_mass' ORDER BY created_at DESC LIMIT 1",
  ).bind(id, user.email).first<{ fileName: string; mimeType: string; objectKey: string }>();
  if (!row) return Response.json({ error: "La vue IGN rapprochée manque." }, { status: 422 });
  const object = await env.BUCKET.get(row.objectKey);
  if (!object) return Response.json({ error: "La vue IGN rapprochée est introuvable." }, { status: 422 });
  const bytes = new Uint8Array(await object.arrayBuffer());

  const rows = Math.max(1, Math.trunc(finiteNumber(body.layoutRows, 1)));
  const columns = Math.max(1, Math.trunc(finiteNumber(body.layoutColumns, count)));
  const gutterClearanceMm = Math.max(0, finiteNumber(body.preferredGutterClearanceMm, 300));
  const panelGapMm = Math.max(0, finiteNumber(body.panelGapMm, 20));
  const roofPitchDeg = Math.max(0, Math.min(75, finiteNumber(body.roofPitchDeg, 0)));

  const form: ProjectForm = {
    projectId: id,
    address: project.siteAddress,
    panel: {
      model: module.canonicalReference,
      widthMm: module.widthMm,
      heightMm: module.heightMm,
      powerWp: module.powerWp,
    },
    requestedPanelCount: count,
    array: {
      rows,
      columns,
      orientation: body.moduleOrientation === "landscape" ? "landscape" : "portrait",
      roofFace: body.priorityRoofFaceId || "A",
      placement: "centered",
      layoutMode: body.layoutMode === "automatic" ? "automatic" : "fixed",
      allowSplitAcrossFaces: true,
      interPanelGapMm: panelGapMm,
      gutterClearanceMm,
    },
    roofGeometry: { slopeDeg: roofPitchDeg, source: "ign-derived" },
    roofSelection: {
      mode: body.roofSelectionMode === "priority" ? "priority" : "automatic",
      priorityFaceId: body.roofSelectionMode === "priority" ? body.priorityRoofFaceId : undefined,
    },
    support: {
      topology: topology(body.roofTopology ?? (body.supportType === "carport" ? "carport" : undefined)),
      covering: covering(body.coveringType),
      existingStructure: true,
    },
  };

  const prompt = `Analyze ONLY the target building roof/support visible near the center of this official orthographic IGN image for photovoltaic capacity preflight. Address: ${project.siteAddress}. Detect every distinct usable plane separated by a real ridge/hip/edge. Assign stable IDs A, B, C... in left-to-right image order, then top-to-bottom when needed. For each face return exactly four corners ordered low-edge-left, low-edge-right, high-edge-right, high-edge-left. Do not treat bac-acier ribs/corrugations as ridges. Do not invent a second plane on a mono-pitch roof/carport. Report chimneys, roof windows, vents and other true exclusion obstacles. The supplied roof pitch ${roofPitchDeg} degrees is authoritative when nonzero; otherwise estimate slope only as a rough aid and list uncertainty. Do not invent metric dimensions; PilotPaper calculates them from the official image scale.`;

  let raw: Raw;
  try {
    raw = await openaiJson<Raw>({
      apiKey,
      model: configured("DP_ANALYSIS_MODEL") || "gpt-5.6-sol",
      prompt,
      imageDataUrls: [`data:image/png;base64,${Buffer.from(bytes).toString("base64")}`],
      schemaName: "pilotpaper_layout_faces",
      schema: schema as unknown as Record<string, unknown>,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Analyse des pans impossible." }, { status: 502 });
  }

  const faces: RoofFaceObservation[] = raw.faces.map((face) => ({
    id: face.id,
    label: face.label,
    confidence: face.confidence,
    slopeDeg: face.slopeDeg ?? undefined,
    views: [{
      role: "satellite_mass",
      faceId: face.id,
      selectedFaceVisible: true,
      confidence: face.confidence,
      roofPolygonNormalized: face.roofPolygonNormalized,
      perspectiveNotes: [],
    }],
    obstacles: face.obstacles.map((obstacle) => ({
      type: obstacle.type,
      description: obstacle.description,
      polygonNormalized: obstacle.polygonNormalized ?? undefined,
      viewRole: "satellite_mass",
    })),
  }));

  let saved: Record<string, unknown> = {};
  try {
    saved = JSON.parse(project.formData || "{}") as Record<string, unknown>;
  } catch {
    saved = {};
  }
  const storedMpp = Number(saved.satelliteMassMetersPerPixel);
  if (!(storedMpp > 0)) {
    return Response.json({
      error: "L’échelle métrique réelle de la vue IGN rapprochée manque. Régénérez la vue depuis l’étape Site.",
    }, { status: 422 });
  }

  const photo: InputPhoto = {
    role: "satellite_mass",
    mimeType: "image/png",
    base64: "",
    filename: row.fileName,
    widthPx: 1400,
    heightPx: 1000,
    metersPerPixel: storedMpp,
  };
  const roofFaces = deriveMetricRoofFaces(form, [photo], faces);
  if (!roofFaces.length) {
    return Response.json({
      error: "Aucun pan exploitable n’a pu être mesuré sur la vue IGN.",
      uncertainties: raw.uncertainties,
    }, { status: 422 });
  }

  let layout;
  try {
    layout = resolveProjectLayout({ ...form, roofFaces });
  } catch (error) {
    return Response.json({
      fits: false,
      error: error instanceof Error ? error.message : "La quantité demandée ne tient pas sur les pans détectés.",
      faces: roofFaces,
      roofFacesJson: JSON.stringify(roofFaces),
      uncertainties: raw.uncertainties,
    }, { status: 422 });
  }

  return Response.json({
    fits: true,
    module: {
      manufacturer: module.manufacturer,
      model: module.model,
      canonicalReference: module.canonicalReference,
      widthMm: module.widthMm,
      heightMm: module.heightMm,
      powerWp: module.powerWp,
      sourceUrl: module.sourceUrl,
      verifiedAt: module.verifiedAt,
    },
    faces: roofFaces,
    placements: layout.placements,
    split: layout.split,
    resolvedGutterMm: Math.min(...layout.placements.map((placement) => placement.resolvedGutterMm)),
    roofFacesJson: JSON.stringify(roofFaces),
    uncertainties: raw.uncertainties,
  });
}
