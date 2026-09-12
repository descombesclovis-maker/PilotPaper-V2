import { env } from "cloudflare:workers";
import { getRequestUser } from "@/lib/request-user";
import { ensureProjectSchema } from "@/lib/ensure-project-schema";
import { openaiJson } from "@/lib/dp-ai-engine/providers/openaiJson";
import { fetchGoogleSolarBuildingInsights } from "@/lib/dp-ai-engine/providers/googleSolar";
import { deriveMetricRoofFaces } from "@/lib/dp-ai-engine/providers/openaiVision";
import { resolveProjectLayout } from "@/lib/dp-ai-engine/geometry/projectLayout";
import { matchObservedRoofFacesToGoogleSolarIds } from "@/lib/dp-ai-engine/site-model/googleSolarFaceIdentity";
import { resolveVerifiedPvModule } from "@/lib/pv-module-catalog";
import type {
  InputPhoto,
  ProjectForm,
  RoofCovering,
  RoofFaceObservation,
  RoofTopology,
} from "@/lib/dp-ai-engine/types";

const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 1000;

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
  selectedRoofFaceIds?: string[];
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

function uniqueFaceIds(body: Payload) {
  const explicit = Array.isArray(body.selectedRoofFaceIds) ? body.selectedRoofFaceIds : [];
  const legacySingle = body.roofSelectionMode === "priority" && body.priorityRoofFaceId
    ? [body.priorityRoofFaceId]
    : [];
  return [...new Set((explicit.length ? explicit : legacySingle)
    .map((id) => String(id ?? "").trim().toUpperCase())
    .filter(Boolean))];
}

function parseSavedRecord(value: string) {
  try {
    return JSON.parse(value || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
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

  const moduleSpec = resolveVerifiedPvModule(body.moduleReference ?? "");
  if (!moduleSpec) {
    return Response.json({
      code: "MODULE_REFERENCE_UNKNOWN",
      error: "La référence du module n'est pas présente dans le catalogue fabricant vérifié. Ajoutez sa fiche technique fabricant avant l'analyse du calepinage.",
    }, { status: 422 });
  }

  const count = Math.trunc(finiteNumber(body.moduleCount));
  if (count < 1) return Response.json({ error: "Nombre de panneaux requis." }, { status: 422 });

  const apiKey = configured("OPENAI_API_KEY");
  if (!apiKey) return Response.json({ error: "OPENAI_API_KEY manque pour analyser les pans." }, { status: 503 });

  const saved = parseSavedRecord(project.formData);
  const storedMpp = Number(saved.satelliteMassMetersPerPixel);
  const siteLongitude = Number(saved.siteLongitude);
  const siteLatitude = Number(saved.siteLatitude);
  if (!(storedMpp > 0) || !Number.isFinite(siteLongitude) || !Number.isFinite(siteLatitude)) {
    return Response.json({
      error: "L’échelle ou les coordonnées réelles de la vue IGN rapprochée manquent. Régénérez la vue depuis l’étape Site.",
    }, { status: 422 });
  }

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
      model: moduleSpec.canonicalReference,
      widthMm: moduleSpec.widthMm,
      heightMm: moduleSpec.heightMm,
      powerWp: moduleSpec.powerWp,
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
    roofSelection: { mode: "automatic" },
    support: {
      topology: topology(body.roofTopology ?? (body.supportType === "carport" ? "carport" : undefined)),
      covering: covering(body.coveringType),
      existingStructure: true,
    },
  };

  const prompt = `Analyze ONLY the target building roof/support visible near the center of this official orthographic IGN image for photovoltaic capacity preflight. Address: ${project.siteAddress}. Detect every distinct usable plane separated by a real ridge/hip/edge. Use temporary IDs V1, V2, V3...; DO NOT decide the final A/B/C identity because PilotPaper binds each polygon spatially to Google Solar after this vision pass. For each face return exactly four corners ordered low-edge-left, low-edge-right, high-edge-right, high-edge-left. Do not treat bac-acier ribs/corrugations as ridges. Do not invent a second plane on a mono-pitch roof/carport. Report chimneys, roof windows, vents and other true exclusion obstacles. The supplied roof pitch ${roofPitchDeg} degrees is authoritative when nonzero; otherwise estimate slope only as a rough aid and list uncertainty. Do not invent metric dimensions; PilotPaper calculates them from the official image scale.`;

  let raw: Raw;
  let solar;
  try {
    [raw, solar] = await Promise.all([
      openaiJson<Raw>({
        apiKey,
        model: configured("DP_ANALYSIS_MODEL") || "gpt-5.6-sol",
        prompt,
        imageDataUrls: [`data:image/png;base64,${Buffer.from(bytes).toString("base64")}`],
        schemaName: "pilotpaper_layout_faces",
        schema: schema as unknown as Record<string, unknown>,
      }),
      fetchGoogleSolarBuildingInsights({ latitude: siteLatitude, longitude: siteLongitude }),
    ]);
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Analyse et identification des pans impossibles.",
    }, { status: 502 });
  }

  const identityMatches = matchObservedRoofFacesToGoogleSolarIds({
    insights: solar,
    observedFaces: raw.faces.map((face) => ({
      id: face.id,
      roofPolygonNormalized: face.roofPolygonNormalized,
    })),
    imageCenter: { longitude: siteLongitude, latitude: siteLatitude },
    groundWidthMeters: storedMpp * IMAGE_WIDTH,
    groundHeightMeters: storedMpp * IMAGE_HEIGHT,
  });
  const identityByObserved = new Map(identityMatches.map((match) => [match.observedId, match]));

  const faces: RoofFaceObservation[] = raw.faces.map((face) => {
    const identity = identityByObserved.get(face.id);
    const stableId = identity?.faceId ?? `VISION_${face.id}`;
    return {
      id: stableId,
      label: identity ? `Pan ${identity.faceId} · ${face.label}` : `Pan non rapproché · ${face.label}`,
      confidence: face.confidence,
      slopeDeg: face.slopeDeg ?? undefined,
      views: [{
        role: "satellite_mass",
        faceId: stableId,
        selectedFaceVisible: true,
        confidence: face.confidence,
        roofPolygonNormalized: face.roofPolygonNormalized,
        perspectiveNotes: identity
          ? [`Identité physique Google Solar ${identity.faceId}, écart normalisé ${identity.distanceNormalized.toFixed(3)}.`]
          : ["Ce polygone IGN n'a pas pu être rattaché à une identité Google Solar stable."],
      }],
      obstacles: face.obstacles.map((obstacle) => ({
        type: obstacle.type,
        description: obstacle.description,
        polygonNormalized: obstacle.polygonNormalized ?? undefined,
        viewRole: "satellite_mass",
      })),
    };
  });

  const photo: InputPhoto = {
    role: "satellite_mass",
    mimeType: "image/png",
    base64: "",
    filename: row.fileName,
    widthPx: IMAGE_WIDTH,
    heightPx: IMAGE_HEIGHT,
    metersPerPixel: storedMpp,
  };
  const identityByStable = new Map(identityMatches.map((match) => [match.faceId, match]));
  const roofFaces = deriveMetricRoofFaces(form, [photo], faces).map((face) => {
    const identity = identityByStable.get(face.id);
    return identity
      ? {
          ...face,
          sourceCenterNormalized: identity.centerNormalized,
          sourceOriginalSegmentIndex: identity.originalSegmentIndex,
          identitySource: "google-solar" as const,
        }
      : face;
  });
  if (!roofFaces.length) {
    return Response.json({
      error: "Aucun pan exploitable n’a pu être mesuré sur la vue IGN.",
      uncertainties: raw.uncertainties,
    }, { status: 422 });
  }

  const requestedFaceIds = uniqueFaceIds(body);
  const selectedRoofFaces = requestedFaceIds.length
    ? roofFaces.filter((face) => requestedFaceIds.includes(face.id.toUpperCase()))
    : roofFaces.filter((face) => face.identitySource === "google-solar");
  const missingFaceIds = requestedFaceIds.filter((faceId) => !roofFaces.some((face) => face.id.toUpperCase() === faceId));
  if (missingFaceIds.length) {
    return Response.json({
      fits: false,
      error: `PilotPaper n'a pas pu rattacher précisément ${missingFaceIds.map((id) => `le pan ${id}`).join(", ")} à son polygone IGN. Aucun autre pan ne sera utilisé à sa place.`,
      faces: roofFaces,
      identityMatches,
      uncertainties: raw.uncertainties,
    }, { status: 422 });
  }
  if (!selectedRoofFaces.length) {
    return Response.json({
      fits: false,
      error: "Sélectionnez au moins un pan à équiper.",
      faces: roofFaces,
      identityMatches,
      uncertainties: raw.uncertainties,
    }, { status: 422 });
  }

  let layout;
  try {
    layout = resolveProjectLayout({ ...form, roofFaces: selectedRoofFaces });
  } catch (error) {
    return Response.json({
      fits: false,
      error: error instanceof Error ? error.message : "La quantité demandée ne tient pas sur les pans sélectionnés.",
      faces: roofFaces,
      selectedFaces: selectedRoofFaces,
      roofFacesJson: JSON.stringify(selectedRoofFaces),
      identityMatches,
      uncertainties: raw.uncertainties,
    }, { status: 422 });
  }

  return Response.json({
    fits: true,
    module: {
      manufacturer: moduleSpec.manufacturer,
      model: moduleSpec.model,
      canonicalReference: moduleSpec.canonicalReference,
      widthMm: moduleSpec.widthMm,
      heightMm: moduleSpec.heightMm,
      powerWp: moduleSpec.powerWp,
      sourceUrl: moduleSpec.sourceUrl,
      verifiedAt: moduleSpec.verifiedAt,
    },
    faces: roofFaces,
    selectedFaces: selectedRoofFaces,
    selectedFaceIds: selectedRoofFaces.map((face) => face.id),
    placements: layout.placements,
    usedFaceIds: layout.placements.map((placement) => placement.faceId),
    split: layout.split,
    resolvedGutterMm: Math.min(...layout.placements.map((placement) => placement.resolvedGutterMm)),
    roofFacesJson: JSON.stringify(selectedRoofFaces),
    identityMatches,
    uncertainties: raw.uncertainties,
  });
}
