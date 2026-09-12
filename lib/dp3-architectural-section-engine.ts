import {
  fromWebMercator,
  resolveOfficialParcelContext,
  toWebMercator,
  type MetricFrame,
} from "@/lib/dp-ai-engine/context/officialParcel";
import { buildArchitecturalSectionGeometry, interpolateSectionHeight } from "@/lib/dp-ai-engine/geometry/architecturalSection";
import { resolveProjectLayout } from "@/lib/dp-ai-engine/geometry/projectLayout";
import { fetchGoogleSolarBuildingInsights, googleSolarConfigured } from "@/lib/dp-ai-engine/providers/googleSolar";
import { resolveTargetBuilding } from "@/lib/dp-ai-engine/site-model/buildingResolver";
import { automaticRoofDesignFromGoogleSolar } from "@/lib/dp-ai-engine/site-model/googleSolarAutomaticRoof";
import { selectGoogleSolarFace } from "@/lib/dp-ai-engine/site-model/googleSolarFaceSelection";
import { metricSurfaceFromManualRoofDesign } from "@/lib/dp-ai-engine/site-model/manualRoofDesigner";
import { resolveTargetParcelFromBuildingCenter } from "@/lib/dp-ai-engine/site-model/targetPropertyResolver";
import type { Point2D, ProjectForm } from "@/lib/dp-ai-engine/types";
import type { DpPieceInput, DpPieceOutput } from "@/lib/dp-piece-engine";
import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";

const EARTH_RADIUS_M = 6_378_137;

type MeterPoint = { x: number; z: number };

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

function radians(value: number) {
  return (value * Math.PI) / 180;
}

function metricFrameAroundBuilding(latitude: number, longitude: number): MetricFrame {
  const center = toWebMercator(longitude, latitude);
  const widthMeters = 140;
  const heightMeters = 100;
  return {
    latitude,
    longitude,
    widthMeters,
    heightMeters,
    minX: center.x - widthMeters / 2,
    maxX: center.x + widthMeters / 2,
    minY: center.y - heightMeters / 2,
    maxY: center.y + heightMeters / 2,
  };
}

function framePointToLatLng(point: Point2D, frame: MetricFrame) {
  const x = frame.minX + point.x * (frame.maxX - frame.minX);
  const y = frame.maxY - point.y * (frame.maxY - frame.minY);
  return fromWebMercator(x, y);
}

function sectionAxisX(args: {
  point: { latitude: number; longitude: number };
  origin: { latitude: number; longitude: number };
  azimuthDeg: number;
}) {
  const lat0 = radians(args.origin.latitude);
  const east = radians(args.point.longitude - args.origin.longitude) * EARTH_RADIUS_M * Math.cos(lat0);
  const north = radians(args.point.latitude - args.origin.latitude) * EARTH_RADIUS_M;
  const azimuth = radians(args.azimuthDeg);
  return east * Math.sin(azimuth) + north * Math.cos(azimuth);
}

function buildForm(input: DpPieceInput, moduleSpec: ReturnType<typeof requireVerifiedPvModule>): ProjectForm {
  const panelCount = positiveInteger(input.panelCount, "Le nombre de panneaux");
  const rows = positiveInteger(input.rows, "Le nombre de rangées");
  const columns = positiveInteger(input.columns, "Le nombre de colonnes");
  if (rows * columns !== panelCount) {
    throw new Error(`DP3 : le calepinage ${rows} × ${columns} ne correspond pas aux ${panelCount} panneaux demandés.`);
  }
  const faceId = input.roofFace?.trim().toUpperCase() || "A";
  return {
    projectId: `v1-dp3-architectural-${crypto.randomUUID()}`,
    address: input.address.trim(),
    panel: {
      manufacturer: moduleSpec.manufacturer,
      model: moduleSpec.canonicalReference,
      widthMm: moduleSpec.widthMm,
      heightMm: moduleSpec.heightMm,
      frameColor: "black",
      powerWp: moduleSpec.powerWp,
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

function panelCrossSections(args: {
  profile: MeterPoint[];
  safeGutterX: number;
  pitchDeg: number;
  rows: number;
  orientation: "portrait" | "landscape";
  moduleWidthM: number;
  moduleHeightM: number;
  gapM: number;
  resolvedGutterM: number;
  leftX: number;
  rightX: number;
}) {
  const pitch = radians(args.pitchDeg);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const moduleSlopeM = args.orientation === "portrait" ? args.moduleHeightM : args.moduleWidthM;
  const normal = { x: sinPitch, z: cosPitch };
  const mountOffsetM = 0.10;
  const thicknessM = 0.045;
  const polygons: MeterPoint[][] = [];

  for (let row = 0; row < args.rows; row += 1) {
    const nearSlope = args.resolvedGutterM + row * (moduleSlopeM + args.gapM);
    const farSlope = nearSlope + moduleSlopeM;
    const nearX = args.safeGutterX - nearSlope * cosPitch;
    const farX = args.safeGutterX - farSlope * cosPitch;
    if (farX < args.leftX - 0.25 || nearX > args.rightX + 0.25) {
      throw new Error("DP3 : le champ photovoltaïque sortirait du profil réel du bâtiment dans la coupe.");
    }
    const nearRoofZ = interpolateSectionHeight(args.profile, nearX);
    const farRoofZ = interpolateSectionHeight(args.profile, farX);
    const nearBase = { x: nearX + normal.x * mountOffsetM, z: nearRoofZ + normal.z * mountOffsetM };
    const farBase = { x: farX + normal.x * mountOffsetM, z: farRoofZ + normal.z * mountOffsetM };
    polygons.push([
      farBase,
      nearBase,
      { x: nearBase.x + normal.x * thicknessM, z: nearBase.z + normal.z * thicknessM },
      { x: farBase.x + normal.x * thicknessM, z: farBase.z + normal.z * thicknessM },
    ]);
  }
  return polygons;
}

function buildSectionSvg(args: {
  address: string;
  parcelReference: string;
  buildingId: string;
  faceId: string;
  moduleReference: string;
  panelCount: number;
  rows: number;
  columns: number;
  orientation: "portrait" | "landscape";
  moduleWidthM: number;
  moduleHeightM: number;
  fieldWidthM: number;
  fieldSlopeLengthM: number;
  resolvedGutterM: number;
  pitchDeg: number;
  azimuthDeg: number;
  section: ReturnType<typeof buildArchitecturalSectionGeometry>;
  panels: MeterPoint[][];
}) {
  const width = 1400;
  const height = 1000;
  const plot = { x: 150, y: 220, w: 990, h: 540 };
  const marginX = Math.max(1.2, args.section.widthM * 0.08);
  const minX = args.section.leftX - marginX;
  const maxX = args.section.rightX + marginX;
  const minZ = -0.75;
  const maxZ = args.section.ridgeHeightM + Math.max(1.4, args.section.ridgeHeightM * 0.12);
  const scale = Math.min(plot.w / (maxX - minX), plot.h / (maxZ - minZ));
  const usedW = (maxX - minX) * scale;
  const usedH = (maxZ - minZ) * scale;
  const offsetX = plot.x + (plot.w - usedW) / 2;
  const offsetY = plot.y + (plot.h - usedH) / 2;
  const sx = (x: number) => offsetX + (x - minX) * scale;
  const sy = (z: number) => offsetY + (maxZ - z) * scale;
  const roofPoints = args.section.roofProfile.map((point) => `${sx(point.x).toFixed(1)},${sy(point.z).toFixed(1)}`).join(" ");
  const buildingPolygon = [
    `${sx(args.section.leftX).toFixed(1)},${sy(0).toFixed(1)}`,
    `${sx(args.section.rightX).toFixed(1)},${sy(0).toFixed(1)}`,
    ...[...args.section.roofProfile].reverse().map((point) => `${sx(point.x).toFixed(1)},${sy(point.z).toFixed(1)}`),
  ].join(" ");
  const panelPolygons = args.panels.map((polygon, index) => {
    const points = polygon.map((point) => `${sx(point.x).toFixed(1)},${sy(point.z).toFixed(1)}`).join(" ");
    return `<polygon data-row="${index + 1}" points="${points}" fill="#173c68" stroke="#0b223c" stroke-width="1.5"/>`;
  }).join("");

  const groundY = sy(0);
  const leftPx = sx(args.section.leftX);
  const rightPx = sx(args.section.rightX);
  const ridgePx = sx(args.section.ridgeX);
  const ridgeY = sy(args.section.ridgeHeightM);
  const eaveRightY = sy(args.section.rightEaveHeightM);
  const dimensionY = Math.min(820, groundY + 58);
  const widthLabel = `${args.section.widthM.toFixed(2)} m`;
  const ridgeLabel = `${args.section.ridgeHeightM.toFixed(2)} m`;
  const eaveLabel = `${args.section.rightEaveHeightM.toFixed(2)} m`;
  const roofSlopeLength = Math.hypot(
    args.section.rightX - args.section.ridgeX,
    args.section.ridgeHeightM - args.section.rightEaveHeightM,
  );
  const oneMeterPx = scale;
  const scaleBarX = 920;
  const scaleBarY = 865;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <pattern id="dp3WallHatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="12" stroke="#d7dadd" stroke-width="2"/>
      </pattern>
      <pattern id="dp3GroundHatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <line x1="0" y1="0" x2="0" y2="14" stroke="#b7aa95" stroke-width="1.4"/>
      </pattern>
      <marker id="dp3Arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse" markerUnits="strokeWidth">
        <path d="M 0 0 L 8 4 L 0 8 z" fill="#39434f"/>
      </marker>
    </defs>
    <rect width="100%" height="100%" fill="#f7f7f4"/>
    <rect x="28" y="28" width="1344" height="944" rx="18" fill="#fff" stroke="#d8dde3" stroke-width="2"/>
    <rect x="58" y="58" width="78" height="44" rx="9" fill="#102a56"/>
    <text x="97" y="87" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#fff">DP3</text>
    <text x="158" y="87" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#15181d">Plan en coupe architectural — état projeté</text>
    <text x="58" y="126" font-family="Arial,sans-serif" font-size="15" fill="#626b75">${escapeXml(args.address)}</text>
    <text x="58" y="154" font-family="Arial,sans-serif" font-size="13" fill="#7a828c">Coupe suivant l'axe de plus grande pente du pan ${escapeXml(args.faceId)} · azimut ${args.azimuthDeg.toFixed(1)}°</text>

    <rect x="58" y="180" width="1284" height="670" rx="12" fill="#fdfdfc" stroke="#dfe3e7"/>
    <rect x="${sx(args.section.leftX - 1.0).toFixed(1)}" y="${groundY.toFixed(1)}" width="${(sx(args.section.rightX + 1.0) - sx(args.section.leftX - 1.0)).toFixed(1)}" height="${Math.max(18, sy(-0.65) - groundY).toFixed(1)}" fill="url(#dp3GroundHatch)" opacity=".75"/>
    <line x1="90" y1="${groundY.toFixed(1)}" x2="1260" y2="${groundY.toFixed(1)}" stroke="#6e6559" stroke-width="2.2"/>
    <text x="96" y="${(groundY - 10).toFixed(1)}" font-family="Arial,sans-serif" font-size="12" fill="#6f665b">TN ±0.00</text>

    <polygon points="${buildingPolygon}" fill="url(#dp3WallHatch)" stroke="#30363c" stroke-width="2.2" stroke-linejoin="round"/>
    <polyline points="${roofPoints}" fill="none" stroke="#20262c" stroke-width="5" stroke-linejoin="round"/>
    <line x1="${leftPx.toFixed(1)}" y1="${groundY.toFixed(1)}" x2="${leftPx.toFixed(1)}" y2="${sy(args.section.leftEaveHeightM).toFixed(1)}" stroke="#30363c" stroke-width="3"/>
    <line x1="${rightPx.toFixed(1)}" y1="${groundY.toFixed(1)}" x2="${rightPx.toFixed(1)}" y2="${eaveRightY.toFixed(1)}" stroke="#30363c" stroke-width="3"/>
    <rect x="${leftPx.toFixed(1)}" y="${groundY.toFixed(1)}" width="${(rightPx - leftPx).toFixed(1)}" height="${Math.max(12, sy(-0.28) - groundY).toFixed(1)}" fill="#b9bdc2" stroke="#626a73" stroke-width="1.4"/>
    ${panelPolygons}

    <line x1="${leftPx.toFixed(1)}" y1="${groundY.toFixed(1)}" x2="${leftPx.toFixed(1)}" y2="${dimensionY.toFixed(1)}" stroke="#8a929c" stroke-width="1"/>
    <line x1="${rightPx.toFixed(1)}" y1="${groundY.toFixed(1)}" x2="${rightPx.toFixed(1)}" y2="${dimensionY.toFixed(1)}" stroke="#8a929c" stroke-width="1"/>
    <line x1="${leftPx.toFixed(1)}" y1="${dimensionY.toFixed(1)}" x2="${rightPx.toFixed(1)}" y2="${dimensionY.toFixed(1)}" stroke="#39434f" stroke-width="1.3" marker-start="url(#dp3Arrow)" marker-end="url(#dp3Arrow)"/>
    <rect x="${((leftPx + rightPx) / 2 - 43).toFixed(1)}" y="${(dimensionY - 12).toFixed(1)}" width="86" height="22" fill="#fdfdfc"/>
    <text x="${((leftPx + rightPx) / 2).toFixed(1)}" y="${(dimensionY + 4).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#303942">${widthLabel}</text>

    <line x1="${(rightPx + 32).toFixed(1)}" y1="${groundY.toFixed(1)}" x2="${(rightPx + 32).toFixed(1)}" y2="${eaveRightY.toFixed(1)}" stroke="#39434f" stroke-width="1.3" marker-start="url(#dp3Arrow)" marker-end="url(#dp3Arrow)"/>
    <line x1="${rightPx.toFixed(1)}" y1="${groundY.toFixed(1)}" x2="${(rightPx + 42).toFixed(1)}" y2="${groundY.toFixed(1)}" stroke="#8a929c"/>
    <line x1="${rightPx.toFixed(1)}" y1="${eaveRightY.toFixed(1)}" x2="${(rightPx + 42).toFixed(1)}" y2="${eaveRightY.toFixed(1)}" stroke="#8a929c"/>
    <text x="${(rightPx + 48).toFixed(1)}" y="${((groundY + eaveRightY) / 2 + 4).toFixed(1)}" font-family="Arial,sans-serif" font-size="12" fill="#303942">Égout ${eaveLabel}</text>

    <line x1="${(ridgePx - 34).toFixed(1)}" y1="${groundY.toFixed(1)}" x2="${(ridgePx - 34).toFixed(1)}" y2="${ridgeY.toFixed(1)}" stroke="#39434f" stroke-width="1.3" marker-start="url(#dp3Arrow)" marker-end="url(#dp3Arrow)"/>
    <line x1="${ridgePx.toFixed(1)}" y1="${ridgeY.toFixed(1)}" x2="${(ridgePx - 44).toFixed(1)}" y2="${ridgeY.toFixed(1)}" stroke="#8a929c"/>
    <text x="${(ridgePx - 48).toFixed(1)}" y="${(ridgeY + 4).toFixed(1)}" text-anchor="end" font-family="Arial,sans-serif" font-size="12" font-weight="700" fill="#303942">Faîtage ${ridgeLabel}</text>

    <path d="M ${rightPx.toFixed(1)} ${eaveRightY.toFixed(1)} A 48 48 0 0 0 ${(rightPx - 48 * Math.cos(radians(args.pitchDeg))).toFixed(1)} ${(eaveRightY - 48 * Math.sin(radians(args.pitchDeg))).toFixed(1)}" fill="none" stroke="#5d6670" stroke-width="1.2"/>
    <text x="${(rightPx - 66).toFixed(1)}" y="${(eaveRightY - 22).toFixed(1)}" font-family="Arial,sans-serif" font-size="12" font-weight="700" fill="#303942">${args.pitchDeg.toFixed(1)}°</text>

    <line x1="${ridgePx.toFixed(1)}" y1="${(ridgeY - 30).toFixed(1)}" x2="${rightPx.toFixed(1)}" y2="${(eaveRightY - 30).toFixed(1)}" stroke="#59636e" stroke-width="1.1" stroke-dasharray="5 4"/>
    <text x="${((ridgePx + rightPx) / 2).toFixed(1)}" y="${((ridgeY + eaveRightY) / 2 - 42).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#38424d">Rampant pan ${escapeXml(args.faceId)} ≈ ${roofSlopeLength.toFixed(2)} m</text>

    <rect x="995" y="208" width="315" height="160" rx="10" fill="#ffffff" stroke="#d8dde3"/>
    <text x="1015" y="236" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#102a56">INSTALLATION PHOTOVOLTAÏQUE</text>
    <text x="1015" y="263" font-family="Arial,sans-serif" font-size="12" fill="#48525d">${args.panelCount} modules · ${args.rows} rangée(s) × ${args.columns} colonne(s)</text>
    <text x="1015" y="286" font-family="Arial,sans-serif" font-size="12" fill="#48525d">${escapeXml(args.moduleReference)} · ${args.orientation}</text>
    <text x="1015" y="309" font-family="Arial,sans-serif" font-size="12" fill="#48525d">Module : ${args.moduleWidthM.toFixed(3)} × ${args.moduleHeightM.toFixed(3)} m</text>
    <text x="1015" y="332" font-family="Arial,sans-serif" font-size="12" fill="#48525d">Champ : ${args.fieldWidthM.toFixed(2)} × ${args.fieldSlopeLengthM.toFixed(2)} m</text>
    <text x="1015" y="355" font-family="Arial,sans-serif" font-size="12" fill="#48525d">Recul bas résolu : ${(args.resolvedGutterM * 1000).toFixed(0)} mm</text>

    <line x1="${scaleBarX}" y1="${scaleBarY}" x2="${(scaleBarX + oneMeterPx * 2).toFixed(1)}" y2="${scaleBarY}" stroke="#20262c" stroke-width="4"/>
    <line x1="${scaleBarX}" y1="${scaleBarY - 5}" x2="${scaleBarX}" y2="${scaleBarY + 5}" stroke="#20262c" stroke-width="2"/>
    <line x1="${(scaleBarX + oneMeterPx).toFixed(1)}" y1="${scaleBarY - 5}" x2="${(scaleBarX + oneMeterPx).toFixed(1)}" y2="${scaleBarY + 5}" stroke="#20262c" stroke-width="2"/>
    <line x1="${(scaleBarX + oneMeterPx * 2).toFixed(1)}" y1="${scaleBarY - 5}" x2="${(scaleBarX + oneMeterPx * 2).toFixed(1)}" y2="${scaleBarY + 5}" stroke="#20262c" stroke-width="2"/>
    <text x="${scaleBarX}" y="${scaleBarY + 22}" font-family="Arial,sans-serif" font-size="11" fill="#5a626c">0</text>
    <text x="${(scaleBarX + oneMeterPx).toFixed(1)}" y="${scaleBarY + 22}" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#5a626c">1 m</text>
    <text x="${(scaleBarX + oneMeterPx * 2).toFixed(1)}" y="${scaleBarY + 22}" text-anchor="end" font-family="Arial,sans-serif" font-size="11" fill="#5a626c">2 m</text>

    <text x="58" y="900" font-family="Arial,sans-serif" font-size="12" fill="#6b7480">Géométrie : BD TOPO · plans de toiture : Google Solar · implantation PV : PilotPaper Layout Engine</text>
    <text x="58" y="925" font-family="Arial,sans-serif" font-size="12" fill="#6b7480">Bâtiment ${escapeXml(args.buildingId)} · parcelle ${escapeXml(args.parcelReference)} · cotes en mètres</text>
    <line x1="58" y1="944" x2="1342" y2="944" stroke="#102a56" stroke-width="2"/>
    <text x="58" y="966" font-family="Arial,sans-serif" font-size="12" fill="#68717d">PilotPaper V1 · MODE TEST · NON VALIDÉ</text>
    <text x="1342" y="966" text-anchor="end" font-family="Arial,sans-serif" font-size="12" fill="#68717d">COUPE A-A · PAN ${escapeXml(args.faceId)}</text>
  </svg>`;
}

export async function generateDp3Piece(input: DpPieceInput): Promise<DpPieceOutput> {
  if (input.dp !== 3) throw new Error("Le moteur DP3 architectural a reçu une autre pièce.");
  if (!input.address?.trim()) throw new Error("DP3 : l'adresse du projet est requise.");
  if (!googleSolarConfigured()) throw new Error("DP3 : Google Solar API doit être configurée pour produire une coupe automatique fiable.");

  const moduleSpec = requireVerifiedPvModule(input.moduleReference ?? "");
  const form = buildForm(input, moduleSpec);
  const addressContext = await resolveOfficialParcelContext(input.address);
  const solar = await fetchGoogleSolarBuildingInsights({ latitude: addressContext.latitude, longitude: addressContext.longitude });
  const site = await resolveTargetParcelFromBuildingCenter({ addressContext, buildingCenter: solar.center });
  const building = await resolveTargetBuilding(site);
  const face = selectGoogleSolarFace(solar, form.array.roofFace);
  const frame = metricFrameAroundBuilding(solar.center.latitude, solar.center.longitude);
  const automatic = automaticRoofDesignFromGoogleSolar({
    insights: face.insights,
    frame,
    requestedRows: form.array.rows,
    requestedColumns: form.array.columns,
    requestedOrientation: form.array.orientation,
    moduleWidthMeters: moduleSpec.widthMm / 1000,
    moduleHeightMeters: moduleSpec.heightMm / 1000,
    interPanelGapMeters: form.array.interPanelGapMm / 1000,
    placement: form.array.placement,
  });
  const designed = metricSurfaceFromManualRoofDesign({
    frame,
    design: automatic.design,
    faceId: form.array.roofFace,
    label: `Pan ${form.array.roofFace} · Google Solar segment ${face.originalSegmentIndex + 1}`,
  });
  const layout = resolveProjectLayout({
    ...form,
    roofFaces: [designed.metricGeometry],
    roofGeometry: designed.metricGeometry,
    roofSelection: { mode: "priority", priorityFaceId: designed.metricGeometry.id },
  });
  const placement = layout.placements[0];
  if (!placement || placement.faceId !== designed.metricGeometry.id || layout.count !== form.requestedPanelCount) {
    throw new Error("DP3 : le Layout Engine ne confirme pas le même pan et le même nombre de modules que la DP2.");
  }

  const section = buildArchitecturalSectionGeometry({ building, insights: solar, selectedSegmentIndex: face.originalSegmentIndex });
  const gutterQuad = automatic.design.quadNormalized.slice(0, 2).map((point) => framePointToLatLng(point, frame));
  const safeGutterX = gutterQuad.reduce((sum, point) => sum + sectionAxisX({
    point,
    origin: section.sectionCenter,
    azimuthDeg: section.selectedAzimuthDeg,
  }), 0) / gutterQuad.length;
  const resolvedGutterM = Math.max(0, placement.resolvedGutterMm) / 1000;
  const panels = panelCrossSections({
    profile: section.roofProfile,
    safeGutterX,
    pitchDeg: section.selectedPitchDeg,
    rows: form.array.rows,
    orientation: form.array.orientation,
    moduleWidthM: moduleSpec.widthMm / 1000,
    moduleHeightM: moduleSpec.heightMm / 1000,
    gapM: form.array.interPanelGapMm / 1000,
    resolvedGutterM,
    leftX: section.leftX,
    rightX: section.rightX,
  });

  const svg = buildSectionSvg({
    address: site.normalizedAddress,
    parcelReference: site.parcelReference,
    buildingId: building.id,
    faceId: form.array.roofFace,
    moduleReference: moduleSpec.canonicalReference,
    panelCount: layout.count,
    rows: form.array.rows,
    columns: form.array.columns,
    orientation: form.array.orientation,
    moduleWidthM: moduleSpec.widthMm / 1000,
    moduleHeightM: moduleSpec.heightMm / 1000,
    fieldWidthM: automatic.requestedArrayWidthMeters,
    fieldSlopeLengthM: automatic.requestedArraySlopeLengthMeters,
    resolvedGutterM,
    pitchDeg: section.selectedPitchDeg,
    azimuthDeg: section.selectedAzimuthDeg,
    section,
    panels,
  });

  const imageryQuality = String(solar.imageryQuality ?? "inconnue");
  const score = imageryQuality === "HIGH" ? 0.99 : imageryQuality === "MEDIUM" ? 0.97 : 0.93;
  return {
    dp: 3,
    title: "Plan en coupe",
    validationStatus: "test_unverified",
    mimeType: "image/svg+xml",
    text: svg,
    sourceSummary: [
      `BD TOPO — emprise réelle du bâtiment ${building.id} et hauteur de gouttière ${building.heightM?.toFixed(2) ?? "inconnue"} m`,
      `Google Solar — pan ${form.array.roofFace}, pente ${section.selectedPitchDeg.toFixed(1)}°, azimut ${section.selectedAzimuthDeg.toFixed(1)}°, imagerie ${imageryQuality}`,
      `APICARTO/IGN — parcelle ${site.parcelReference} recalée depuis le centre physique du bâtiment`,
      `Module fabricant — ${moduleSpec.canonicalReference} · ${moduleSpec.widthMm} × ${moduleSpec.heightMm} mm`,
      `PilotPaper Layout Engine — ${layout.count} modules, recul bas résolu ${Math.round(resolvedGutterM * 1000)} mm`,
    ],
    inspector: {
      passed: true,
      score,
      checks: [
        "Coupe tracée dans l'emprise réelle BD TOPO du volume portant le pan sélectionné",
        "Profil de toiture reconstruit par intersection des plans Google Solar avec la ligne de coupe",
        `Pan ${form.array.roofFace} identique à la sélection DP2 Google Solar`,
        `Pente mesurée automatiquement : ${section.selectedPitchDeg.toFixed(1)}°`,
        `Largeur traversée par la coupe : ${section.widthM.toFixed(2)} m`,
        `Hauteur de faîtage dessinée : ${section.ridgeHeightM.toFixed(2)} m au-dessus du terrain de référence`,
        `${layout.count} modules fabricant vérifiés ; ${panels.length} rangée(s) visibles dans la coupe`,
        "Cotes architecturales, niveaux, rampant, égout, faîtage et échelle graphique intégrés au dessin",
      ],
      issues: imageryQuality === "BASE"
        ? ["Imagerie Google Solar BASE : maintenir le statut TEST tant que le cas n'a pas été contrôlé visuellement."]
        : [],
    },
  };
}
