import type { FacePlacement, Point2D, ProjectContext, RoofViewObservation } from "../types";

type QuadMapper = (q: Point2D[], u: number, v: number) => Point2D;

function bilinear(q: Point2D[], u: number, v: number): Point2D {
  const [bl, br, tr, tl] = q;
  if (!bl || !br || !tr || !tl) {
    throw new Error("A four-corner roof/support quad is required for metric panel projection.");
  }
  const bottom = { x: bl.x + (br.x - bl.x) * u, y: bl.y + (br.y - bl.y) * u };
  const top = { x: tl.x + (tr.x - tl.x) * u, y: tl.y + (tr.y - tl.y) * u };
  return { x: bottom.x + (top.x - bottom.x) * v, y: bottom.y + (top.y - bottom.y) * v };
}

/**
 * Exact homography from the unit square to a four-corner planar roof quad.
 * Corner order is the same contract historically used by PilotPaper:
 * bottom-left, bottom-right, top-right, top-left.
 *
 * Unlike bilinear interpolation, this preserves straight lines and vanishing
 * geometry on a planar roof face, which is what a perspective camera observes.
 */
export function projectivePointInQuad(q: Point2D[], u: number, v: number): Point2D {
  const [bl, br, tr, tl] = q;
  if (!bl || !br || !tr || !tl) {
    throw new Error("A four-corner roof/support quad is required for projective panel projection.");
  }

  const dx1 = br.x - tr.x;
  const dx2 = tl.x - tr.x;
  const dx3 = bl.x - br.x + tr.x - tl.x;
  const dy1 = br.y - tr.y;
  const dy2 = tl.y - tr.y;
  const dy3 = bl.y - br.y + tr.y - tl.y;
  const denominator = dx1 * dy2 - dx2 * dy1;

  let g = 0;
  let h = 0;
  if (Math.abs(dx3) > 1e-12 || Math.abs(dy3) > 1e-12) {
    if (Math.abs(denominator) < 1e-12) {
      // Degenerate quadrilateral: preserve the safe historical behavior rather
      // than creating an unstable homography.
      return bilinear(q, u, v);
    }
    g = (dx3 * dy2 - dx2 * dy3) / denominator;
    h = (dx1 * dy3 - dx3 * dy1) / denominator;
  }

  const a = br.x - bl.x + g * br.x;
  const b = tl.x - bl.x + h * tl.x;
  const c = bl.x;
  const d = br.y - bl.y + g * br.y;
  const e = tl.y - bl.y + h * tl.y;
  const f = bl.y;
  const w = g * u + h * v + 1;

  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return bilinear(q, u, v);
  const x = (a * u + b * v + c) / w;
  const y = (d * u + e * v + f) / w;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return bilinear(q, u, v);
  return { x, y };
}

function orientedPanel(context: ProjectContext) {
  return context.array.orientation === "portrait"
    ? { widthMm: context.panel.widthMm, heightMm: context.panel.heightMm }
    : { widthMm: context.panel.heightMm, heightMm: context.panel.widthMm };
}

function rowWidthMm(panelWidthMm: number, gapMm: number, count: number) {
  return count * panelWidthMm + Math.max(0, count - 1) * gapMm;
}

/**
 * Resolve the left origin of one row inside the already-resolved full field.
 * This prevents image projection from independently recentering rows and
 * drifting away from the deterministic layout solver.
 */
export function resolvedRowLeftMm(
  context: ProjectContext,
  placement: FacePlacement,
  rowCount: number,
): number {
  const { widthMm: panelWidth } = orientedPanel(context);
  const gap = Math.max(0, context.array.interPanelGapMm ?? 20);
  const fullFieldWidth = rowWidthMm(panelWidth, gap, placement.columns);
  const rowWidth = rowWidthMm(panelWidth, gap, rowCount);
  const fallbackFieldLeft = Math.max(0, (placement.widthMm - fullFieldWidth) / 2);
  const fieldLeft = placement.resolvedLeftMm ?? fallbackFieldLeft;
  const spareInsideField = Math.max(0, fullFieldWidth - rowWidth);

  if (context.array.placement === "left") return fieldLeft;
  if (context.array.placement === "right") return fieldLeft + spareInsideField;
  return fieldLeft + spareInsideField / 2;
}

function panelPolygonsForViewWithMapper(
  context: ProjectContext,
  view: RoofViewObservation,
  map: QuadMapper,
): Point2D[][] | undefined {
  const q = view.roofPolygonNormalized;
  if (q.length !== 4) return undefined;
  const placement =
    (context.facePlacements ?? []).find((item) => item.faceId === view.faceId) ??
    context.facePlacements?.[0];

  if (!placement) {
    const roof = context.roofGeometry;
    const resolved = context.resolvedPlacement;
    if (!roof?.widthMm || !roof.slopeLengthMm || !resolved) return undefined;
    const { widthMm: panelW, heightMm: panelH } = orientedPanel(context);
    const gap = Math.max(0, context.array.interPanelGapMm ?? 20);
    const polygons: Point2D[][] = [];
    for (let row = 0; row < context.array.rows; row++) {
      for (let col = 0; col < context.array.columns; col++) {
        const x0 = resolved.leftMm + col * (panelW + gap);
        const x1 = x0 + panelW;
        const y0 = resolved.gutterMm + row * (panelH + gap);
        const y1 = y0 + panelH;
        const values = [x0 / roof.widthMm, x1 / roof.widthMm, y0 / roof.slopeLengthMm, y1 / roof.slopeLengthMm];
        if (values.some((value) => value < 0 || value > 1)) return undefined;
        polygons.push([
          map(q, values[0]!, values[2]!),
          map(q, values[1]!, values[2]!),
          map(q, values[1]!, values[3]!),
          map(q, values[0]!, values[3]!),
        ]);
      }
    }
    return polygons;
  }

  const { widthMm: panelW, heightMm: panelH } = orientedPanel(context);
  const gap = Math.max(0, context.array.interPanelGapMm ?? 20);
  const roofW = placement.widthMm;
  const roofH = placement.slopeLengthMm;
  const polygons: Point2D[][] = [];
  let emitted = 0;

  for (let row = 0; row < placement.rows && emitted < placement.panelCount; row++) {
    const rowCount =
      row === placement.rows - 1
        ? placement.lastRowCount
        : Math.min(placement.columns, placement.panelCount - emitted);
    const rowWidth = rowWidthMm(panelW, gap, rowCount);
    const left = resolvedRowLeftMm(context, placement, rowCount);
    if (left < -1e-6 || left + rowWidth > roofW + 1e-6) return undefined;

    for (let col = 0; col < rowCount && emitted < placement.panelCount; col++) {
      const x0 = left + col * (panelW + gap);
      const x1 = x0 + panelW;
      const y0 = placement.resolvedGutterMm + row * (panelH + gap);
      const y1 = y0 + panelH;
      const u0 = x0 / roofW;
      const u1 = x1 / roofW;
      const v0 = y0 / roofH;
      const v1 = y1 / roofH;
      if ([u0, u1, v0, v1].some((value) => value < -1e-9 || value > 1 + 1e-9)) return undefined;
      polygons.push([
        map(q, u0, v0),
        map(q, u1, v0),
        map(q, u1, v1),
        map(q, u0, v1),
      ]);
      emitted++;
    }
  }

  return emitted === placement.panelCount ? polygons : undefined;
}

/** Historical production projection. Kept unchanged until projective mode is benchmark-validated. */
export function panelPolygonsForView(
  context: ProjectContext,
  view: RoofViewObservation,
): Point2D[][] | undefined {
  return panelPolygonsForViewWithMapper(context, view, bilinear);
}

/** Projective planar projection used first by the isolated Admin laboratory. */
export function panelPolygonsForViewProjective(
  context: ProjectContext,
  view: RoofViewObservation,
): Point2D[][] | undefined {
  return panelPolygonsForViewWithMapper(context, view, projectivePointInQuad);
}

function allPanelPolygonsForRoleWithMapper(
  context: ProjectContext,
  role: RoofViewObservation["role"],
  map: QuadMapper,
): Point2D[][] | undefined {
  const placements = context.facePlacements ?? [];
  if (!placements.length) {
    const view = context.roof.views?.find((item) => item.role === role && item.selectedFaceVisible);
    return view ? panelPolygonsForViewWithMapper(context, view, map) : undefined;
  }

  const output: Point2D[][] = [];
  for (const placement of placements) {
    const view = context.roof.views?.find(
      (item) => item.role === role && item.faceId === placement.faceId && item.selectedFaceVisible,
    );
    if (!view) continue;
    const polygons = panelPolygonsForViewWithMapper(context, view, map);
    if (!polygons) return undefined;
    output.push(...polygons);
  }
  return output.length ? output : undefined;
}

/** All expected module polygons in one image role, using the historical production mapping. */
export function allPanelPolygonsForRole(
  context: ProjectContext,
  role: RoofViewObservation["role"],
): Point2D[][] | undefined {
  return allPanelPolygonsForRoleWithMapper(context, role, bilinear);
}

/** All expected module polygons in one image role, using exact planar homography. */
export function allPanelPolygonsForRoleProjective(
  context: ProjectContext,
  role: RoofViewObservation["role"],
): Point2D[][] | undefined {
  return allPanelPolygonsForRoleWithMapper(context, role, projectivePointInQuad);
}
