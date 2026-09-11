import type {
  ArraySpec,
  FacePlacement,
  PanelSpec,
  PhysicalModulePlacement,
  RoofFaceMetricGeometry,
} from "../types";
import { auditPhysicalModules, materializePhysicalModules } from "./moduleGeometry";

export interface PolygonalPlacementSolution {
  placement: FacePlacement;
  modules: PhysicalModulePlacement[];
  score: number;
}

const EPS = 1e-6;

function orientedPanel(panel: PanelSpec, orientation: ArraySpec["orientation"]) {
  return orientation === "portrait"
    ? { widthMm: panel.widthMm, heightMm: panel.heightMm }
    : { widthMm: panel.heightMm, heightMm: panel.widthMm };
}

function finite(value: number | undefined, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function polygonBounds(face: RoofFaceMetricGeometry) {
  const polygon = face.surfacePolygonMm;
  if (!polygon?.length) return undefined;
  const xs = polygon.map((point) => point.xMm);
  const ys = polygon.map((point) => point.yMm);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function uniqueSorted(values: number[]) {
  return [...new Set(values.filter(Number.isFinite).map((value) => Math.round(value * 1e6) / 1e6))].sort(
    (a, b) => a - b,
  );
}

function fieldDimensions(panel: PanelSpec, array: ArraySpec, rows: number, columns: number) {
  const { widthMm, heightMm } = orientedPanel(panel, array.orientation);
  const gap = Math.max(0, array.interPanelGapMm ?? 20);
  return {
    widthMm: columns * widthMm + Math.max(0, columns - 1) * gap,
    heightMm: rows * heightMm + Math.max(0, rows - 1) * gap,
  };
}

function candidateMatrices(array: ArraySpec, panelCount: number, maxColumns: number) {
  if (array.layoutMode !== "automatic") {
    if (array.rows * array.columns !== panelCount) return [];
    return [{ rows: array.rows, columns: array.columns }];
  }

  const matrices: Array<{ rows: number; columns: number }> = [];
  for (let columns = 1; columns <= Math.min(panelCount, maxColumns); columns++) {
    matrices.push({ rows: Math.ceil(panelCount / columns), columns });
  }
  return matrices;
}

function candidateOrigins(args: {
  face: RoofFaceMetricGeometry;
  panel: PanelSpec;
  array: ArraySpec;
  fieldWidthMm: number;
  fieldHeightMm: number;
}) {
  const { face, panel, array, fieldWidthMm, fieldHeightMm } = args;
  const bounds = polygonBounds(face);
  if (!bounds) return { xs: [], ys: [] };

  const { widthMm: panelWidth, heightMm: panelHeight } = orientedPanel(panel, array.orientation);
  const gap = Math.max(0, array.interPanelGapMm ?? 20);
  const leftClearance = Math.max(0, finite(array.leftEdgeClearanceMm));
  const rightClearance = Math.max(0, finite(array.rightEdgeClearanceMm));
  const ridgeClearance = Math.max(0, finite(array.ridgeClearanceMm));
  const preferredGutter = Math.max(0, finite(array.gutterClearanceMm, 300));

  const minX = bounds.minX + leftClearance;
  const maxX = bounds.maxX - rightClearance - fieldWidthMm;
  const minY = bounds.minY;
  const maxY = bounds.maxY - ridgeClearance - fieldHeightMm;
  const centerX = (minX + maxX) / 2;
  const preferredY = Math.min(maxY, Math.max(minY, bounds.minY + preferredGutter));

  const xs = [minX, maxX, centerX];
  const ys = [minY, maxY, preferredY];

  for (const obstacle of face.obstaclePolygonsMm ?? []) {
    if (!obstacle.polygonMm.length) continue;
    const ox = obstacle.polygonMm.map((point) => point.xMm);
    const oy = obstacle.polygonMm.map((point) => point.yMm);
    const obstacleMinX = Math.min(...ox);
    const obstacleMaxX = Math.max(...ox);
    const obstacleMinY = Math.min(...oy);
    const obstacleMaxY = Math.max(...oy);

    // Candidate whole-field origins immediately before/after an obstacle.
    xs.push(obstacleMinX - gap - fieldWidthMm, obstacleMaxX + gap);
    ys.push(obstacleMinY - gap - fieldHeightMm, obstacleMaxY + gap);

    // Also align a module edge around the obstacle. This helps automatic layouts
    // find a compact legal position without using project-specific heuristics.
    xs.push(obstacleMinX - gap - panelWidth, obstacleMaxX + gap);
    ys.push(obstacleMinY - gap - panelHeight, obstacleMaxY + gap);
  }

  return {
    xs: uniqueSorted(xs).filter((value) => value >= minX - EPS && value <= maxX + EPS),
    ys: uniqueSorted(ys).filter((value) => value >= minY - EPS && value <= maxY + EPS),
  };
}

function placementScore(args: {
  face: RoofFaceMetricGeometry;
  placement: FacePlacement;
  array: ArraySpec;
  requestedRows: number;
  requestedColumns: number;
}) {
  const { face, placement, array, requestedRows, requestedColumns } = args;
  const bounds = polygonBounds(face)!;
  const left = placement.resolvedLeftMm ?? 0;
  const right = placement.resolvedRightMm ?? 0;
  const gutter = placement.resolvedGutterMm;
  const preferredGutter = Math.max(0, finite(array.gutterClearanceMm, 300));
  const lateralImbalance = Math.abs(left - right);
  const gutterPenalty = Math.abs(gutter - preferredGutter);
  const matrixPenalty = Math.abs(placement.rows - requestedRows) * 250 + Math.abs(placement.columns - requestedColumns) * 250;
  const highEdge = bounds.maxY - (placement.resolvedRidgeMm ?? 0);
  const verticalCenter = (gutter + highEdge) / 2;
  const roofVerticalCenter = (bounds.minY + bounds.maxY) / 2;
  const verticalPenalty = Math.abs(verticalCenter - roofVerticalCenter) * 0.05;

  if (array.placement === "left") return left * 10 + gutterPenalty + matrixPenalty + verticalPenalty;
  if (array.placement === "right") return right * 10 + gutterPenalty + matrixPenalty + verticalPenalty;
  return lateralImbalance + gutterPenalty + matrixPenalty + verticalPenalty;
}

/**
 * Deterministic bounded V1 polygon-aware solver.
 *
 * It never asks generative AI where panels should go. For a fixed matrix it only
 * translates that exact matrix. In automatic mode it can compare deterministic
 * row/column matrices, but every candidate must pass the physical polygon audit.
 */
export function solvePolygonalPlacement(args: {
  face: RoofFaceMetricGeometry;
  panel: PanelSpec;
  array: ArraySpec;
  panelCount: number;
  startIndex?: number;
}): PolygonalPlacementSolution | undefined {
  const { face, panel, array, panelCount } = args;
  const bounds = polygonBounds(face);
  if (!bounds || !face.widthMm || !face.slopeLengthMm || panelCount < 1) return undefined;

  const { widthMm: panelWidth } = orientedPanel(panel, array.orientation);
  const gap = Math.max(0, array.interPanelGapMm ?? 20);
  const usableWidth = Math.max(
    0,
    bounds.maxX - bounds.minX - Math.max(0, finite(array.leftEdgeClearanceMm)) - Math.max(0, finite(array.rightEdgeClearanceMm)),
  );
  const maxColumns = Math.max(1, Math.floor((usableWidth + gap) / (panelWidth + gap)));
  const matrices = candidateMatrices(array, panelCount, maxColumns);
  let best: PolygonalPlacementSolution | undefined;

  for (const matrix of matrices) {
    const dimensions = fieldDimensions(panel, array, matrix.rows, matrix.columns);
    const origins = candidateOrigins({
      face,
      panel,
      array,
      fieldWidthMm: dimensions.widthMm,
      fieldHeightMm: dimensions.heightMm,
    });

    for (const x of origins.xs) {
      for (const y of origins.ys) {
        const lastRowCount = panelCount - Math.max(0, matrix.rows - 1) * matrix.columns;
        if (lastRowCount < 1 || lastRowCount > matrix.columns) continue;
        const right = face.widthMm - x - dimensions.widthMm;
        const ridge = face.slopeLengthMm - y - dimensions.heightMm;
        if (right < -EPS || ridge < -EPS) continue;

        const placement: FacePlacement = {
          faceId: face.id,
          label: face.label,
          panelCount,
          rows: matrix.rows,
          columns: matrix.columns,
          lastRowCount,
          resolvedGutterMm: y,
          resolvedRidgeMm: ridge,
          resolvedLeftMm: x,
          resolvedRightMm: right,
          widthMm: face.widthMm,
          slopeLengthMm: face.slopeLengthMm,
        };

        const audit = auditPhysicalModules({ face, placement, panel, array, startIndex: args.startIndex });
        if (!audit.passed) continue;
        const modules = materializePhysicalModules({ placement, panel, array, startIndex: args.startIndex });
        const score = placementScore({
          face,
          placement,
          array,
          requestedRows: array.rows,
          requestedColumns: array.columns,
        });
        const solution = {
          placement: { ...placement, modulePlacementsMm: modules },
          modules,
          score,
        };
        if (!best || solution.score < best.score - EPS) best = solution;
      }
    }
  }

  return best;
}
