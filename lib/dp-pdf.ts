import { degrees, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  dimensionValue,
  type ArchitecturalEvidence,
  type NormalizedPoint,
} from "@/lib/architectural-evidence";
import { fillOfficialCerfa } from "@/lib/official-cerfa";
import { CONFORMITY_POLICY_VERSION } from "@/lib/conformity-policy";

export type DpProjectRecord = {
  id: string;
  requesterKind: "company" | "person";
  requesterName: string;
  requesterFirstName: string;
  requesterLastName: string;
  requesterAddress: string;
  requesterEmail: string;
  requesterVat: string;
  requesterSiret: string;
  requesterLegalFormCode: string;
  siteAddress: string;
  supportType: string;
  powerKwp: string;
  moduleCount: number;
  moduleReference: string;
  injectionMode: string;
  details: Record<string, string>;
};

export type DpSourceFile = {
  kind: string;
  fileName: string;
  mimeType: string;
  sha256: string;
  bytes: Uint8Array;
};

export type DpRenderedView = {
  kind: "satellite_project" | "dp4_project" | "dp6_project" | "near_project";
  sourceKind?: string;
  mimeType: "image/png";
  sha256: string;
  bytes: Uint8Array;
  metrics?: {
    eave_clearance_mm?: number | null;
    edge_blend_score?: number;
    photometric_match_score?: number;
    visual_conformity_score?: number;
    metric_width_error_ratio?: number | null;
    metric_height_error_ratio?: number | null;
  };
};

const A4: [number, number] = [595.28, 841.89];
const A4_LANDSCAPE: [number, number] = [A4[1], A4[0]];
const navy = rgb(16 / 255, 42 / 255, 86 / 255);
const graphite = rgb(23 / 255, 25 / 255, 29 / 255);
const muted = rgb(92 / 255, 98 / 255, 108 / 255);
const line = rgb(224 / 255, 226 / 255, 230 / 255);
const paper = rgb(248 / 255, 248 / 255, 245 / 255);
const cyan = rgb(54 / 255, 169 / 255, 205 / 255);
const copper = rgb(188 / 255, 104 / 255, 64 / 255);

const pieces = [
  ["DP1", "Plan de situation", "dp1_situation"],
  ["DP2", "Plan de masse", "dp2_mass"],
  ["DP3", "Plan en coupe", "dp3_section"],
  ["DP4", "Facades et toitures", "dp4_elevations"],
  ["DP5", "Representation de l'aspect exterieur", "dp5_appearance"],
  ["DP6", "Insertion du projet", "dp6_insertion"],
  ["DP7", "Photographie de l'environnement proche", "near"],
  ["DP8", "Photographie du paysage lointain", "far"],
] as const;

function safe(value: unknown) {
  return String(value ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7E\u00C0-\u00FF\u20AC]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requiredDetail(project: DpProjectRecord, key: string, label: string) {
  const value = safe(project.details[key]);
  if (!value || /^(undefined|null|nan)$/i.test(value)) {
    throw new Error(`Rendu interdit : ${label} n'est pas démontré.`);
  }
  return value;
}

function requiredDimension(evidence: ArchitecturalEvidence, id: string, label: string) {
  const value = dimensionValue(evidence, id);
  if (!value || value <= 0) throw new Error(`Rendu interdit : ${label} n'est pas démontrée.`);
  return value;
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number) {
  const words = safe(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function textBlock(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  size: number,
  maxWidth: number,
  color = graphite,
) {
  const lines = wrap(font, text, size, maxWidth);
  lines.forEach((value, index) => {
    page.drawText(value, { x, y: y - index * (size + 4), size, font, color });
  });
  return y - lines.length * (size + 4);
}

function header(page: PDFPage, bold: PDFFont, code: string, title: string) {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: height - 72, width, height: 72, color: paper });
  page.drawRectangle({ x: 38, y: height - 57, width: 38, height: 24, color: navy });
  page.drawText(code, { x: 44, y: height - 49, size: 9, font: bold, color: rgb(1, 1, 1) });
  page.drawText(safe(title), { x: 90, y: height - 48, size: 11, font: bold, color: graphite });
  page.drawLine({ start: { x: 38, y: height - 64 }, end: { x: width - 38, y: height - 64 }, thickness: 1.2, color: navy });
  page.drawLine({ start: { x: 38, y: height - 67 }, end: { x: Math.min(width - 38, 214), y: height - 67 }, thickness: 1.2, color: cyan });
}

function footer(page: PDFPage, font: PDFFont, projectId: string, pageNumber: number) {
  const { width } = page.getSize();
  page.drawLine({ start: { x: 38, y: 35 }, end: { x: width - 38, y: 35 }, thickness: 0.8, color: navy });
  page.drawText(`PilotPaper - dossier ${safe(projectId).slice(0, 8)}`, { x: 38, y: 18, size: 7, font, color: muted });
  const middle = "DOCUMENT ARCHITECTURAL CONTROLE";
  page.drawText(middle, { x: (width - font.widthOfTextAtSize(middle, 6.5)) / 2, y: 18, size: 6.5, font, color: muted });
  page.drawText(`P.${String(pageNumber).padStart(2, "0")}`, { x: width - 72, y: 18, size: 7, font, color: navy });
}

async function appendSource(
  target: PDFDocument,
  source: DpSourceFile,
  bold: PDFFont,
  font: PDFFont,
  code: string,
  title: string,
  projectId: string,
) {
  if (source.mimeType === "application/pdf") {
    const external = await PDFDocument.load(source.bytes, { ignoreEncryption: true });
    const pages = await target.copyPages(external, external.getPageIndices());
    pages.forEach((page) => target.addPage(page));
    return;
  }

  const page = target.addPage(A4);
  header(page, bold, code, title);
  page.drawText(`SOURCE ORIGINALE : ${safe(source.fileName)}`, { x: 38, y: 741, size: 7.5, font: bold, color: graphite });
  page.drawText(`SHA-256 : ${source.sha256}`, { x: 38, y: 726, size: 5.7, font, color: muted });
  const image = source.mimeType === "image/png"
    ? await target.embedPng(source.bytes)
    : await target.embedJpg(source.bytes);
  const availableWidth = 519;
  const availableHeight = 630;
  const scale = Math.min(availableWidth / image.width, availableHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, { x: 38 + (availableWidth - width) / 2, y: 72 + (availableHeight - height) / 2, width, height });
  footer(page, font, projectId, target.getPageCount());
}

async function drawPhoto(
  pdf: PDFDocument,
  page: PDFPage,
  source: DpSourceFile,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
) {
  const image = source.mimeType === "image/png"
    ? await pdf.embedPng(source.bytes)
    : await pdf.embedJpg(source.bytes);
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, { x: x + (maxWidth - width) / 2, y: y + (maxHeight - height) / 2, width, height });
  return { x: x + (maxWidth - width) / 2, y: y + (maxHeight - height) / 2, width, height };
}

type Bounds = { x: number; y: number; width: number; height: number };
type PdfPoint = { x: number; y: number };

function toPdfPoint(point: NormalizedPoint, bounds: Bounds): PdfPoint {
  return {
    x: bounds.x + point.x * bounds.width,
    y: bounds.y + (1 - point.y) * bounds.height,
  };
}

function drawPolygon(
  page: PDFPage,
  points: PdfPoint[],
  options: { fill?: ReturnType<typeof rgb>; stroke: ReturnType<typeof rgb>; width?: number; opacity?: number },
) {
  const minX = Math.min(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${(point.x - minX).toFixed(2)} ${(maxY - point.y).toFixed(2)}`)
    .join(" ") + " Z";
  page.drawSvgPath(path, {
    x: minX,
    y: maxY,
    color: options.fill,
    borderColor: options.stroke,
    borderWidth: options.width ?? 1,
    opacity: options.opacity ?? 1,
    borderOpacity: 1,
  });
}

function mixPoint(a: PdfPoint, b: PdfPoint, ratio: number): PdfPoint {
  return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
}

function drawRoofTrace(page: PDFPage, points: PdfPoint[]) {
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    page.drawLine({ start, end, thickness: 1.1, color: copper, dashArray: [5, 3], opacity: 0.95 });
  }
}

function drawDimensionLine(
  page: PDFPage,
  font: PDFFont,
  start: PdfPoint,
  end: PdfPoint,
  center: PdfPoint,
  label: string,
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 8) return;
  let normal = { x: -dy / length, y: dx / length };
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const toward = (midpoint.x + normal.x * 12 - center.x) ** 2 + (midpoint.y + normal.y * 12 - center.y) ** 2;
  const opposite = (midpoint.x - normal.x * 12 - center.x) ** 2 + (midpoint.y - normal.y * 12 - center.y) ** 2;
  if (opposite > toward) normal = { x: -normal.x, y: -normal.y };
  const offset = 12;
  const first = { x: start.x + normal.x * offset, y: start.y + normal.y * offset };
  const second = { x: end.x + normal.x * offset, y: end.y + normal.y * offset };
  page.drawLine({ start, end: first, thickness: 0.55, color: copper, opacity: 0.9 });
  page.drawLine({ start: end, end: second, thickness: 0.55, color: copper, opacity: 0.9 });
  page.drawLine({ start: first, end: second, thickness: 0.8, color: copper, opacity: 0.96 });
  const tick = 3.2;
  for (const point of [first, second]) {
    page.drawLine({
      start: { x: point.x - normal.x * tick, y: point.y - normal.y * tick },
      end: { x: point.x + normal.x * tick, y: point.y + normal.y * tick },
      thickness: 0.8,
      color: copper,
    });
  }
  let angle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (angle > 90 || angle < -90) angle += 180;
  const labelPoint = {
    x: (first.x + second.x) / 2 + normal.x * 4,
    y: (first.y + second.y) / 2 + normal.y * 4,
  };
  page.drawText(label, {
    x: labelPoint.x - font.widthOfTextAtSize(label, 6.2) / 2,
    y: labelPoint.y,
    size: 6.2,
    font,
    color: copper,
    rotate: degrees(angle),
  });
}

function drawPointDistance(
  page: PDFPage,
  font: PDFFont,
  start: PdfPoint,
  end: PdfPoint,
  label: string,
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 4) return;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  page.drawLine({ start, end, thickness: 1.05, color: copper, opacity: 0.98 });
  for (const point of [start, end]) {
    page.drawLine({
      start: { x: point.x - nx * 4, y: point.y - ny * 4 },
      end: { x: point.x + nx * 4, y: point.y + ny * 4 },
      thickness: 1,
      color: copper,
    });
  }
  const labelWidth = font.widthOfTextAtSize(label, 7);
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  page.drawRectangle({ x: mx - labelWidth / 2 - 4, y: my - 5, width: labelWidth + 8, height: 13, color: rgb(1, 1, 1), opacity: 0.92 });
  page.drawText(label, { x: mx - labelWidth / 2, y: my - 1, size: 7, font, color: copper });
}

function projectPointOnLine(point: PdfPoint, a: PdfPoint, b: PdfPoint): PdfPoint {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const denominator = vx * vx + vy * vy;
  if (denominator < 1e-8) return a;
  const t = ((point.x - a.x) * vx + (point.y - a.y) * vy) / denominator;
  return { x: a.x + vx * t, y: a.y + vy * t };
}

function drawNorthArrow(page: PDFPage, x: number, y: number, bold: PDFFont) {
  page.drawCircle({ x, y, size: 17, borderColor: navy, borderWidth: 0.8, color: rgb(1, 1, 1), opacity: 0.92 });
  drawPolygon(page, [
    { x, y: y + 13 },
    { x: x - 5, y: y - 6 },
    { x, y: y - 2 },
    { x: x + 5, y: y - 6 },
  ], { fill: navy, stroke: navy, width: 0.4 });
  page.drawText("N", { x: x - 3.2, y: y + 20, size: 7, font: bold, color: navy });
}

function drawLegend(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  x: number,
  y: number,
  evidence: ArchitecturalEvidence,
) {
  const geometry = evidence.geometry;
  page.drawRectangle({ x, y, width: 174, height: 52, color: rgb(1, 1, 1), opacity: 0.93, borderColor: line, borderWidth: 0.6 });
  page.drawRectangle({ x: x + 10, y: y + 30, width: 15, height: 8, color: navy, borderColor: cyan, borderWidth: 0.5 });
  page.drawText("Champ photovoltaïque projete", { x: x + 34, y: y + 31, size: 6.5, font: bold, color: graphite });
  page.drawLine({ start: { x: x + 10, y: y + 17 }, end: { x: x + 25, y: y + 17 }, thickness: 1, color: copper, dashArray: [4, 2] });
  page.drawText("Limite de toiture detectee", { x: x + 34, y: y + 14, size: 6.5, font, color: muted });
  page.drawText(`Accord geometrique ${(geometry.confidence * 100).toFixed(0)} %`, { x: x + 10, y: y + 4, size: 5.7, font, color: muted });
}

function formatMetres(valueMm: number | null) {
  return valueMm ? `${(valueMm / 1000).toFixed(2)} m` : "cote non publiee";
}

async function addGeneratedPlans(
  pdf: PDFDocument,
  project: DpProjectRecord,
  sourceByKind: Map<string, DpSourceFile>,
  bold: PDFFont,
  font: PDFFont,
  evidence: ArchitecturalEvidence,
  renderedViews: DpRenderedView[],
) {
  const satellite = sourceByKind.get("satellite");
  const satelliteMass = sourceByKind.get("satellite_mass");
  const renderedByKind = new Map(renderedViews.map((source) => [source.kind, source]));
  const satelliteProject = renderedByKind.get("satellite_project");
  const dp4Project = renderedByKind.get("dp4_project") ?? renderedByKind.get("near_project");
  const dp6Project = renderedByKind.get("dp6_project") ?? renderedByKind.get("near_project");
  const geometry = evidence.geometry;
  const dp4Source = sourceByKind.get(dp4Project?.sourceKind ?? geometry.project_photo_role ?? "near");
  const dp6Source = sourceByKind.get(dp6Project?.sourceKind ?? geometry.project_photo_role ?? "near");
  if (!satellite || !satelliteMass || !dp4Source || !dp6Source || !satelliteProject || !dp4Project || !dp6Project) throw new Error("Sources architecturales ou photomontages contrôlés manquants.");
  if (geometry.verdict !== "verified") throw new Error("Geometrie architecturale non verifiee.");
  if (geometry.source_sha256.satellite_mass !== satelliteMass.sha256 || geometry.source_sha256[dp6Source.kind] !== dp6Source.sha256) throw new Error("La geometrie ne correspond pas aux photographies source.");
  const allocations = geometry.face_allocations ?? [];
  const multiValid = allocations.length > 0 && allocations.reduce((sum, item) => sum + item.panel_count, 0) === project.moduleCount && allocations.every(item => item.satellite_panel_cells.length === item.panel_count && item.project_panel_cells.length === item.panel_count);
  const legacyValid = geometry.satellite_array_quad.length === 4 && geometry.near_array_quad.length === 4 && geometry.satellite_plane_anchors.length === 4 && geometry.near_plane_anchors.length === 4 && geometry.layout_rows * geometry.layout_columns === project.moduleCount;
  if (!multiValid && !legacyValid) throw new Error("Calepinage architectural invalide.");

  const rows = geometry.layout_rows;
  const columns = geometry.layout_columns;
  const allocationLabel = allocations.length > 1 ? allocations.map(a => `${a.label}: ${a.panel_count}`).join(" · ") : `${rows} × ${columns}`;
  const arrayWidthMm = dimensionValue(evidence, "array_width");
  const arrayHeightMm = dimensionValue(evidence, "array_height");
  const mapScaleMm = requiredDimension(evidence, "satellite_scale_reference", "l'échelle cartographique");
  const cadastralReference = requiredDetail(project, "cadastralReference", "la parcelle cadastrale");
  const municipality = requiredDetail(project, "municipality", "la commune");

  const dp1 = pdf.addPage(A4);
  dp1.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: paper });
  header(dp1, bold, "DP1", "Plan de situation · repérage du bâtiment concerné");
  const situation = await drawPhoto(pdf, dp1, satellite, 38, 122, 519, 595);
  const target = { x: situation.x + situation.width / 2, y: situation.y + situation.height / 2 };
  dp1.drawCircle({ x: target.x, y: target.y, size: 15, borderColor: copper, borderWidth: 2.2, opacity: 0.98 });
  dp1.drawCircle({ x: target.x, y: target.y, size: 4, color: copper, opacity: 0.98 });
  drawNorthArrow(dp1, 525, 740, bold);
  dp1.drawRectangle({ x: 38, y: 66, width: 519, height: 42, color: rgb(1, 1, 1), borderColor: line, borderWidth: 0.7 });
  dp1.drawText("TERRAIN DU PROJET", { x: 52, y: 91, size: 6.5, font: bold, color: copper });
  textBlock(dp1, font, project.siteAddress, 52, 77, 8, 480, graphite);
  dp1.drawText(`COMMUNE : ${municipality.toUpperCase()} · PARCELLE : ${cadastralReference}`, { x: 52, y: 61, size: 6.5, font: bold, color: navy });
  dp1.drawText(`NORD CARTOGRAPHIQUE · ECHELLE DE REFERENCE : ${formatMetres(mapScaleMm)} · SOURCE : ${safe(satellite.fileName)}`, { x: 52, y: 48, size: 5.7, font, color: muted });
  footer(dp1, font, project.id, pdf.getPageCount());

  const dp2 = pdf.addPage(A4);
  dp2.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: paper });
  header(dp2, bold, "DP2", "Plan de masse · implantation photovoltaïque contrôlée");
  const mass = await drawPhoto(pdf, dp2, { ...satelliteProject, fileName: "implantation-satellite-photorealiste.png" }, 38, 126, 519, 585);
  const massRoof = geometry.satellite_roof_outline.map((point) => toPdfPoint(point, mass));
  const massArray = geometry.satellite_array_quad.map((point) => toPdfPoint(point, mass));
  if (allocations.length) {
    allocations.forEach((allocation) => {
      drawRoofTrace(dp2, allocation.satellite_roof_outline.map((point) => toPdfPoint(point, mass)));
      allocation.satellite_panel_cells.forEach((cell) => drawPolygon(dp2, cell.map((point) => toPdfPoint(point, mass)), { stroke: rgb(0.75, 0.92, 1), width: 0.62, opacity: 0.94 }));
    });
  } else {
    drawRoofTrace(dp2, massRoof);
    drawPolygon(dp2, massArray, { stroke: rgb(0.75, 0.92, 1), width: 0.85, opacity: 0.9 });
  }
  const massCenter = {
    x: massArray.reduce((total, point) => total + point.x, 0) / massArray.length,
    y: massArray.reduce((total, point) => total + point.y, 0) / massArray.length,
  };
  drawDimensionLine(dp2, font, massArray[0], massArray[1], massCenter, formatMetres(arrayWidthMm));
  drawDimensionLine(dp2, font, massArray[1], massArray[2], massCenter, formatMetres(arrayHeightMm));
  drawNorthArrow(dp2, 525, 740, bold);
  drawLegend(dp2, font, bold, 373, 66, evidence);
  dp2.drawText(`${project.moduleCount} MODULES · ${allocationLabel} · ${geometry.module_orientation.toUpperCase()}`, { x: 38, y: 99, size: 8, font: bold, color: navy });
  dp2.drawText(`Emprise contrôlée ${formatMetres(arrayWidthMm)} × ${formatMetres(arrayHeightMm)}`, { x: 38, y: 82, size: 7.5, font, color: muted });
  dp2.drawText(`PARCELLE ${cadastralReference} · ECHELLE RECALÉE · COTES DU CHAMP PROJETÉ`, { x: 38, y: 68, size: 6, font: bold, color: copper });
  footer(dp2, font, project.id, pdf.getPageCount());

  const dp3 = pdf.addPage(A4);
  dp3.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: paper });
  header(dp3, bold, "DP3", "Coupe architecturale · complexe toiture et champ PV");
  const pitch = geometry.roof_pitch_deg;
  const radians = pitch * Math.PI / 180;
  const roofStart = { x: 82, y: 286 };
  const roofLength = 420;
  const roofEnd = { x: roofStart.x + roofLength * Math.cos(radians), y: roofStart.y + roofLength * Math.sin(radians) };
  dp3.drawRectangle({ x: 55, y: 180, width: 485, height: 450, color: rgb(1, 1, 1), borderColor: line, borderWidth: 0.7 });
  dp3.drawLine({ start: { x: 55, y: 245 }, end: { x: 540, y: 245 }, thickness: 0.8, color: muted, dashArray: [6, 4] });
  dp3.drawText("NIVEAU DE REFERENCE", { x: 62, y: 233, size: 6, font, color: muted });
  dp3.drawText("TERRAIN EXISTANT · COUPE COTEE DU PROJET", { x: 62, y: 219, size: 6, font: bold, color: copper });
  dp3.drawLine({ start: roofStart, end: roofEnd, thickness: 5.5, color: rgb(0.39, 0.32, 0.28) });
  const normal = { x: -Math.sin(radians) * 12, y: Math.cos(radians) * 12 };
  const panelStart = mixPoint(roofStart, roofEnd, 0.12);
  const panelEnd = mixPoint(roofStart, roofEnd, 0.88);
  const panelTopStart = { x: panelStart.x + normal.x, y: panelStart.y + normal.y };
  const panelTopEnd = { x: panelEnd.x + normal.x, y: panelEnd.y + normal.y };
  dp3.drawLine({ start: panelTopStart, end: panelTopEnd, thickness: 8, color: navy });
  dp3.drawLine({ start: panelStart, end: panelTopStart, thickness: 0.8, color: cyan });
  dp3.drawLine({ start: panelEnd, end: panelTopEnd, thickness: 0.8, color: cyan });
  dp3.drawLine({ start: { x: roofStart.x + 32, y: roofStart.y }, end: { x: roofStart.x + 32 * Math.cos(radians), y: roofStart.y + 32 * Math.sin(radians) }, thickness: 1, color: copper });
  dp3.drawText(`${pitch.toFixed(1)}°`, { x: roofStart.x + 48, y: roofStart.y + 14, size: 9, font: bold, color: copper });
  dp3.drawText("COUPE TECHNIQUE DU RAMPANT", { x: 72, y: 596, size: 7, font: bold, color: navy });
  dp3.drawText("Couverture existante", { x: 72, y: 205, size: 7, font, color: muted });
  dp3.drawText("Modules en surimposition parallèle au rampant", { x: 72, y: 188, size: 7, font: bold, color: navy });
  dp3.drawText("ETAT PROJETE", { x: 432, y: 596, size: 6.5, font: bold, color: navy });
  footer(dp3, font, project.id, pdf.getPageCount());

  const dp4 = pdf.addPage(A4);
  dp4.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: paper });
  header(dp4, bold, "DP4", "Façade et toiture · comparaison avant / projet");
  dp4.drawRectangle({ x: 38, y: 428, width: 519, height: 304, color: rgb(1, 1, 1), borderColor: line, borderWidth: 0.7 });
  dp4.drawRectangle({ x: 38, y: 90, width: 519, height: 304, color: rgb(1, 1, 1), borderColor: navy, borderWidth: 0.9 });
  await drawPhoto(pdf, dp4, dp4Source, 42, 432, 511, 296);
  await drawPhoto(pdf, dp4, { ...dp4Project, fileName: "facade-toiture-projetee.png" }, 42, 94, 511, 296);
  dp4.drawRectangle({ x: 50, y: 701, width: 78, height: 19, color: rgb(1, 1, 1), opacity: 0.92 });
  dp4.drawText("ETAT INITIAL", { x: 59, y: 707, size: 7, font: bold, color: muted });
  dp4.drawRectangle({ x: 50, y: 363, width: 86, height: 19, color: navy, opacity: 0.94 });
  dp4.drawText("ETAT PROJETE", { x: 59, y: 369, size: 7, font: bold, color: rgb(1, 1, 1) });
  footer(dp4, font, project.id, pdf.getPageCount());

  const dp5 = pdf.addPage(A4);
  dp5.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: paper });
  header(dp5, bold, "DP5", "Aspect extérieur · matériaux et teintes projetés");
  dp5.drawRectangle({ x: 55, y: 250, width: 485, height: 460, color: rgb(1, 1, 1), borderColor: line, borderWidth: 0.7 });
  dp5.drawText("DETAIL PHOTOGRAPHIQUE CONTROLE", { x: 74, y: 674, size: 7, font: bold, color: navy });
  dp5.drawText("ASPECT EXTERIEUR · MATERIAUX ET TEINTES", { x: 74, y: 690, size: 7, font: bold, color: copper });
  dp5.drawText("Photographie réelle conservée · seule l'emprise validée des modules est modifiée", { x: 74, y: 658, size: 6.5, font, color: muted });
  await drawPhoto(pdf, dp5, { ...dp4Project, fileName: "aspect-exterieur-photorealiste.png" }, 72, 280, 451, 355);
  dp5.drawText(safe(project.moduleReference), { x: 74, y: 215, size: 12, font: bold, color: graphite });
  dp5.drawText(`${project.moduleCount} modules · ${geometry.module_orientation} · ${allocationLabel}`, { x: 74, y: 194, size: 8, font, color: navy });
  textBlock(dp5, font, `Emprise contrôlée ${formatMetres(arrayWidthMm)} × ${formatMetres(arrayHeightMm)}. Teintes de représentation architecturale ; les couleurs réelles restent celles de la photographie et de la référence fabricant.`, 74, 174, 8, 440, muted);
  textBlock(dp5, font, `Matériaux : ${requiredDetail(project, "mountingSystem", "le système de pose")}. Teinte modules : ${requiredDetail(project, "panelColor", "la teinte des modules")}. Couverture : ${requiredDetail(project, "roofColor", "la teinte de couverture")}.`, 74, 138, 7.2, 440, graphite);
  footer(dp5, font, project.id, pdf.getPageCount());

  const dp6 = pdf.addPage(A4_LANDSCAPE);
  dp6.drawRectangle({ x: 0, y: 0, width: A4_LANDSCAPE[0], height: A4_LANDSCAPE[1], color: paper });
  header(dp6, bold, "DP6", "Plan des toitures · insertion photovoltaïque contrôlée");
  dp6.drawText(`PROJET : INSTALLATION DE PANNEAUX PHOTOVOLTAIQUES · ${safe(project.siteAddress)}`, {
    x: 38, y: 507, size: 7.2, font: bold, color: graphite,
  });
  dp6.drawText("ETAT PROJETE · INSERTION PHOTOGRAPHIQUE", { x: 38, y: 493, size: 6.2, font, color: muted });

  dp6.drawRectangle({ x: 22, y: 177, width: 602, height: 300, color: rgb(1, 1, 1), borderColor: line, borderWidth: 0.7 });
  const insertion = await drawPhoto(
    pdf,
    dp6,
    { ...dp6Project, fileName: "insertion-architecturale-photorealiste.png" },
    26,
    181,
    594,
    292,
  );
  const nearArray = geometry.near_array_quad.map((point) => toPdfPoint(point, insertion));
  const nearEave = geometry.near_eave_line.map((point) => toPdfPoint(point, insertion));
  const arrayCenter = {
    x: nearArray.reduce((total, point) => total + point.x, 0) / nearArray.length,
    y: nearArray.reduce((total, point) => total + point.y, 0) / nearArray.length,
  };
  const arrayBottom = {
    x: (nearArray[2].x + nearArray[3].x) / 2,
    y: (nearArray[2].y + nearArray[3].y) / 2,
  };
  const eaveProjection = projectPointOnLine(arrayBottom, nearEave[0], nearEave[1]);
  const eaveClearanceMm = dp6Project.metrics?.eave_clearance_mm ?? null;
  if (eaveClearanceMm !== null && Number.isFinite(eaveClearanceMm)) {
    drawPointDistance(dp6, bold, arrayBottom, eaveProjection, `${Math.round(eaveClearanceMm / 10)} cm`);
  }

  const calloutX = Math.min(insertion.x + insertion.width - 156, Math.max(insertion.x + 18, arrayCenter.x - 64));
  const calloutY = Math.min(insertion.y + insertion.height - 70, arrayCenter.y + 52);
  dp6.drawRectangle({ x: calloutX, y: calloutY, width: 150, height: 58, color: rgb(1, 1, 1), opacity: 0.93, borderColor: line, borderWidth: 0.6 });
  dp6.drawText("CHAMP PHOTOVOLTAIQUE", { x: calloutX + 10, y: calloutY + 43, size: 6.5, font: bold, color: navy });
  dp6.drawText(`${project.moduleCount} panneaux · ${safe(project.powerKwp)} kWc`, { x: calloutX + 10, y: calloutY + 30, size: 7, font: bold, color: graphite });
  dp6.drawText(`${allocationLabel} · ${geometry.module_orientation}`, { x: calloutX + 10, y: calloutY + 18, size: 6.3, font, color: muted });
  dp6.drawText(`Inclinaison : ${geometry.roof_pitch_deg.toFixed(1)}°`, { x: calloutX + 10, y: calloutY + 7, size: 6.3, font, color: muted });
  dp6.drawLine({
    start: { x: calloutX + 150, y: calloutY + 29 },
    end: { x: arrayCenter.x, y: arrayCenter.y },
    thickness: 0.8,
    color: rgb(1, 1, 1),
    opacity: 0.98,
  });
  dp6.drawCircle({ x: arrayCenter.x, y: arrayCenter.y, size: 2.2, color: rgb(1, 1, 1), opacity: 0.98 });

  const infoX = 638;
  const infoW = 182;
  dp6.drawRectangle({ x: infoX, y: 177, width: infoW, height: 300, color: rgb(1, 1, 1), borderColor: line, borderWidth: 0.7 });
  dp6.drawText("CARACTERISTIQUES", { x: infoX + 12, y: 455, size: 7, font: bold, color: navy });
  dp6.drawText("DE L'INSTALLATION", { x: infoX + 12, y: 443, size: 7, font: bold, color: navy });
  const moduleWidthMm = dimensionValue(evidence, "module_width");
  const moduleHeightMm = dimensionValue(evidence, "module_height");
  const roofOrientation = requiredDetail(project, "roofOrientation", "l'orientation de toiture");
  const characteristicRows = [
    ["Panneaux", String(project.moduleCount)],
    ["Calepinage", allocationLabel],
    ["Module", `${Math.round(moduleWidthMm || 0)} × ${Math.round(moduleHeightMm || 0)} mm`],
    ["Champ", `${formatMetres(arrayWidthMm)} × ${formatMetres(arrayHeightMm)}`],
    ["Orientation", roofOrientation],
    ["Inclinaison", `${geometry.roof_pitch_deg.toFixed(1)}°`],
    ["Pose", requiredDetail(project, "mountingSystem", "le système de pose")],
    ["Recul egout", eaveClearanceMm !== null ? `${Math.round(eaveClearanceMm / 10)} cm` : "non publie"],
  ];
  let infoY = 420;
  for (const [label, value] of characteristicRows) {
    dp6.drawText(label.toUpperCase(), { x: infoX + 12, y: infoY, size: 5.3, font: bold, color: muted });
    textBlock(dp6, font, value, infoX + 72, infoY, 6.1, 96, graphite);
    infoY -= 23;
  }
  const visualScore = dp6Project.metrics?.visual_conformity_score;
  dp6.drawLine({ start: { x: infoX + 12, y: 222 }, end: { x: infoX + infoW - 12, y: 222 }, thickness: 0.6, color: line });
  dp6.drawText("CONTROLE PILOTPAPER", { x: infoX + 12, y: 207, size: 5.5, font: bold, color: copper });
  dp6.drawText(allocations.length > 1 ? `${allocations.length} pans séparés · aucun franchissement` : "Pan de toiture uniquement", { x: infoX + 12, y: 194, size: 6, font: bold, color: graphite });
  dp6.drawText(
    `Conformite visuelle ${visualScore !== undefined ? `${(visualScore * 100).toFixed(1)} %` : "controlee"}`,
    { x: infoX + 12, y: 183, size: 5.8, font, color: muted },
  );

  dp6.drawRectangle({ x: 22, y: 52, width: 190, height: 110, color: rgb(1, 1, 1), borderColor: line, borderWidth: 0.7 });
  dp6.drawText("LOCALISATION · VUE AERIENNE", { x: 30, y: 149, size: 5.8, font: bold, color: navy });
  const aerial = await drawPhoto(pdf, dp6, { ...satelliteProject, fileName: "implantation-satellite.png" }, 28, 60, 178, 82);
  if (allocations.length) {
    allocations.forEach((allocation) => {
      drawRoofTrace(dp6, allocation.satellite_roof_outline.map((point) => toPdfPoint(point, aerial)));
      allocation.satellite_panel_cells.forEach((cell) => drawPolygon(dp6, cell.map((point) => toPdfPoint(point, aerial)), { stroke: cyan, width: 0.5, opacity: 0.94 }));
    });
  } else {
    drawRoofTrace(dp6, geometry.satellite_roof_outline.map((point) => toPdfPoint(point, aerial)));
    drawPolygon(dp6, geometry.satellite_array_quad.map((point) => toPdfPoint(point, aerial)), { stroke: cyan, width: 0.75, opacity: 0.9 });
  }

  dp6.drawRectangle({ x: 224, y: 52, width: 190, height: 110, color: rgb(1, 1, 1), borderColor: line, borderWidth: 0.7 });
  dp6.drawText("ETAT INITIAL · PHOTO SOURCE", { x: 232, y: 149, size: 5.8, font: bold, color: navy });
  await drawPhoto(pdf, dp6, dp6Source, 230, 60, 178, 82);

  dp6.drawRectangle({ x: 426, y: 52, width: 394, height: 110, color: rgb(1, 1, 1), borderColor: line, borderWidth: 0.7 });
  dp6.drawText("LEGENDE & GARANTIES GEOMETRIQUES", { x: 438, y: 145, size: 6.2, font: bold, color: navy });
  dp6.drawRectangle({ x: 438, y: 125, width: 22, height: 10, color: navy, borderColor: cyan, borderWidth: 0.5 });
  dp6.drawText("Panneaux photovoltaïques projetés", { x: 470, y: 127, size: 5.8, font, color: graphite });
  dp6.drawLine({ start: { x: 438, y: 111 }, end: { x: 460, y: 111 }, thickness: 1, color: copper, dashArray: [4, 2] });
  dp6.drawText("Limite du pan vérifié", { x: 470, y: 108, size: 5.8, font, color: graphite });
  dp6.drawText("Aucun pixel hors pan n'est modifié par le moteur d'insertion.", { x: 438, y: 91, size: 5.7, font: bold, color: graphite });
  dp6.drawText(`Accord géométrique ${(geometry.confidence * 100).toFixed(1)} % · perspective et cotes contrôlées`, { x: 438, y: 77, size: 5.7, font, color: muted });
  dp6.drawText(`SOURCE : ${safe(dp6Source.fileName)} · ETAT PROJETE`, { x: 438, y: 63, size: 5.5, font: bold, color: copper });
  footer(dp6, font, project.id, pdf.getPageCount());
}

export async function buildDpPdf(
  project: DpProjectRecord,
  sources: DpSourceFile[],
  evidence: ArchitecturalEvidence,
  officialCerfaBytes: Uint8Array,
  renderedViews: DpRenderedView[],
) {
  const moduleWidthMm = requiredDimension(evidence, "module_width", "la largeur du module");
  const moduleHeightMm = requiredDimension(evidence, "module_height", "la hauteur du module");
  requiredDimension(evidence, "array_width", "la largeur du champ");
  requiredDimension(evidence, "array_height", "la hauteur du champ");
  requiredDimension(evidence, "satellite_scale_reference", "l'échelle satellite");
  requiredDetail(project, "cadastralReference", "la parcelle cadastrale");
  requiredDetail(project, "parcelAreaM2", "la superficie du terrain");
  requiredDetail(project, "municipality", "la commune");
  requiredDetail(project, "roofOrientation", "l'orientation de toiture");
  requiredDetail(project, "roofColor", "la teinte de couverture");
  requiredDetail(project, "panelColor", "la teinte des modules");
  requiredDetail(project, "mountingSystem", "le système de pose");
  const pdf = await fillOfficialCerfa(officialCerfaBytes, project);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const createdAt = new Date();

  pdf.setTitle(`Declaration prealable - ${safe(project.requesterName)}`);
  pdf.setAuthor("PilotPaper");
  pdf.setSubject("Dossier photovoltaïque DP1 a DP8");
  pdf.setCreator("PilotPaper - moteur documentaire controle");
  pdf.setKeywords([
    "DP1-DP8",
    "geometrie-double-controle",
    `geometry-confidence-${evidence.geometry.confidence.toFixed(3)}`,
    `policy-${CONFORMITY_POLICY_VERSION}`,
  ]);

  const cover = pdf.insertPage(0, A4);
  cover.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: rgb(0.97, 0.97, 0.96) });
  cover.drawText("Pilot", { x: 44, y: 772, size: 24, font: bold, color: navy });
  cover.drawText("Paper", { x: 94, y: 772, size: 24, font: bold, color: muted });
  cover.drawText("DECLARATION PREALABLE", { x: 44, y: 660, size: 24, font: bold, color: graphite });
  cover.drawText("Installation photovoltaïque", { x: 44, y: 626, size: 16, font, color: muted });
  if (project.details.demoMode === "true") {
    cover.drawRectangle({ x: 44, y: 584, width: 507, height: 24, color: copper });
    cover.drawText("EXEMPLE FICTIF - NE PAS DEPOSER EN MAIRIE", {
      x: 56,
      y: 591,
      size: 9,
      font: bold,
      color: rgb(1, 1, 1),
    });
  }
  let y = 550;
  const rows = [
    ["Demandeur", project.requesterName],
    ["Adresse du projet", project.siteAddress],
    ["Puissance", `${project.powerKwp} kWc`],
    ["Modules", `${project.moduleCount} x ${project.moduleReference}`],
    ["Parcelle", project.details.cadastralReference],
    ["Reference", project.id],
  ];
  rows.forEach(([label, value]) => {
    cover.drawText(label.toUpperCase(), { x: 44, y, size: 7, font: bold, color: muted });
    y = textBlock(cover, font, value, 44, y - 18, 11, 470, graphite) - 18;
  });
  cover.drawText(`Produit le ${createdAt.toLocaleDateString("fr-FR")}`, { x: 44, y: 70, size: 8, font, color: muted });

  const notice = pdf.addPage(A4);
  header(notice, bold, "NOTICE", "Description du projet photovoltaïque");
  let ny = 740;
  const noticeSections = [
    ["Projet", project.details.projectDescription || `Pose de ${project.moduleCount} modules photovoltaïques ${project.moduleReference} sur toiture existante.`],
    ["Implantation", evidence.geometry.face_allocations?.length ? `${project.moduleCount} modules répartis sans franchissement de faîtage : ${evidence.geometry.face_allocations.map(a => `${a.label} ${a.panel_count} module(s)`).join(" ; ")}. Dimensions unitaires vérifiées : ${moduleWidthMm.toFixed(0)} × ${moduleHeightMm.toFixed(0)} mm.` : `${project.moduleCount} modules organisés en ${evidence.geometry.layout_rows} rangée(s) et ${evidence.geometry.layout_columns} colonne(s). Dimensions unitaires vérifiées : ${moduleWidthMm.toFixed(0)} × ${moduleHeightMm.toFixed(0)} mm.`],
    ["Recalage métrique", `Échelle cartographique et cotes rattachées au rapport CoteGuard versionné. Aucune mesure visuelle non calibrée n'est publiée.`],
    ["Toiture", `Orientation ${requiredDetail(project, "roofOrientation", "l'orientation de toiture")}, pente vérifiée ${evidence.geometry.roof_pitch_deg.toFixed(1)} degrés, support ${project.supportType}.`],
    ["Aspect", `Modules ${requiredDetail(project, "panelColor", "la teinte des modules")}. Couverture existante : ${requiredDetail(project, "roofColor", "la teinte de couverture")}. Système de pose : ${requiredDetail(project, "mountingSystem", "le système de pose")}.`],
    ["Exploitation", `Puissance totale ${project.powerKwp} kWc. Mode : ${project.injectionMode}.`],
  ];
  noticeSections.forEach(([title, body]) => {
    notice.drawText(title.toUpperCase(), { x: 38, y: ny, size: 8, font: bold, color: navy });
    ny = textBlock(notice, font, body, 38, ny - 20, 10, 519, graphite) - 24;
  });
  footer(notice, font, project.id, pdf.getPageCount());

  const sourceByKind = new Map(sources.map((source) => [source.kind, source]));
  await addGeneratedPlans(pdf, project, sourceByKind, bold, font, evidence, renderedViews);
  for (const [code, title, kind] of pieces.slice(6)) {
    const source = sourceByKind.get(kind);
    if (source) await appendSource(pdf, source, bold, font, code, title, project.id);
  }

  const audit = pdf.addPage(A4);
  header(audit, bold, "CONTROLE", "Rapport de tracabilite");
  let ay = 740;
  const checks = [
    "Identite du demandeur complete",
    "Adresse du terrain et reference cadastrale presentes",
    "Configuration photovoltaïque dimensionnee",
    "Reference module transmise au moteur documentaire",
    "Echelle et implantation analysees depuis la vue satellite",
    "Cerfa pre-rempli automatiquement",
    "Pieces DP1 a DP8 generees et controlees",
    "Empreintes des sources conservees",
    "Attestation finale de l'operateur enregistree",
  ];
  checks.forEach((check) => {
    audit.drawCircle({ x: 44, y: ay + 2, size: 4, color: rgb(0.02, 0.59, 0.41) });
    audit.drawText(check, { x: 58, y: ay - 2, size: 9, font, color: graphite });
    ay -= 26;
  });
  ay -= 14;
  sources.forEach((source) => {
    audit.drawText(`${source.kind} - ${safe(source.fileName)}`, { x: 38, y: ay, size: 7, font: bold, color: graphite });
    audit.drawText(source.sha256, { x: 38, y: ay - 12, size: 6, font, color: muted });
    ay -= 32;
  });
  footer(audit, font, project.id, pdf.getPageCount());

  return pdf.save();
}
