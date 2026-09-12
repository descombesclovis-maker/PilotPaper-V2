import {
  cadastralCandidates,
  fetchIgnRaster,
  orthophotoCandidates,
} from "@/lib/dp-ai-engine/context/ignRaster";
import {
  metricFrameForParcel,
  projectParcelRingNormalized,
  resolveOfficialParcelContext,
  toWebMercator,
  type MetricFrame,
  type OfficialParcelContext,
} from "@/lib/dp-ai-engine/context/officialParcel";
import { allPanelPolygonsForRoleProjective } from "@/lib/dp-ai-engine/geometry/panelProjection";
import { resolveProjectLayout } from "@/lib/dp-ai-engine/geometry/projectLayout";
import {
  metricSurfaceFromManualRoofDesign,
  type ManualRoofDesign,
  type ManualRoofKeepout,
  type ManualRoofQuad,
} from "@/lib/dp-ai-engine/site-model/manualRoofDesigner";
import type { InputPhoto, Point2D, ProjectContext, ProjectForm } from "@/lib/dp-ai-engine/types";
import type { DpPieceInput, DpPieceOutput } from "@/lib/dp-piece-engine";
import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";

const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 1000;
const MASS_ASPECT = IMAGE_HEIGHT / IMAGE_WIDTH;

type Dp2OfficialContext = OfficialParcelContext & {
  parcelPolygonNormalized: Point2D[];
  mass: InputPhoto;
  metricFrame: MetricFrame;
  presentationFrame: MetricFrame;
  presentationOrthophoto: string;
  cadastralOverlay: string;
  addressPointNormalized: Point2D;
  imagerySource: string;
  presentationImagerySource: string;
  cadastreSource: string;
};

type ReviewedRoofDesign = ManualRoofDesign & { obstaclesConfirmed: true };
type Dp2Input = DpPieceInput & { manualRoofDesign?: unknown };

export class Dp2RoofDesignerRequiredError extends Error {
  readonly code = "DP2_ROOF_DESIGNER_REQUIRED";
  readonly reason: string;
  readonly imageBase64: string;
  readonly imageMimeType = "image/png" as const;
  readonly widthPx: number;
  readonly heightPx: number;

  constructor(official: Dp2OfficialContext) {
    super("PilotPaper a besoin que le pan soit validé dans le Roof Designer avant de générer la DP2.");
    this.name = "Dp2RoofDesignerRequiredError";
    this.reason = "Mode fiable : le pan et les obstacles sont validés sur l'orthophoto IGN métrée. Le LiDAR n'est pas requis.";
    this.imageBase64 = official.mass.base64;
    this.widthPx = official.mass.widthPx ?? IMAGE_WIDTH;
    this.heightPx = official.mass.heightPx ?? IMAGE_HEIGHT;
  }
}

function escapeXml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[char] ?? char);
}

function number(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} doit être un entier positif.`);
  return parsed;
}

function normalizedPoint(value: unknown, label: string): Point2D {
  if (!value || typeof value !== "object") throw new Error(`Roof Designer : ${label} invalide.`);
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    throw new Error(`Roof Designer : ${label} doit rester dans la vue aérienne.`);
  }
  return { x, y };
}

function asReviewedRoofDesign(value: unknown): ReviewedRoofDesign | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object") throw new Error("Roof Designer : données invalides.");
  const record = value as Record<string, unknown>;
  if (record.obstaclesConfirmed !== true) {
    throw new Error("Roof Designer : confirme les obstacles présents, ou confirme explicitement qu'il n'y en a aucun.");
  }
  if (!Array.isArray(record.quadNormalized) || record.quadNormalized.length !== 4) {
    throw new Error("Roof Designer : 4 coins sont requis dans l'ordre gouttière gauche → gouttière droite → faîtage droite → faîtage gauche.");
  }
  const quad = record.quadNormalized.map((point, index) => normalizedPoint(point, `coin ${index + 1}`)) as ManualRoofQuad;
  const slopeDeg = Number(record.slopeDeg);
  if (!Number.isFinite(slopeDeg) || slopeDeg < 0 || slopeDeg > 75) {
    throw new Error("Roof Designer : indique une pente comprise entre 0° et 75°.");
  }
  const keepouts: ManualRoofKeepout[] = Array.isArray(record.keepouts)
    ? record.keepouts.map((candidate, index) => {
        if (!candidate || typeof candidate !== "object") throw new Error(`Roof Designer : obstacle ${index + 1} invalide.`);
        const obstacle = candidate as Record<string, unknown>;
        if (!Array.isArray(obstacle.polygonNormalized) || obstacle.polygonNormalized.length < 3) {
          throw new Error(`Roof Designer : obstacle ${index + 1} incomplet.`);
        }
        return {
          id: String(obstacle.id ?? `K${index + 1}`),
          type: String(obstacle.type ?? "manual_keepout"),
          polygonNormalized: obstacle.polygonNormalized.map((point, pointIndex) => normalizedPoint(point, `obstacle ${index + 1} point ${pointIndex + 1}`)),
        };
      })
    : [];
  return { quadNormalized: quad, slopeDeg, keepouts, obstaclesConfirmed: true };
}

function normalizedPointInFrame(longitude: number, latitude: number, frame: MetricFrame): Point2D {
  const point = toWebMercator(longitude, latitude);
  return {
    x: (point.x - frame.minX) / (frame.maxX - frame.minX),
    y: (frame.maxY - point.y) / (frame.maxY - frame.minY),
  };
}

function reframePoint(point: Point2D, source: MetricFrame, target: MetricFrame): Point2D {
  const x = source.minX + point.x * (source.maxX - source.minX);
  const y = source.maxY - point.y * (source.maxY - source.minY);
  return {
    x: (x - target.minX) / (target.maxX - target.minX),
    y: (target.maxY - y) / (target.maxY - target.minY),
  };
}

async function resolveDp2OfficialContext(address: string): Promise<Dp2OfficialContext> {
  const site = await resolveOfficialParcelContext(address);
  const metricFrame = metricFrameForParcel(site.parcelGeometry, site.longitude, site.latitude, {
    aspect: MASS_ASPECT,
    minWidthMeters: 45,
    maxWidthMeters: 140,
    parcelScale: 2.2,
    fallbackWidthMeters: 90,
  });
  const presentationFrame = metricFrameForParcel(site.parcelGeometry, site.longitude, site.latitude, {
    aspect: MASS_ASPECT,
    minWidthMeters: 130,
    maxWidthMeters: 280,
    parcelScale: 5.2,
    fallbackWidthMeters: 180,
  });
  const parcelPolygonNormalized = projectParcelRingNormalized(site.parcelGeometry, metricFrame);
  const [massRaster, presentationRaster, cadastralRaster] = await Promise.all([
    fetchIgnRaster(
      orthophotoCandidates({ frame: metricFrame, widthPx: IMAGE_WIDTH, heightPx: IMAGE_HEIGHT, format: "image/png" }),
      { purpose: "DP2 : orthophoto métrée pour Roof Designer", minBytes: 2_000, required: true },
    ),
    fetchIgnRaster(
      orthophotoCandidates({ frame: presentationFrame, widthPx: IMAGE_WIDTH, heightPx: IMAGE_HEIGHT, format: "image/png" }),
      { purpose: "DP2 : vue de présentation élargie", minBytes: 2_000, required: true },
    ),
    fetchIgnRaster(
      cadastralCandidates({ frame: presentationFrame, widthPx: IMAGE_WIDTH, heightPx: IMAGE_HEIGHT }),
      { purpose: "DP2 : contexte cadastral élargi", minBytes: 1_000, required: true },
    ),
  ]);
  if (!massRaster || !presentationRaster || !cadastralRaster) throw new Error("DP2 : contexte IGN incomplet.");
  return {
    ...site,
    parcelPolygonNormalized,
    metricFrame,
    presentationFrame,
    mass: {
      role: "satellite_mass",
      mimeType: "image/png",
      base64: massRaster.base64,
      filename: `ign-dp2-designer-${site.parcelReference.replace(/\s+/g, "-")}.png`,
      widthPx: IMAGE_WIDTH,
      heightPx: IMAGE_HEIGHT,
      metersPerPixel: metricFrame.widthMeters / IMAGE_WIDTH,
    },
    presentationOrthophoto: presentationRaster.base64,
    cadastralOverlay: cadastralRaster.base64,
    addressPointNormalized: normalizedPointInFrame(site.longitude, site.latitude, presentationFrame),
    imagerySource: massRaster.source,
    presentationImagerySource: presentationRaster.source,
    cadastreSource: cadastralRaster.source,
  };
}

function buildBaseForm(input: DpPieceInput): ProjectForm {
  const module = requireVerifiedPvModule(input.moduleReference ?? "");
  const panelCount = positiveInteger(input.panelCount, "Le nombre de panneaux");
  const rows = positiveInteger(input.rows, "Le nombre de rangées");
  const columns = positiveInteger(input.columns, "Le nombre de colonnes");
  if (rows * columns !== panelCount) {
    throw new Error(`DP2 : le calepinage ${rows} × ${columns} ne correspond pas aux ${panelCount} panneaux demandés.`);
  }
  const faceId = input.roofFace?.trim() || "A";
  return {
    projectId: `v1-dp2-${crypto.randomUUID()}`,
    address: input.address.trim(),
    panel: {
      manufacturer: module.manufacturer,
      model: module.canonicalReference,
      widthMm: module.widthMm,
      heightMm: module.heightMm,
      frameColor: "black",
      powerWp: module.powerWp,
    },
    requestedPanelCount: panelCount,
    array: {
      rows,
      columns,
      orientation: input.orientation ?? "portrait",
      roofFace: faceId,
      placement: input.placement ?? "centered",
      layoutMode: "fixed",
      gutterClearanceMm: Math.max(0, number(input.gutterClearanceMm, 300)),
      interPanelGapMm: Math.max(0, number(input.interPanelGapMm, 20)),
    },
    roofSelection: { mode: "priority", priorityFaceId: faceId },
    support: { topology: "pitched", covering: "unknown", existingStructure: true },
  };
}

function resolveLayoutContext(
  form: ProjectForm,
  metricFace: NonNullable<ProjectForm["roofFaces"]>[number],
  metricView: NonNullable<ProjectContext["roof"]["views"]>[number],
  confidence: number,
  obstacles: NonNullable<ProjectContext["roof"]["faces"]>[number]["obstacles"],
  immutableFacts: string[],
  perspectiveNotes: string[] = [],
): ProjectContext {
  const layoutForm: ProjectForm = {
    ...form,
    roofFaces: [metricFace],
    roofGeometry: metricFace,
    roofSelection: { mode: "priority", priorityFaceId: metricFace.id },
  };
  const layout = resolveProjectLayout(layoutForm);
  if (layout.placements.length !== 1 || layout.placements[0]?.faceId !== metricFace.id) {
    throw new Error("DP2 : le Layout Engine a quitté le pan validé dans le Roof Designer.");
  }
  const placement = layout.placements[0]!;
  return {
    projectId: form.projectId,
    address: form.address,
    array: form.array,
    panel: form.panel,
    exactPanelCount: layout.count,
    fieldWidthMm: layout.primaryFieldWidthMm,
    fieldHeightMm: layout.primaryFieldHeightMm,
    roofGeometry: metricFace,
    resolvedPlacement: {
      leftMm: Math.max(0, placement.resolvedLeftMm ?? 0),
      rightMm: Math.max(0, placement.resolvedRightMm ?? 0),
      gutterMm: Math.max(0, placement.resolvedGutterMm),
      ridgeMm: Math.max(0, placement.resolvedRidgeMm ?? 0),
    },
    facePlacements: layout.placements,
    support: form.support,
    roof: {
      selectedFaceDescription: metricFace.label ?? metricFace.id,
      confidence,
      roofPolygonNormalized: metricView.roofPolygonNormalized,
      gutterLineNormalized: metricView.gutterLineNormalized,
      ridgeLineNormalized: metricView.ridgeLineNormalized,
      views: [metricView],
      faces: [{
        id: metricFace.id,
        label: metricFace.label ?? metricFace.id,
        confidence,
        slopeDeg: metricFace.slopeDeg,
        views: [metricView],
        obstacles,
      }],
      obstacles: obstacles.map(({ type, description, polygonNormalized }) => ({ type, description, polygonNormalized })),
      perspectiveNotes,
      uncertainties: [],
    },
    immutableFacts,
  };
}

function buildProjectFromRoofDesigner(form: ProjectForm, official: Dp2OfficialContext, design: ReviewedRoofDesign) {
  const designed = metricSurfaceFromManualRoofDesign({
    frame: official.metricFrame,
    design,
    faceId: form.array.roofFace,
    label: `Pan ${form.array.roofFace}`,
  });
  const project = resolveLayoutContext(
    form,
    designed.metricGeometry,
    designed.view,
    1,
    designed.obstacles,
    [
      "Roof Designer : pan explicitement validé par l'utilisateur sur orthophoto IGN métrée.",
      `Pente validée : ${design.slopeDeg.toFixed(1)}°.`,
      `${design.keepouts?.length ?? 0} keepout(s) validé(s) par l'utilisateur.`,
      `${form.requestedPanelCount} modules doivent rester sur ce pan et hors keepouts.`,
    ],
    designed.view.perspectiveNotes,
  );
  return { project, obstacleCount: design.keepouts?.length ?? 0 };
}

function panelSvg(polygons: Point2D[][], x: number, y: number, width: number, height: number) {
  return polygons.map((polygon, index) => {
    const points = polygon.map((point) => `${(x + point.x * width).toFixed(1)},${(y + point.y * height).toFixed(1)}`).join(" ");
    return `<polygon data-module="${index + 1}" points="${points}" fill="#142f52" fill-opacity=".94" stroke="#ffffff" stroke-width="1.4"/>`;
  }).join("");
}

function buildDp2Svg(context: Dp2OfficialContext, project: ProjectContext) {
  const metricPolygons = allPanelPolygonsForRoleProjective(project, "satellite_mass");
  if (!metricPolygons || metricPolygons.length !== project.exactPanelCount) {
    throw new Error("DP2 bloquée : la projection ne démontre pas exactement tous les modules sur le pan validé.");
  }
  const displayPolygons = metricPolygons.map((polygon) => polygon.map((point) => (
    reframePoint(point, context.metricFrame, context.presentationFrame)
  )));
  const width = 1200;
  const height = 900;
  const x = 70;
  const y = 166;
  const imageWidth = 1060;
  const imageHeight = 590;
  const orthophoto = `data:image/png;base64,${context.presentationOrthophoto}`;
  const cadastre = `data:image/png;base64,${context.cadastralOverlay}`;
  const entranceX = x + context.addressPointNormalized.x * imageWidth;
  const entranceY = y + context.addressPointNormalized.y * imageHeight;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#f7f7f4"/>
    <rect x="30" y="30" width="1140" height="840" rx="18" fill="#fff" stroke="#d9dde2" stroke-width="2"/>
    <rect x="58" y="58" width="76" height="44" rx="10" fill="#102a56"/>
    <text x="96" y="87" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#fff">DP2</text>
    <text x="158" y="87" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#17191d">Plan de masse — état projeté</text>
    <text x="58" y="126" font-family="Arial,sans-serif" font-size="16" fill="#656b75">${escapeXml(context.normalizedAddress)}</text>
    <rect x="58" y="154" width="1084" height="620" rx="12" fill="#edf0f2"/>
    <image href="${orthophoto}" x="${x}" y="${y}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="none"/>
    <image href="${cadastre}" x="${x}" y="${y}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="none" opacity=".88"/>
    ${panelSvg(displayPolygons, x, y, imageWidth, imageHeight)}
    <circle cx="${entranceX.toFixed(1)}" cy="${entranceY.toFixed(1)}" r="8" fill="#e54b2b" stroke="#ffffff" stroke-width="3"/>
    <rect x="82" y="650" width="500" height="94" rx="10" fill="#fff" fill-opacity=".94"/>
    <text x="102" y="680" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#102a56">${project.exactPanelCount} MODULES · PAN ${escapeXml(project.array.roofFace)}</text>
    <text x="102" y="706" font-family="Arial,sans-serif" font-size="14" fill="#4b5563">Calepinage ${project.array.rows} × ${project.array.columns} · parcelles voisines visibles</text>
    <text x="102" y="728" font-family="Arial,sans-serif" font-size="12" fill="#68717d">Point rouge : accès/adresse du projet · Réf. cadastrale ${escapeXml(context.parcelReference)}</text>
    <text x="1082" y="204" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#102a56">N</text>
    <path d="M1082 217 L1070 251 L1082 242 L1094 251 Z" fill="#102a56"/>
    <line x1="58" y1="832" x2="1142" y2="832" stroke="#102a56" stroke-width="2"/>
    <text x="58" y="857" font-family="Arial,sans-serif" font-size="13" fill="#68717d">PilotPaper V1 · MODE TEST · NON VALIDÉ</text>
    <text x="1142" y="857" text-anchor="end" font-family="Arial,sans-serif" font-size="13" fill="#68717d">${escapeXml(context.municipality)} · ${escapeXml(context.parcelReference)}</text>
  </svg>`;
}

function buildRoofDesignerOutput(
  official: Dp2OfficialContext,
  form: ProjectForm,
  design: ReviewedRoofDesign,
): DpPieceOutput {
  const { project, obstacleCount } = buildProjectFromRoofDesigner(form, official, design);
  return {
    dp: 2,
    title: "Plan de masse",
    validationStatus: "test_unverified",
    mimeType: "image/svg+xml",
    text: buildDp2Svg(official, project),
    sourceSummary: [
      `IGN Géoplateforme — adresse : ${official.normalizedAddress}`,
      `APICARTO Cadastre — parcelle ${official.parcelReference} (${Math.round(official.parcelAreaM2)} m²)`,
      `Roof Designer — pan ${form.array.roofFace} tracé et validé sur orthophoto IGN métrée`,
      `Pente déclarée/validée — ${design.slopeDeg.toFixed(1)}°`,
      `Keepout Designer — ${obstacleCount} zone(s) interdite(s) validée(s)`,
      "PV Layout Engine — placement déterministe hors bords et keepouts",
      "Projection Engine — projection du même calepinage dans le cadrage DP2 élargi",
    ],
    inspector: {
      passed: true,
      score: 1,
      checks: [
        "Pan sélectionné explicitement par l'utilisateur ; aucune détection de pan ambiguë",
        "Échelle planimétrique issue directement du repère métrique IGN",
        `Pente utilisée : ${design.slopeDeg.toFixed(1)}°`,
        `${obstacleCount} keepout(s) explicitement revu(s)`,
        "LiDAR non requis pour générer cette DP2",
        "Aucune IA générative utilisée pour la géométrie",
        `${project.exactPanelCount} modules projetés sur le pan validé`,
      ],
      issues: [],
    },
  };
}

export async function generateDp2Piece(input: DpPieceInput): Promise<DpPieceOutput> {
  if (input.dp !== 2) throw new Error("Le moteur DP2 V1 a reçu une autre pièce.");
  if (!input.address?.trim()) throw new Error("L'adresse du projet est requise.");

  const form = buildBaseForm(input);
  const official = await resolveDp2OfficialContext(input.address);
  const design = asReviewedRoofDesign((input as Dp2Input).manualRoofDesign);

  if (!design) throw new Dp2RoofDesignerRequiredError(official);
  return buildRoofDesignerOutput(official, form, design);
}
