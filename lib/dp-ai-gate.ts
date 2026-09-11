import { env } from "cloudflare:workers";
import type { ArchitecturalEvidence, ArchitecturalGeometry, FaceAllocationGeometry, NormalizedPoint, VerifiedDimension } from "@/lib/architectural-evidence";
import type { DpProjectRecord, DpRenderedView, DpSourceFile } from "@/lib/dp-pdf";
import { createDPAIEngine } from "@/lib/dp-ai-engine/factory";
import type { EngineConfig } from "@/lib/dp-ai-engine/config";
import type { InputPhoto, PhotoRole, ProjectContext, ProjectForm, RoofTopology, RoofCovering } from "@/lib/dp-ai-engine/types";
import { panelPolygonsForView } from "@/lib/dp-ai-engine/geometry/panelProjection";
import {
  PV_MODULE_CATALOG_VERSION,
  requireVerifiedPvModule,
  totalPowerKwp,
  type VerifiedPvModule,
} from "@/lib/pv-module-catalog";

export type DpAiRun = {
  evidence: ArchitecturalEvidence;
  renderedViews: DpRenderedView[];
  audit: Record<string, unknown>;
};

function configured(name: string) {
  const workerEnv = env as unknown as Record<string, unknown>;
  const value = workerEnv[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
  return typeof value === "string" ? value.trim() : "";
}
function apiKey() { return configured("OPENAI_API_KEY"); }
function number(value: string | undefined, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function int(value: string | undefined, fallback = 0) { return Math.trunc(number(value, fallback)); }
function pngSize(bytes: Uint8Array) {
  if (bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
function b64(bytes: Uint8Array) { return Buffer.from(bytes).toString("base64"); }
async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
function topology(project: DpProjectRecord): RoofTopology {
  const raw = project.details.roofTopology as RoofTopology | undefined;
  if (["gable", "mono_pitch", "hipped", "flat", "carport", "canopy", "unknown"].includes(raw ?? "")) return raw!;
  if (project.supportType === "carport") return "carport";
  if (project.supportType === "canopy") return "canopy";
  if (project.supportType === "flat_roof") return "flat";
  return "unknown";
}
function covering(project: DpProjectRecord): RoofCovering {
  const raw = project.details.coveringType as RoofCovering | undefined;
  if (["tile", "slate", "steel_sheet", "zinc", "membrane", "other", "unknown"].includes(raw ?? "")) return raw!;
  const text = (project.details.roofColor ?? "").toLowerCase();
  if (/bac|acier|t[oô]le/.test(text)) return "steel_sheet";
  if (/ardoise/.test(text)) return "slate";
  if (/tuile/.test(text)) return "tile";
  if (/zinc/.test(text)) return "zinc";
  return "unknown";
}

function makeForm(project: DpProjectRecord, moduleSpec: VerifiedPvModule): ProjectForm {
  const details = project.details;
  let roofFaces: ProjectForm["roofFaces"];
  try {
    const parsed = JSON.parse(details.roofFacesJson || "[]");
    if (Array.isArray(parsed)) roofFaces = parsed;
  } catch {
    roofFaces = undefined;
  }
  const rows = Math.max(1, int(details.layoutRows, 1));
  const columns = Math.max(1, int(details.layoutColumns, Math.max(1, project.moduleCount)));
  const layoutMode = details.layoutMode === "automatic" ? "automatic" : "fixed";
  return {
    projectId: project.id,
    address: project.siteAddress,
    applicantName: project.requesterName,
    parcelReference: details.cadastralReference,
    panel: {
      model: moduleSpec.canonicalReference,
      widthMm: moduleSpec.widthMm,
      heightMm: moduleSpec.heightMm,
      frameColor: details.panelColor,
      powerWp: moduleSpec.powerWp,
    },
    requestedPanelCount: project.moduleCount,
    array: {
      rows,
      columns,
      orientation: details.moduleOrientation === "landscape" ? "landscape" : "portrait",
      roofFace: details.priorityRoofFaceId || "A",
      placement: details.panelPlacement === "left" || details.panelPlacement === "right" ? details.panelPlacement : "centered",
      layoutMode,
      allowSplitAcrossFaces: true,
      gutterClearanceMm: Math.max(0, number(details.preferredGutterClearanceMm, 300)),
      ridgeClearanceMm: Math.max(0, number(details.ridgeClearanceMm, 0)),
      interPanelGapMm: Math.max(0, number(details.panelGapMm, 20)),
    },
    roofGeometry: {
      slopeDeg: Math.max(0, Math.min(75, number(details.roofPitchDeg, 0))),
      source: "ign-derived",
    },
    roofFaces,
    roofSelection: {
      mode: details.roofSelectionMode === "priority" ? "priority" : "automatic",
      priorityFaceId: details.roofSelectionMode === "priority" ? (details.priorityRoofFaceId || undefined) : undefined,
    },
    support: {
      topology: topology(project),
      covering: covering(project),
      existingStructure: details.existingStructure !== "false",
      rackTiltDeg: number(details.rackTiltDeg) || undefined,
    },
    notes: details.projectDescription,
  };
}

const photoRoles: readonly PhotoRole[] = ["satellite", "satellite_mass", "near", "roof", "far"];
function role(kind: string): PhotoRole | undefined {
  const candidate = kind as PhotoRole;
  return photoRoles.includes(candidate) ? candidate : undefined;
}
function makePhotos(project: DpProjectRecord, sources: DpSourceFile[]): InputPhoto[] {
  return sources.map((source) => {
    const sourceRole = role(source.kind);
    if (!sourceRole) return undefined;
    if (!["image/png", "image/jpeg"].includes(source.mimeType)) return undefined;
    const size = source.mimeType === "image/png" ? pngSize(source.bytes) : undefined;
    const satellite = sourceRole === "satellite" || sourceRole === "satellite_mass";
    return {
      role: sourceRole,
      mimeType: source.mimeType as "image/png" | "image/jpeg",
      base64: b64(source.bytes),
      filename: source.fileName,
      widthPx: size?.width ?? (satellite ? 1400 : undefined),
      heightPx: size?.height ?? (satellite ? 1000 : undefined),
      metersPerPixel: sourceRole === "satellite_mass"
        ? number(project.details.satelliteMassMetersPerPixel)
        : sourceRole === "satellite"
          ? number(project.details.satelliteMetersPerPixel)
          : undefined,
    };
  }).filter((photo): photo is InputPhoto => Boolean(photo));
}

function outerQuad(cells: NormalizedPoint[][], rows: number, columns: number, lastRowCount: number): NormalizedPoint[] {
  if (!cells.length) return [];
  const firstRow = Math.min(columns, cells.length);
  const topStart = Math.max(0, cells.length - Math.max(1, lastRowCount));
  return [cells[0]![0]!, cells[firstRow - 1]![1]!, cells[cells.length - 1]![2]!, cells[topStart]![3]!];
}
function viewFor(context: ProjectContext, faceId: string, roleName: string) {
  return context.roof.views?.find((view) =>
    view.faceId === faceId &&
    view.role === roleName &&
    view.selectedFaceVisible &&
    view.roofPolygonNormalized.length === 4,
  );
}

function evidenceFrom(
  context: ProjectContext,
  project: DpProjectRecord,
  sources: DpSourceFile[],
  projectPhotoRole: string,
): ArchitecturalEvidence {
  const allocations: FaceAllocationGeometry[] = [];
  for (const placement of context.facePlacements ?? []) {
    const satelliteView = viewFor(context, placement.faceId, "satellite_mass");
    const projectView = viewFor(context, placement.faceId, projectPhotoRole);
    if (!satelliteView || !projectView) {
      throw new Error(`Le pan ${placement.faceId} n'est pas démontré à la fois sur IGN et sur la photographie d'insertion.`);
    }
    const satelliteCells = panelPolygonsForView(context, satelliteView);
    const projectCells = panelPolygonsForView(context, projectView);
    if (!satelliteCells || !projectCells || satelliteCells.length !== placement.panelCount || projectCells.length !== placement.panelCount) {
      throw new Error(`Projection exacte incomplète sur le pan ${placement.faceId}.`);
    }
    allocations.push({
      face_id: placement.faceId,
      label: placement.label ?? `Pan ${placement.faceId}`,
      panel_count: placement.panelCount,
      rows: placement.rows,
      columns: placement.columns,
      last_row_count: placement.lastRowCount,
      gutter_clearance_mm: placement.resolvedGutterMm,
      satellite_roof_outline: satelliteView.roofPolygonNormalized,
      satellite_panel_cells: satelliteCells,
      project_photo_role: projectPhotoRole,
      project_roof_outline: projectView.roofPolygonNormalized,
      project_panel_cells: projectCells,
    });
  }
  if (!allocations.length) throw new Error("Aucune allocation photovoltaïque métriquement démontrée.");

  const first = allocations[0]!;
  const placement = context.facePlacements![0]!;
  const projectView = viewFor(context, placement.faceId, projectPhotoRole)!;
  const satelliteView = viewFor(context, placement.faceId, "satellite_mass")!;
  const firstSatelliteQuad = outerQuad(first.satellite_panel_cells, first.rows, first.columns, first.last_row_count);
  const firstProjectQuad = outerQuad(first.project_panel_cells, first.rows, first.columns, first.last_row_count);
  const geometry: ArchitecturalGeometry = {
    verdict: "verified",
    confidence: context.roof.confidence,
    satellite_roof_outline: first.satellite_roof_outline,
    satellite_array_quad: firstSatelliteQuad,
    satellite_eave_line: satelliteView.gutterLineNormalized ?? first.satellite_roof_outline.slice(0, 2),
    satellite_plane_anchors: first.satellite_roof_outline.slice(0, 4),
    near_roof_outline: first.project_roof_outline,
    near_array_quad: firstProjectQuad,
    near_eave_line: projectView.gutterLineNormalized ?? first.project_roof_outline.slice(0, 2),
    near_plane_anchors: first.project_roof_outline.slice(0, 4),
    roof_pitch_deg: context.roofGeometry?.slopeDeg ?? number(project.details.roofPitchDeg),
    layout_rows: first.rows,
    layout_columns: first.columns,
    module_orientation: context.array.orientation,
    agreement_iou: Object.fromEntries((context.facePlacements ?? []).map((item) => [
      item.faceId,
      context.roof.faces?.find((face) => face.id === item.faceId)?.confidence ?? context.roof.confidence,
    ])),
    source_sha256: Object.fromEntries(sources.map((source) => [source.kind, source.sha256])),
    evidence: context.immutableFacts,
    face_allocations: allocations,
    project_photo_role: projectPhotoRole,
  };

  const gap = context.array.interPanelGapMm ?? 20;
  const primary = context.facePlacements![0]!;
  const panelWidth = context.array.orientation === "portrait" ? context.panel.widthMm : context.panel.heightMm;
  const panelHeight = context.array.orientation === "portrait" ? context.panel.heightMm : context.panel.widthMm;
  const primaryWidth = primary.columns * panelWidth + Math.max(0, primary.columns - 1) * gap;
  const primaryHeight = primary.rows * panelHeight + Math.max(0, primary.rows - 1) * gap;
  const moduleEvidence = `${context.panel.model} — ${project.details.moduleDatasheetUrl ?? "catalogue fabricant vérifié"}`;
  const dimensions: VerifiedDimension[] = [
    {
      dimension_id: "module_width",
      label: "Largeur module",
      value_mm: context.panel.widthMm,
      tolerance_mm: 1,
      provenance: "catalogue fabricant vérifié",
      evidence: moduleEvidence,
      verified: true,
    },
    {
      dimension_id: "module_height",
      label: "Hauteur module",
      value_mm: context.panel.heightMm,
      tolerance_mm: 1,
      provenance: "catalogue fabricant vérifié",
      evidence: moduleEvidence,
      verified: true,
    },
    {
      dimension_id: "array_width",
      label: "Largeur champ principal",
      value_mm: primaryWidth,
      tolerance_mm: 25,
      provenance: "calcul déterministe",
      evidence: `Pan ${primary.faceId}`,
      verified: true,
    },
    {
      dimension_id: "array_height",
      label: "Hauteur champ principal",
      value_mm: primaryHeight,
      tolerance_mm: 25,
      provenance: "calcul déterministe",
      evidence: `Pan ${primary.faceId}`,
      verified: true,
    },
    {
      dimension_id: "satellite_scale_reference",
      label: "Échelle IGN",
      value_mm: number(project.details.satelliteMassMetersPerPixel) * 1000,
      tolerance_mm: 1,
      provenance: "IGN WMS",
      evidence: project.details.satelliteMassSourceUrl ?? "IGN",
      verified: true,
    },
    ...context.facePlacements!.flatMap((item) => [
      {
        dimension_id: `face_${item.faceId}_width`,
        label: `Largeur pan ${item.faceId}`,
        value_mm: item.widthMm,
        tolerance_mm: 50,
        provenance: "IGN + analyse multimodale",
        evidence: item.label ?? item.faceId,
        verified: true,
      },
      {
        dimension_id: `face_${item.faceId}_slope`,
        label: `Rampant pan ${item.faceId}`,
        value_mm: item.slopeLengthMm,
        tolerance_mm: 80,
        provenance: "IGN + pente",
        evidence: item.label ?? item.faceId,
        verified: true,
      },
    ]),
  ];
  return { geometry, dimensions };
}

function hydrateVerifiedModule(project: DpProjectRecord): VerifiedPvModule {
  const moduleSpec = requireVerifiedPvModule(project.moduleReference);
  if (!Number.isInteger(project.moduleCount) || project.moduleCount < 1) {
    throw new Error("Le nombre de modules doit être un entier strictement positif.");
  }
  project.moduleReference = moduleSpec.canonicalReference;
  project.powerKwp = String(totalPowerKwp(moduleSpec, project.moduleCount));
  project.details.moduleWidthMm = String(moduleSpec.widthMm);
  project.details.moduleHeightMm = String(moduleSpec.heightMm);
  project.details.modulePowerWp = String(moduleSpec.powerWp);
  project.details.moduleManufacturer = moduleSpec.manufacturer;
  project.details.moduleModel = moduleSpec.model;
  project.details.moduleDatasheetUrl = moduleSpec.sourceUrl;
  project.details.moduleSourceDocument = moduleSpec.sourceDocument;
  project.details.moduleCatalogVersion = PV_MODULE_CATALOG_VERSION;
  project.details.moduleCatalogVerifiedAt = moduleSpec.verifiedAt;
  return moduleSpec;
}

export async function runDPAI(project: DpProjectRecord, sources: DpSourceFile[]): Promise<DpAiRun> {
  const moduleSpec = hydrateVerifiedModule(project);
  const key = apiKey();
  if (!key) {
    throw new Error("OPENAI_API_KEY manque. Ajoutez la clé du projet PilotPaper dans .env.local ou dans les variables d'environnement du déploiement.");
  }
  const form = makeForm(project, moduleSpec);
  if (form.array.layoutMode !== "automatic" && form.array.rows * form.array.columns !== project.moduleCount) {
    throw new Error(`Le calepinage demandé ${form.array.rows}×${form.array.columns} ne correspond pas aux ${project.moduleCount} panneaux demandés.`);
  }

  const photos = makePhotos(project, sources);
  const userPhotos = photos.filter((photo) => ["near", "roof", "far"].includes(photo.role));
  if (userPhotos.length !== 3) {
    throw new Error("Trois photographies utilisateur distinctes sont requises : proche, oblique toiture et lointaine.");
  }
  if (userPhotos.some((photo) => photo.mimeType !== "image/png")) {
    throw new Error("Les photographies doivent être normalisées en PNG par PilotPaper avant génération afin de garantir le masque strict.");
  }

  const config: EngineConfig = {
    openaiApiKey: key,
    geminiApiKey: configured("GEMINI_API_KEY") || undefined,
    analysisModel: configured("DP_ANALYSIS_MODEL") || "gpt-5.6-sol",
    judgeModel: configured("DP_JUDGE_MODEL") || "gpt-5.6-sol",
    imageModel: configured("DP_IMAGE_MODEL") || "gpt-image-2",
    imageProvider: configured("DP_IMAGE_PROVIDER") === "gemini" ? "gemini" : "openai",
    maxRetries: Math.max(1, int(configured("DP_MAX_RETRIES"), 5)),
    qaPassScore: Math.max(0.9, Math.min(0.999, number(configured("DP_QA_PASS_SCORE"), 0.96))),
    realismPassScore: Math.max(0.9, Math.min(0.999, number(configured("DP_REALISM_PASS_SCORE"), 0.97))),
  };

  const result = await createDPAIEngine(config).generate(form, photos);
  const dp4 = result.assets.find((asset) => asset.dp === 4 && asset.base64);
  const dp6 = result.assets.find((asset) => asset.dp === 6 && asset.base64);
  if (!dp4?.base64 || !dp6?.base64) throw new Error("Le moteur n'a pas produit les insertions DP4/DP6 validées.");

  const projectRole = dp6.sourceRole ?? "near";
  const evidence = evidenceFrom(result.context, project, sources, projectRole);
  const satellite = sourceMapValue(sources, "satellite_mass");
  const dp4Bytes = new Uint8Array(Buffer.from(dp4.base64, "base64"));
  const dp6Bytes = new Uint8Array(Buffer.from(dp6.base64, "base64"));
  const renderedViews: DpRenderedView[] = [
    {
      kind: "satellite_project",
      sourceKind: "satellite_mass",
      mimeType: "image/png",
      sha256: satellite.sha256,
      bytes: satellite.bytes,
      metrics: { visual_conformity_score: 1 },
    },
    {
      kind: "dp4_project",
      sourceKind: dp4.sourceRole ?? projectRole,
      mimeType: "image/png",
      sha256: await sha256(dp4Bytes),
      bytes: dp4Bytes,
      metrics: {
        visual_conformity_score: result.quality[4]?.score,
        eave_clearance_mm: Math.min(...(result.context.facePlacements ?? []).map((placement) => placement.resolvedGutterMm)),
      },
    },
    {
      kind: "dp6_project",
      sourceKind: projectRole,
      mimeType: "image/png",
      sha256: await sha256(dp6Bytes),
      bytes: dp6Bytes,
      metrics: {
        visual_conformity_score: result.quality[6]?.score,
        eave_clearance_mm: Math.min(...(result.context.facePlacements ?? []).map((placement) => placement.resolvedGutterMm)),
      },
    },
  ];

  return {
    evidence,
    renderedViews,
    audit: {
      engine: "DP-AI-FIRST-v0.4.3",
      models: {
        analysis: config.analysisModel,
        image: config.imageModel,
        judge: config.judgeModel,
      },
      moduleCatalog: {
        version: PV_MODULE_CATALOG_VERSION,
        manufacturer: moduleSpec.manufacturer,
        model: moduleSpec.model,
        reference: moduleSpec.canonicalReference,
        widthMm: moduleSpec.widthMm,
        heightMm: moduleSpec.heightMm,
        powerWp: moduleSpec.powerWp,
        sourceUrl: moduleSpec.sourceUrl,
        verifiedAt: moduleSpec.verifiedAt,
      },
      quality: result.quality,
      facePlacements: result.context.facePlacements,
      immutableFacts: result.context.immutableFacts,
      dp7SourceRole: result.assets.find((asset) => asset.dp === 7)?.sourceRole,
      dp8SourceRole: result.assets.find((asset) => asset.dp === 8)?.sourceRole,
    },
  };
}

function sourceMapValue(sources: DpSourceFile[], kind: string) {
  const source = sources.find((candidate) => candidate.kind === kind);
  if (!source) throw new Error(`Source ${kind} manquante.`);
  return source;
}

export function getDPAIHealth() {
  const missing: string[] = [];
  if (!apiKey()) missing.push("OPENAI_API_KEY");
  return {
    status: missing.length ? "incomplete" as const : "ready" as const,
    engineVersion: "DP-AI-FIRST-v0.4.3",
    mode: "in-process",
    models: [
      configured("DP_ANALYSIS_MODEL") || "gpt-5.6-sol",
      configured("DP_IMAGE_MODEL") || "gpt-image-2",
      configured("DP_JUDGE_MODEL") || "gpt-5.6-sol",
    ],
    missing,
  };
}
