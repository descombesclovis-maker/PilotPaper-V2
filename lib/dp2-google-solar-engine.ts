import {
  cadastralCandidates,
  fetchIgnRaster,
  orthophotoCandidates,
} from "@/lib/dp-ai-engine/context/ignRaster";
import {
  projectParcelRingNormalized,
  resolveOfficialParcelContext,
  toWebMercator,
  type MetricFrame,
  type OfficialParcelContext,
} from "@/lib/dp-ai-engine/context/officialParcel";
import { allPanelPolygonsForRoleProjective } from "@/lib/dp-ai-engine/geometry/panelProjection";
import { resolveProjectLayout } from "@/lib/dp-ai-engine/geometry/projectLayout";
import {
  fetchGoogleSolarBuildingInsights,
  googleSolarConfigured,
  type GoogleSolarBuildingInsights,
} from "@/lib/dp-ai-engine/providers/googleSolar";
import { automaticRoofDesignFromGoogleSolar } from "@/lib/dp-ai-engine/site-model/googleSolarAutomaticRoof";
import { metricSurfaceFromManualRoofDesign } from "@/lib/dp-ai-engine/site-model/manualRoofDesigner";
import { resolveTargetParcelFromBuildingCenter } from "@/lib/dp-ai-engine/site-model/targetPropertyResolver";
import type { Point2D, ProjectContext, ProjectForm } from "@/lib/dp-ai-engine/types";
import type { DpPieceInput, DpPieceOutput } from "@/lib/dp-piece-engine";
import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";
import {
  Dp2RoofDesignerRequiredError,
  generateDp2Piece as generateRoofDesignerDp2,
} from "@/lib/dp2-roof-designer-engine";

const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 1000;
const MASS_ASPECT = IMAGE_HEIGHT / IMAGE_WIDTH;
const TARGET_PARCEL_STROKE = "#00c7e6";

export { Dp2RoofDesignerRequiredError };

type AutoContext = OfficialParcelContext & {
  addressLongitude: number;
  addressLatitude: number;
  metricFrame: MetricFrame;
  presentationFrame: MetricFrame;
  parcelPolygonNormalized: Point2D[];
  presentationParcelPolygonNormalized: Point2D[];
  massBase64: string;
  presentationOrthophoto: string;
  designerCadastreOverlay: string;
  cadastralOverlay: string;
  addressPointNormalized: Point2D;
  imagerySource: string;
  presentationImagerySource: string;
  cadastreSource: string;
  solar: GoogleSolarBuildingInsights;
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

function frameAroundSolarBuilding(
  solar: GoogleSolarBuildingInsights,
  options: { minWidthMeters: number; maxWidthMeters: number; scale: number },
): MetricFrame {
  const center = toWebMercator(solar.center.longitude, solar.center.latitude);
  let buildingWidth = 18;
  let buildingHeight = 12;
  if (solar.boundingBox) {
    const sw = toWebMercator(solar.boundingBox.sw.longitude, solar.boundingBox.sw.latitude);
    const ne = toWebMercator(solar.boundingBox.ne.longitude, solar.boundingBox.ne.latitude);
    buildingWidth = Math.max(4, Math.abs(ne.x - sw.x));
    buildingHeight = Math.max(4, Math.abs(ne.y - sw.y));
  }
  const desiredWidth = Math.max(
    options.minWidthMeters,
    buildingWidth * options.scale,
    (buildingHeight * options.scale) / MASS_ASPECT,
  );
  const widthMeters = Math.min(options.maxWidthMeters, desiredWidth);
  const heightMeters = widthMeters * MASS_ASPECT;
  return {
    longitude: solar.center.longitude,
    latitude: solar.center.latitude,
    widthMeters,
    heightMeters,
    minX: center.x - widthMeters / 2,
    maxX: center.x + widthMeters / 2,
    minY: center.y - heightMeters / 2,
    maxY: center.y + heightMeters / 2,
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
    projectId: `v1-dp2-auto-${crypto.randomUUID()}`,
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

async function resolveAutomaticContext(address: string): Promise<AutoContext> {
  const addressContext = await resolveOfficialParcelContext(address);
  const solar = await fetchGoogleSolarBuildingInsights({
    latitude: addressContext.latitude,
    longitude: addressContext.longitude,
  });
  const site = await resolveTargetParcelFromBuildingCenter({
    addressContext,
    buildingCenter: solar.center,
  });

  const metricFrame = frameAroundSolarBuilding(solar, {
    minWidthMeters: 36,
    maxWidthMeters: 82,
    scale: 2.8,
  });
  const presentationFrame = frameAroundSolarBuilding(solar, {
    minWidthMeters: 95,
    maxWidthMeters: 175,
    scale: 6.0,
  });
  const parcelPolygonNormalized = projectParcelRingNormalized(site.parcelGeometry, metricFrame);
  const presentationParcelPolygonNormalized = projectParcelRingNormalized(site.parcelGeometry, presentationFrame);

  const [massRaster, designerCadastreRaster, presentationRaster, cadastralRaster] = await Promise.all([
    fetchIgnRaster(
      orthophotoCandidates({ frame: metricFrame, widthPx: IMAGE_WIDTH, heightPx: IMAGE_HEIGHT, format: "image/png" }),
      { purpose: "DP2 AUTO : orthophoto métrée centrée sur le bâtiment Google Solar", minBytes: 2_000, required: true },
    ),
    fetchIgnRaster(
      cadastralCandidates({ frame: metricFrame, widthPx: IMAGE_WIDTH, heightPx: IMAGE_HEIGHT }),
      { purpose: "DP2 AUTO : cadastre proche", minBytes: 1_000, required: false },
    ),
    fetchIgnRaster(
      orthophotoCandidates({ frame: presentationFrame, widthPx: IMAGE_WIDTH, heightPx: IMAGE_HEIGHT, format: "image/png" }),
      { purpose: "DP2 AUTO : vue de présentation", minBytes: 2_000, required: true },
    ),
    fetchIgnRaster(
      cadastralCandidates({ frame: presentationFrame, widthPx: IMAGE_WIDTH, heightPx: IMAGE_HEIGHT }),
      { purpose: "DP2 AUTO : contexte cadastral", minBytes: 1_000, required: true },
    ),
  ]);
  if (!massRaster || !presentationRaster || !cadastralRaster) throw new Error("DP2 AUTO : contexte IGN incomplet.");

  return {
    ...site,
    addressLongitude: addressContext.longitude,
    addressLatitude: addressContext.latitude,
    metricFrame,
    presentationFrame,
    parcelPolygonNormalized,
    presentationParcelPolygonNormalized,
    massBase64: massRaster.base64,
    presentationOrthophoto: presentationRaster.base64,
    designerCadastreOverlay: designerCadastreRaster?.base64 ?? "",
    cadastralOverlay: cadastralRaster.base64,
    addressPointNormalized: normalizedPointInFrame(addressContext.longitude, addressContext.latitude, presentationFrame),
    imagerySource: massRaster.source,
    presentationImagerySource: presentationRaster.source,
    cadastreSource: cadastralRaster.source,
    solar,
  };
}

function resolveLayoutContext(
  form: ProjectForm,
  designed: ReturnType<typeof metricSurfaceFromManualRoofDesign>,
): ProjectContext {
  const layoutForm: ProjectForm = {
    ...form,
    roofFaces: [designed.metricGeometry],
    roofGeometry: designed.metricGeometry,
    roofSelection: { mode: "priority", priorityFaceId: designed.metricGeometry.id },
  };
  const layout = resolveProjectLayout(layoutForm);
  if (layout.placements.length !== 1 || layout.placements[0]?.faceId !== designed.metricGeometry.id) {
    throw new Error("DP2 AUTO : le Layout Engine a quitté la zone sûre Google Solar.");
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
    roofGeometry: designed.metricGeometry,
    resolvedPlacement: {
      leftMm: Math.max(0, placement.resolvedLeftMm ?? 0),
      rightMm: Math.max(0, placement.resolvedRightMm ?? 0),
      gutterMm: Math.max(0, placement.resolvedGutterMm),
      ridgeMm: Math.max(0, placement.resolvedRidgeMm ?? 0),
    },
    facePlacements: layout.placements,
    support: form.support,
    roof: {
      selectedFaceDescription: designed.metricGeometry.label ?? designed.metricGeometry.id,
      confidence: 0.99,
      roofPolygonNormalized: designed.view.roofPolygonNormalized,
      gutterLineNormalized: designed.view.gutterLineNormalized,
      ridgeLineNormalized: designed.view.ridgeLineNormalized,
      views: [designed.view],
      faces: [{
        id: designed.metricGeometry.id,
        label: designed.metricGeometry.label ?? designed.metricGeometry.id,
        confidence: 0.99,
        slopeDeg: designed.metricGeometry.slopeDeg,
        views: [designed.view],
        obstacles: [],
      }],
      obstacles: [],
      perspectiveNotes: designed.view.perspectiveNotes,
      uncertainties: [],
    },
    immutableFacts: [
      "Google Solar fournit les cellules candidates déjà positionnées sur le segment de toiture.",
      "PilotPaper utilise uniquement un rectangle contigu entièrement composé de cellules candidates Google Solar.",
      "Le Layout Engine replace ensuite les dimensions fabricant exactes à l'intérieur de cette zone sûre.",
    ],
  };
}

function parcelSvgPoints(points: Point2D[], width: number, height: number, x = 0, y = 0) {
  return points.map((point) => `${(x + point.x * width).toFixed(1)},${(y + point.y * height).toFixed(1)}`).join(" ");
}

function panelSvg(polygons: Point2D[][], x: number, y: number, width: number, height: number) {
  return polygons.map((polygon, index) => {
    const points = polygon.map((point) => `${(x + point.x * width).toFixed(1)},${(y + point.y * height).toFixed(1)}`).join(" ");
    return `<polygon data-module="${index + 1}" points="${points}" fill="#142f52" fill-opacity=".94" stroke="#ffffff" stroke-width="1.4"/>`;
  }).join("");
}

function buildDp2Svg(context: AutoContext, project: ProjectContext) {
  const metricPolygons = allPanelPolygonsForRoleProjective(project, "satellite_mass");
  if (!metricPolygons || metricPolygons.length !== project.exactPanelCount) {
    throw new Error("DP2 AUTO bloquée : la projection ne démontre pas exactement tous les modules.");
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
  const targetParcel = parcelSvgPoints(context.presentationParcelPolygonNormalized, imageWidth, imageHeight, x, y);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#f7f7f4"/>
    <rect x="30" y="30" width="1140" height="840" rx="18" fill="#fff" stroke="#d9dde2" stroke-width="2"/>
    <rect x="58" y="58" width="76" height="44" rx="10" fill="#102a56"/>
    <text x="96" y="87" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#fff">DP2</text>
    <text x="158" y="87" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#17191d">Plan de masse — état projeté</text>
    <text x="58" y="126" font-family="Arial,sans-serif" font-size="16" fill="#656b75">${escapeXml(context.normalizedAddress)}</text>
    <rect x="58" y="154" width="1084" height="620" rx="12" fill="#edf0f2"/>
    <image href="${orthophoto}" x="${x}" y="${y}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="none"/>
    <image href="${cadastre}" x="${x}" y="${y}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="none" opacity=".84"/>
    <polygon points="${targetParcel}" fill="${TARGET_PARCEL_STROKE}" fill-opacity=".05" stroke="#ffffff" stroke-width="8" stroke-linejoin="round"/>
    <polygon points="${targetParcel}" fill="none" stroke="${TARGET_PARCEL_STROKE}" stroke-width="4.5" stroke-linejoin="round"/>
    ${panelSvg(displayPolygons, x, y, imageWidth, imageHeight)}
    <circle cx="${entranceX.toFixed(1)}" cy="${entranceY.toFixed(1)}" r="7" fill="#e54b2b" stroke="#ffffff" stroke-width="3"/>
    <rect x="82" y="650" width="530" height="94" rx="10" fill="#fff" fill-opacity=".94"/>
    <text x="102" y="680" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#102a56">${project.exactPanelCount} MODULES · AUTO GOOGLE SOLAR</text>
    <text x="102" y="706" font-family="Arial,sans-serif" font-size="14" fill="#4b5563">Calepinage ${project.array.rows} × ${project.array.columns} · ${escapeXml(project.array.orientation)}</text>
    <text x="102" y="728" font-family="Arial,sans-serif" font-size="12" fill="#68717d">Parcelle cible ${escapeXml(context.parcelReference)} · point rouge : adresse</text>
    <text x="1082" y="204" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#102a56">N</text>
    <path d="M1082 217 L1070 251 L1082 242 L1094 251 Z" fill="#102a56"/>
    <line x1="58" y1="832" x2="1142" y2="832" stroke="#102a56" stroke-width="2"/>
    <text x="58" y="857" font-family="Arial,sans-serif" font-size="13" fill="#68717d">PilotPaper V1 · MODE TEST · NON VALIDÉ</text>
    <text x="1142" y="857" text-anchor="end" font-family="Arial,sans-serif" font-size="13" fill="#68717d">${escapeXml(context.municipality)} · ${escapeXml(context.parcelReference)}</text>
  </svg>`;
}

async function generateAutomaticDp2(input: DpPieceInput): Promise<DpPieceOutput> {
  const form = buildBaseForm(input);
  const context = await resolveAutomaticContext(input.address);
  const automatic = automaticRoofDesignFromGoogleSolar({
    insights: context.solar,
    frame: context.metricFrame,
    requestedRows: form.array.rows,
    requestedColumns: form.array.columns,
    requestedOrientation: form.array.orientation,
    moduleWidthMeters: form.panel.widthMm / 1000,
    moduleHeightMeters: form.panel.heightMm / 1000,
    interPanelGapMeters: form.array.interPanelGapMm / 1000,
    placement: form.array.placement,
  });
  const designed = metricSurfaceFromManualRoofDesign({
    frame: context.metricFrame,
    design: automatic.design,
    faceId: form.array.roofFace,
    label: `Pan ${form.array.roofFace} · Google Solar segment ${automatic.segmentIndex + 1}`,
  });
  const project = resolveLayoutContext(form, designed);
  const imageQuality = String(context.solar.imageryQuality ?? "inconnue");
  const score = imageQuality === "HIGH" ? 0.99 : imageQuality === "MEDIUM" ? 0.97 : 0.93;
  return {
    dp: 2,
    title: "Plan de masse",
    validationStatus: "test_unverified",
    mimeType: "image/svg+xml",
    text: buildDp2Svg(context, project),
    sourceSummary: [
      `Google Solar API — bâtiment physique et segment ${automatic.segmentIndex + 1} · imagerie ${imageQuality}`,
      `Google Solar API — ${automatic.googlePanelCountUsedAsSafeArea} cellule(s) contiguë(s) utilisées comme zone sûre`,
      `IGN/APICARTO — parcelle recalée depuis le centre physique du bâtiment : ${context.parcelReference}`,
      `Module fabricant — ${form.panel.model} · ${form.panel.widthMm} × ${form.panel.heightMm} mm`,
      `PV Layout Engine — ${form.array.rows} × ${form.array.columns}, dimensions fabricant exactes, jeu ${form.array.interPanelGapMm} mm`,
      `Zone sûre Google : ${automatic.safeAreaWidthMeters.toFixed(2)} × ${automatic.safeAreaSlopeLengthMeters.toFixed(2)} m sur le plan du toit`,
      `Champ demandé : ${automatic.requestedArrayWidthMeters.toFixed(2)} × ${automatic.requestedArraySlopeLengthMeters.toFixed(2)} m`,
    ],
    inspector: {
      passed: true,
      score,
      checks: [
        "Bâtiment cible fourni par Google Solar puis parcelle officielle recalée au centre du bâtiment",
        `Qualité imagerie Google Solar : ${imageQuality}`,
        `Pente automatique du segment : ${automatic.segment.pitchDegrees.toFixed(1)}°`,
        `Azimut automatique du segment : ${automatic.segment.azimuthDegrees.toFixed(1)}°`,
        `${automatic.googlePanelCountUsedAsSafeArea} cellules Google Solar contiguës couvrent entièrement le champ demandé`,
        "Dimensions des modules remplacées par les dimensions fabricant vérifiées avant le Layout Engine",
        `${project.exactPanelCount} modules projetés automatiquement sans clic utilisateur`,
        "Conversion EPSG:3857 corrigée à la latitude locale pour les dimensions métriques",
      ],
      issues: imageQuality === "BASE" ? ["Imagerie Google Solar BASE : validation multi-cas requise avant toute utilisation production."] : [],
    },
  };
}

export async function generateDp2Piece(input: DpPieceInput): Promise<DpPieceOutput> {
  if (input.dp !== 2) throw new Error("Le moteur DP2 V1 a reçu une autre pièce.");
  if (!input.address?.trim()) throw new Error("L'adresse du projet est requise.");

  // Any explicit Roof Designer payload must remain deterministic and use the
  // exact geometry already reviewed by the user.
  if ((input as DpPieceInput & { manualRoofDesign?: unknown }).manualRoofDesign) {
    return generateRoofDesignerDp2(input);
  }

  if (googleSolarConfigured()) {
    try {
      return await generateAutomaticDp2(input);
    } catch (error) {
      console.warn("[PilotPaper][DP2][GoogleSolar] automatic path unavailable; switching to reviewed fallback.", error);
    }
  } else {
    console.warn("[PilotPaper][DP2][GoogleSolar] GOOGLE_SOLAR_API_KEY is not configured; automatic path skipped.");
  }

  // Review mode is a safety fallback only. It is not the primary DP2 workflow.
  return generateRoofDesignerDp2(input);
}
