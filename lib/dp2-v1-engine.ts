import { configFromEnv } from "@/lib/dp-ai-engine/config";
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
import {
  allPanelPolygonsForRoleProjective,
} from "@/lib/dp-ai-engine/geometry/panelProjection";
import {
  metricSurfaceFromIdentity,
  reprojectPolygonBetweenQuads,
} from "@/lib/dp-ai-engine/geometry/metricSurfaceFromIdentity";
import { resolveProjectLayout } from "@/lib/dp-ai-engine/geometry/projectLayout";
import {
  resolveCrossViewSurfaceIdentity,
  validateCrossViewSurfaceIdentity,
  type CrossViewSurfaceIdentity,
} from "@/lib/dp-ai-engine/identity/crossViewSurfaceIdentity";
import { resolveSurfaceObstacleInventory } from "@/lib/dp-ai-engine/obstacles/surfaceObstacleEngine";
import type { InputPhoto, Point2D, ProjectContext, ProjectForm } from "@/lib/dp-ai-engine/types";
import type { DpPieceInput, DpPieceOutput } from "@/lib/dp-piece-engine";
import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";

const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 1000;
const MASS_ASPECT = IMAGE_HEIGHT / IMAGE_WIDTH;

export type Dp2CrossViewIdentity = CrossViewSurfaceIdentity;
export const validateDp2CrossViewIdentity = validateCrossViewSurfaceIdentity;

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

/**
 * DP2 deliberately uses two geographic frames:
 * - metricFrame: close, calibrated evidence for roof understanding/layout;
 * - presentationFrame: wider cadastral context for the human-readable DP2.
 * Changing the visual zoom must never degrade the metric engine.
 */
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
      { purpose: "DP2 : vue métrique IGN serrée pour le moteur", minBytes: 2_000, required: true },
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
      filename: `ign-dp2-metric-${site.parcelReference.replace(/\s+/g, "-")}.png`,
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

function asRoofPhoto(input: DpPieceInput): InputPhoto {
  const photo = input.photos?.find((candidate) => candidate.role === "roof");
  if (!photo?.base64 || photo.base64.length < 1000) {
    throw new Error("DP2 : une vue oblique de toiture exploitable est requise.");
  }
  return { role: "roof", mimeType: photo.mimeType, base64: photo.base64, filename: photo.filename };
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

function metricObstacles(identity: CrossViewSurfaceIdentity) {
  return identity.obstacles.flatMap((obstacle) => {
    const metric = obstacle.metricPolygonNormalized
      ?? (obstacle.roofPolygonNormalized
        ? reprojectPolygonBetweenQuads(
          identity.roofPlane.polygonNormalized,
          identity.metricPlane.polygonNormalized,
          obstacle.roofPolygonNormalized,
        )
        : undefined);
    return metric?.length
      ? [{ type: obstacle.type, description: obstacle.description, polygonNormalized: metric, viewRole: "satellite_mass" as const }]
      : [];
  });
}

/**
 * Hand-off chain: proven cross-view identity -> independently audited obstacles
 * -> deterministic metric SurfaceSupport -> deterministic Layout Engine.
 */
function buildProjectContext(
  form: ProjectForm,
  context: Dp2OfficialContext,
  identity: CrossViewSurfaceIdentity,
): ProjectContext {
  const metricFace = metricSurfaceFromIdentity({
    identity,
    metricImage: context.mass,
    faceId: form.array.roofFace,
    label: `Pan ${form.array.roofFace}`,
    slopeOverrideDeg: form.roofGeometry?.slopeDeg,
  });
  const layoutForm: ProjectForm = {
    ...form,
    roofFaces: [metricFace],
    roofGeometry: metricFace,
    roofSelection: { mode: "priority", priorityFaceId: metricFace.id },
  };
  const layout = resolveProjectLayout(layoutForm);
  if (layout.placements.length !== 1 || layout.placements[0]?.faceId !== metricFace.id) {
    throw new Error("DP2 : le Layout Engine a quitté le pan physiquement identifié.");
  }
  const placement = layout.placements[0]!;
  const resolvedPlacement = {
    leftMm: Math.max(0, placement.resolvedLeftMm ?? 0),
    rightMm: Math.max(0, placement.resolvedRightMm ?? 0),
    gutterMm: Math.max(0, placement.resolvedGutterMm),
    ridgeMm: Math.max(0, placement.resolvedRidgeMm ?? 0),
  };
  const faceId = metricFace.id;
  const obstacles = metricObstacles(identity);
  const metricView = {
    role: "satellite_mass" as const,
    faceId,
    selectedFaceVisible: true,
    confidence: identity.confidence,
    roofPolygonNormalized: identity.metricPlane.polygonNormalized,
    gutterLineNormalized: identity.metricPlane.gutterLineNormalized,
    ridgeLineNormalized: identity.metricPlane.ridgeLineNormalized,
    perspectiveNotes: ["Vue orthographique IGN métrique serrée, réservée aux calculs."],
  };
  const roofView = {
    role: "roof" as const,
    faceId,
    selectedFaceVisible: true,
    confidence: identity.confidence,
    roofPolygonNormalized: identity.roofPlane.polygonNormalized,
    gutterLineNormalized: identity.roofPlane.gutterLineNormalized,
    ridgeLineNormalized: identity.roofPlane.ridgeLineNormalized,
    perspectiveNotes: ["Vue réelle utilisée pour l'identité cross-view du même pan."],
  };
  return {
    projectId: form.projectId,
    address: form.address,
    array: form.array,
    panel: form.panel,
    exactPanelCount: layout.count,
    fieldWidthMm: layout.primaryFieldWidthMm,
    fieldHeightMm: layout.primaryFieldHeightMm,
    roofGeometry: metricFace,
    resolvedPlacement,
    facePlacements: layout.placements,
    support: form.support,
    roof: {
      selectedFaceDescription: metricFace.label ?? faceId,
      confidence: Math.min(identity.confidence, identity.slopeConfidence),
      roofPolygonNormalized: identity.roofPlane.polygonNormalized,
      gutterLineNormalized: identity.roofPlane.gutterLineNormalized,
      ridgeLineNormalized: identity.roofPlane.ridgeLineNormalized,
      views: [metricView, roofView],
      faces: [{
        id: faceId,
        label: metricFace.label ?? faceId,
        confidence: identity.confidence,
        slopeDeg: metricFace.slopeDeg,
        views: [metricView, roofView],
        obstacles,
      }],
      obstacles: obstacles.map(({ type, description, polygonNormalized }) => ({ type, description, polygonNormalized })),
      perspectiveNotes: identity.notes,
      uncertainties: [],
    },
    immutableFacts: [
      `Cross-view identity locked to physical roof face ${faceId}.`,
      `Official parcel ${context.parcelReference} (${Math.round(context.parcelAreaM2)} m²).`,
      `${layout.count} modules must remain on the identified physical face.`,
    ],
  };
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
    throw new Error("DP2 bloquée : la projection homographique ne démontre pas exactement tous les modules sur la vue métrique IGN.");
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

export async function generateDp2Piece(input: DpPieceInput): Promise<DpPieceOutput> {
  if (input.dp !== 2) throw new Error("Le moteur DP2 V1 a reçu une autre pièce.");
  if (!input.address?.trim()) throw new Error("L'adresse du projet est requise.");

  const form = buildBaseForm(input);
  const roofPhoto = asRoofPhoto(input);
  const official = await resolveDp2OfficialContext(input.address);
  const config = configFromEnv();
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY absente du poste local.");

  const identity = await resolveCrossViewSurfaceIdentity({
    apiKey: config.openaiApiKey,
    model: config.analysisModel,
    parcelReference: official.parcelReference,
    parcelPolygonNormalized: official.parcelPolygonNormalized,
    metricImage: official.mass,
    realImage: roofPhoto,
    faceLabel: form.array.roofFace,
    contextNotes: `Photovoltaic DP2; requested array ${form.array.rows}×${form.array.columns} ${form.array.orientation}.`,
  });

  const obstacleInventory = await resolveSurfaceObstacleInventory({
    apiKey: config.openaiApiKey,
    model: config.analysisModel,
    identity,
    metricImage: official.mass,
    realImage: roofPhoto,
    faceLabel: form.array.roofFace,
  });

  // Identity analysis may mention obstacles as matching cues, but the Layout
  // Engine consumes only the independently censused and audited obstacle list.
  const surfaceIdentity: CrossViewSurfaceIdentity = {
    ...identity,
    obstacles: obstacleInventory.obstacles,
    notes: [...identity.notes, ...obstacleInventory.notes],
  };

  const project = buildProjectContext(form, official, surfaceIdentity);
  const svg = buildDp2Svg(official, project);
  const score = Math.min(identity.confidence, identity.slopeConfidence, obstacleInventory.coverageConfidence);

  return {
    dp: 2,
    title: "Plan de masse",
    validationStatus: "test_unverified",
    mimeType: "image/svg+xml",
    text: svg,
    sourceSummary: [
      `IGN Géoplateforme — adresse : ${official.normalizedAddress}`,
      `APICARTO Cadastre — parcelle ${official.parcelReference} (${Math.round(official.parcelAreaM2)} m²)`,
      `IGN Géoplateforme — vue métrique serrée réservée au moteur : ${official.imagerySource}`,
      `IGN Géoplateforme — vue cadastrale élargie réservée au rendu DP2 : ${official.presentationImagerySource}`,
      `OpenAI ${config.analysisModel} — Cross-View Surface Identity Engine`,
      `OpenAI ${config.analysisModel} — Surface Obstacle Census + Independent Audit`,
      "Surface Understanding — reconstruction métrique du pan et des obstacles audités",
      "PV Layout Engine — placement déterministe sur le pan physiquement verrouillé",
      "Projection Engine — homographie métrique puis reprojection dans le cadrage DP2 élargi",
    ],
    inspector: {
      passed: true,
      score,
      checks: [
        "Parcelle officielle résolue par le moteur commun avant toute compréhension de toiture",
        "Vue métrique serrée séparée du cadrage cadastral de présentation",
        "Point d'accès/adresse projeté depuis la coordonnée IGN dans le cadrage élargi",
        "Même bâtiment démontré entre IGN et photo réelle",
        "Même pan physique verrouillé dans les deux vues avant détection des obstacles",
        "Obstacle Census effectué uniquement après verrouillage du pan physique",
        "Audit indépendant des obstacles effectué avant le Layout Engine",
        `Couverture obstacle audit ${(obstacleInventory.coverageConfidence * 100).toFixed(0)} %`,
        `${obstacleInventory.obstacles.length} obstacle(s) physique(s) conservé(s) sur le pan après filtrage géométrique`,
        "Centre du pan métrique vérifié à l'intérieur de la parcelle cible",
        "Au moins deux indices visuels indépendants confirment l'identité multi-vues",
        `Confiance identité ${(identity.confidence * 100).toFixed(0)} %`,
        `${project.exactPanelCount} modules projetés sur le même pan physique`,
      ],
      issues: surfaceIdentity.notes,
    },
  };
}
