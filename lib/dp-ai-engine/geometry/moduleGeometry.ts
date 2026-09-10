import type {
  ArraySpec,
  FacePlacement,
  MetricPoint2D,
  PanelSpec,
  PhysicalModulePlacement,
  RoofFaceMetricGeometry,
} from "../types";

export interface PhysicalLayoutAudit {
  passed: boolean;
  modules: PhysicalModulePlacement[];
  errors: string[];
}

const EPS = 1e-6;

function orientedPanel(panel: PanelSpec, orientation: ArraySpec["orientation"]) {
  return orientation === "portrait"
    ? { widthMm: panel.widthMm, heightMm: panel.heightMm }
    : { widthMm: panel.heightMm, heightMm: panel.widthMm };
}

function rowWidthMm(panelWidthMm: number, gapMm: number, count: number) {
  return count * panelWidthMm + Math.max(0, count - 1) * gapMm;
}

function finitePoint(point: MetricPoint2D) {
  return Number.isFinite(point.xMm) && Number.isFinite(point.yMm);
}

export function metricPolygonArea(poly: MetricPoint2D[]) {
  if (poly.length < 3) return 0;
  let value = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    value += poly[j]!.xMm * poly[i]!.yMm - poly[i]!.xMm * poly[j]!.yMm;
  }
  return Math.abs(value) / 2;
}

function cross(a: MetricPoint2D, b: MetricPoint2D, c: MetricPoint2D) {
  return (b.xMm - a.xMm) * (c.yMm - a.yMm) - (b.yMm - a.yMm) * (c.xMm - a.xMm);
}

function pointOnSegment(point: MetricPoint2D, a: MetricPoint2D, b: MetricPoint2D) {
  if (Math.abs(cross(a, b, point)) > EPS) return false;
  return (
    point.xMm >= Math.min(a.xMm, b.xMm) - EPS &&
    point.xMm <= Math.max(a.xMm, b.xMm) + EPS &&
    point.yMm >= Math.min(a.yMm, b.yMm) - EPS &&
    point.yMm <= Math.max(a.yMm, b.yMm) + EPS
  );
}

/** Boundary-inclusive point in polygon. */
export function pointInMetricPolygon(point: MetricPoint2D, polygon: MetricPoint2D[]) {
  if (polygon.length < 3) return false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (pointOnSegment(point, polygon[j]!, polygon[i]!)) return true;
  }

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects =
      (a.yMm > point.yMm) !== (b.yMm > point.yMm) &&
      point.xMm < ((b.xMm - a.xMm) * (point.yMm - a.yMm)) / (b.yMm - a.yMm) + a.xMm;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function isConvexMetricPolygon(polygon: MetricPoint2D[]) {
  if (polygon.length < 3 || !polygon.every(finitePoint) || metricPolygonArea(polygon) <= EPS) return false;
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const value = cross(
      polygon[i]!,
      polygon[(i + 1) % polygon.length]!,
      polygon[(i + 2) % polygon.length]!,
    );
    if (Math.abs(value) <= EPS) continue;
    const current = Math.sign(value);
    if (!sign) sign = current;
    else if (current !== sign) return false;
  }
  return sign !== 0;
}

function orientation(a: MetricPoint2D, b: MetricPoint2D, c: MetricPoint2D) {
  const value = cross(a, b, c);
  if (Math.abs(value) <= EPS) return 0;
  return value > 0 ? 1 : -1;
}

function segmentsIntersectOrTouch(
  a: MetricPoint2D,
  b: MetricPoint2D,
  c: MetricPoint2D,
  d: MetricPoint2D,
) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && pointOnSegment(c, a, b)) return true;
  if (o2 === 0 && pointOnSegment(d, a, b)) return true;
  if (o3 === 0 && pointOnSegment(a, c, d)) return true;
  if (o4 === 0 && pointOnSegment(b, c, d)) return true;
  return false;
}

/** Touching counts as collision for obstacle safety. */
export function metricPolygonsOverlapOrTouch(a: MetricPoint2D[], b: MetricPoint2D[]) {
  if (a.length < 3 || b.length < 3) return false;
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!;
    const a1 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j]!;
      const b1 = b[(j + 1) % b.length]!;
      if (segmentsIntersectOrTouch(a0, a1, b0, b1)) return true;
    }
  }
  return pointInMetricPolygon(a[0]!, b) || pointInMetricPolygon(b[0]!, a);
}

function projectionInterval(polygon: MetricPoint2D[], axisX: number, axisY: number) {
  let min = Infinity;
  let max = -Infinity;
  for (const point of polygon) {
    const value = point.xMm * axisX + point.yMm * axisY;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

/**
 * Positive-area overlap test for convex polygons (physical modules are convex quads).
 * Edge or corner contact is intentionally NOT considered overlap here. This differs
 * from obstacle collision, where contact remains unsafe and therefore blocking.
 */
export function metricConvexPolygonsOverlapArea(a: MetricPoint2D[], b: MetricPoint2D[]) {
  if (a.length < 3 || b.length < 3 || !a.every(finitePoint) || !b.every(finitePoint)) return false;
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p0 = polygon[i]!;
      const p1 = polygon[(i + 1) % polygon.length]!;
      const edgeX = p1.xMm - p0.xMm;
      const edgeY = p1.yMm - p0.yMm;
      const length = Math.hypot(edgeX, edgeY);
      if (length <= EPS) continue;
      const axisX = -edgeY / length;
      const axisY = edgeX / length;
      const pa = projectionInterval(a, axisX, axisY);
      const pb = projectionInterval(b, axisX, axisY);
      const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
      if (overlap <= EPS) return false;
    }
  }
  return true;
}

function resolvedRowLeftMm(
  placement: FacePlacement,
  array: ArraySpec,
  panelWidthMm: number,
  gapMm: number,
  rowCount: number,
) {
  const fullFieldWidth = rowWidthMm(panelWidthMm, gapMm, placement.columns);
  const rowWidth = rowWidthMm(panelWidthMm, gapMm, rowCount);
  const fallbackFieldLeft = Math.max(0, (placement.widthMm - fullFieldWidth) / 2);
  const fieldLeft = placement.resolvedLeftMm ?? fallbackFieldLeft;
  const spare = Math.max(0, fullFieldWidth - rowWidth);
  if (array.placement === "left") return fieldLeft;
  if (array.placement === "right") return fieldLeft + spare;
  return fieldLeft + spare / 2;
}

/**
 * Materialize the current deterministic FacePlacement into exact roof-plane
 * module rectangles. This function does not move modules around obstacles.
 */
export function materializePhysicalModules(args: {
  placement: FacePlacement;
  panel: PanelSpec;
  array: ArraySpec;
  startIndex?: number;
}): PhysicalModulePlacement[] {
  const { placement, panel, array } = args;
  const { widthMm: panelWidth, heightMm: panelHeight } = orientedPanel(panel, array.orientation);
  const gap = Math.max(0, array.interPanelGapMm ?? 20);
  const modules: PhysicalModulePlacement[] = [];
  let emitted = 0;

  for (let row = 0; row < placement.rows && emitted < placement.panelCount; row++) {
    const rowCount =
      row === placement.rows - 1
        ? placement.lastRowCount
        : Math.min(placement.columns, placement.panelCount - emitted);
    const left = resolvedRowLeftMm(placement, array, panelWidth, gap, rowCount);

    for (let column = 0; column < rowCount && emitted < placement.panelCount; column++) {
      const x0 = left + column * (panelWidth + gap);
      const y0 = placement.resolvedGutterMm + row * (panelHeight + gap);
      const x1 = x0 + panelWidth;
      const y1 = y0 + panelHeight;
      modules.push({
        index: (args.startIndex ?? 0) + emitted,
        faceId: placement.faceId,
        row,
        column,
        polygonMm: [
          { xMm: x0, yMm: y0 },
          { xMm: x1, yMm: y0 },
          { xMm: x1, yMm: y1 },
          { xMm: x0, yMm: y1 },
        ],
      });
      emitted++;
    }
  }
  return modules;
}

/**
 * Strict V1 physical layout audit. Complex/concave supports are intentionally
 * rejected for the Monday V1 instead of being guessed; they belong to V2.
 */
export function auditPhysicalModules(args: {
  face: RoofFaceMetricGeometry;
  placement: FacePlacement;
  panel: PanelSpec;
  array: ArraySpec;
  startIndex?: number;
}): PhysicalLayoutAudit {
  const { face, placement, panel, array } = args;
  const errors: string[] = [];
  const support = face.surfacePolygonMm;
  const modules = materializePhysicalModules({ placement, panel, array, startIndex: args.startIndex });

  if (!support || support.length < 3 || !support.every(finitePoint)) {
    errors.push(`Surface ${face.id} has no valid metric support polygon.`);
    return { passed: false, modules, errors };
  }
  if (!isConvexMetricPolygon(support)) {
    errors.push(`Surface ${face.id} is not a convex V1 support polygon.`);
    return { passed: false, modules, errors };
  }
  if (modules.length !== placement.panelCount) {
    errors.push(
      `Surface ${face.id} materialized ${modules.length} modules but ${placement.panelCount} were requested for this face.`,
    );
  }

  for (const placedModule of modules) {
    if (!placedModule.polygonMm.every((point) => pointInMetricPolygon(point, support))) {
      errors.push(`Module ${placedModule.index} leaves the metric boundary of surface ${face.id}.`);
    }
    for (const obstacle of face.obstaclePolygonsMm ?? []) {
      if (metricPolygonsOverlapOrTouch(placedModule.polygonMm, obstacle.polygonMm)) {
        errors.push(
          `Module ${placedModule.index} collides with obstacle ${obstacle.type} on surface ${face.id}: ${obstacle.description}.`,
        );
      }
    }
  }

  for (let i = 0; i < modules.length; i++) {
    for (let j = i + 1; j < modules.length; j++) {
      const a = modules[i]!;
      const b = modules[j]!;
      if (metricConvexPolygonsOverlapArea(a.polygonMm, b.polygonMm)) {
        errors.push(`Modules ${a.index} and ${b.index} overlap on surface ${face.id}.`);
      }
    }
  }

  return { passed: errors.length === 0, modules, errors: [...new Set(errors)] };
}
