import { projectivePointInQuad } from "./panelProjection";
import type { CrossViewSurfaceIdentity } from "../identity/crossViewSurfaceIdentity";
import type { InputPhoto, MetricPoint2D, Point2D, RoofFaceMetricGeometry } from "../types";

function finitePoint(point: Point2D) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
function normalizedPoint(point: Point2D) {
  return finitePoint(point) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}
function polygonArea(poly: Point2D[]) {
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    area += poly[j]!.x * poly[i]!.y - poly[i]!.x * poly[j]!.y;
  }
  return Math.abs(area) / 2;
}

function pointOnSegment(point: Point2D, a: Point2D, b: Point2D, epsilon = 1e-9) {
  const cross = (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y);
  if (Math.abs(cross) > epsilon) return false;
  const dot = (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y);
  if (dot < -epsilon) return false;
  const lengthSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot <= lengthSq + epsilon;
}

function pointInPolygonInclusive(point: Point2D, polygon: Point2D[]) {
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (pointOnSegment(point, polygon[j]!, polygon[i]!)) return true;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-12) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function orientation(a: Point2D, b: Point2D, c: Point2D) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D) {
  const epsilon = 1e-9;
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);
  if (((o1 > epsilon && o2 < -epsilon) || (o1 < -epsilon && o2 > epsilon))
    && ((o3 > epsilon && o4 < -epsilon) || (o3 < -epsilon && o4 > epsilon))) return true;
  if (Math.abs(o1) <= epsilon && pointOnSegment(b1, a1, a2)) return true;
  if (Math.abs(o2) <= epsilon && pointOnSegment(b2, a1, a2)) return true;
  if (Math.abs(o3) <= epsilon && pointOnSegment(a1, b1, b2)) return true;
  if (Math.abs(o4) <= epsilon && pointOnSegment(a2, b1, b2)) return true;
  return false;
}

/**
 * Deterministically decides whether two polygons touch or overlap. This is used
 * to keep contextual obstacles on neighbouring roofs out of the selected
 * SurfaceSupport without relying on an AI-written description.
 */
export function polygonsOverlapOrTouch(a: Point2D[], b: Point2D[]) {
  if (a.length < 3 || b.length < 3) return false;
  if (a.some((point) => pointInPolygonInclusive(point, b))) return true;
  if (b.some((point) => pointInPolygonInclusive(point, a))) return true;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]!;
    const a2 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j]!;
      const b2 = b[(j + 1) % b.length]!;
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function projectiveCoefficients(q: [Point2D, Point2D, Point2D, Point2D]) {
  const [bl, br, tr, tl] = q;
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
    if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) return undefined;
    g = (dx3 * dy2 - dx2 * dy3) / denominator;
    h = (dx1 * dy3 - dx3 * dy1) / denominator;
  }
  return {
    a: br.x - bl.x + g * br.x,
    b: tl.x - bl.x + h * tl.x,
    c: bl.x,
    d: br.y - bl.y + g * br.y,
    e: tl.y - bl.y + h * tl.y,
    f: bl.y,
    g,
    h,
  };
}

function projectiveCoordinatesInQuad(q: [Point2D, Point2D, Point2D, Point2D], point: Point2D) {
  const coeff = projectiveCoefficients(q);
  if (!coeff) return undefined;
  const { a, b, c, d, e, f, g, h } = coeff;
  const a1 = a - point.x * g;
  const b1 = b - point.x * h;
  const c1 = point.x - c;
  const a2 = d - point.y * g;
  const b2 = e - point.y * h;
  const c2 = point.y - f;
  const det = a1 * b2 - a2 * b1;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return undefined;
  const u = (c1 * b2 - c2 * b1) / det;
  const v = (a1 * c2 - a2 * c1) / det;
  return Number.isFinite(u) && Number.isFinite(v) ? { u, v } : undefined;
}

export function reprojectPolygonBetweenQuads(
  sourceQuad: [Point2D, Point2D, Point2D, Point2D],
  targetQuad: [Point2D, Point2D, Point2D, Point2D],
  polygon: Point2D[],
) {
  const mapped: Point2D[] = [];
  for (const point of polygon) {
    if (!normalizedPoint(point)) return undefined;
    const uv = projectiveCoordinatesInQuad(sourceQuad, point);
    if (!uv || uv.u < -0.08 || uv.u > 1.08 || uv.v < -0.08 || uv.v > 1.08) return undefined;
    mapped.push(projectivePointInQuad(targetQuad, uv.u, uv.v));
  }
  return mapped.length >= 3 && polygonArea(mapped) > 1e-8 ? mapped : undefined;
}

function metricBasis(
  quad: [Point2D, Point2D, Point2D, Point2D],
  widthPx: number,
  heightPx: number,
  metersPerPixel: number,
  slopeDeg: number,
) {
  const toPixels = (point: Point2D) => ({ x: point.x * widthPx, y: point.y * heightPx });
  const [bl, br, tr, tl] = quad.map(toPixels) as [Point2D, Point2D, Point2D, Point2D];
  const dx = br.x - bl.x;
  const dy = br.y - bl.y;
  const eaveLength = Math.hypot(dx, dy);
  if (eaveLength < 1e-6) throw new Error("Surface métrique : rive basse dégénérée.");
  const ex = dx / eaveLength;
  const ey = dy / eaveLength;
  let nx = -ey;
  let ny = ex;
  const lowerMid = { x: (bl.x + br.x) / 2, y: (bl.y + br.y) / 2 };
  const upperMid = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
  if ((upperMid.x - lowerMid.x) * nx + (upperMid.y - lowerMid.y) * ny < 0) {
    nx *= -1;
    ny *= -1;
  }
  const mmPerPixel = metersPerPixel * 1000;
  const cosSlope = Math.max(0.26, Math.cos((slopeDeg * Math.PI) / 180));
  return {
    toMetric(point: Point2D): MetricPoint2D {
      const p = toPixels(point);
      const vx = p.x - bl.x;
      const vy = p.y - bl.y;
      return {
        xMm: (vx * ex + vy * ey) * mmPerPixel,
        yMm: ((vx * nx + vy * ny) * mmPerPixel) / cosSlope,
      };
    },
  };
}

/**
 * Converts a proven cross-view identity into one deterministic metric support.
 * This is the hand-off from Roof/Surface Understanding to the Layout Engine.
 */
export function metricSurfaceFromIdentity(args: {
  identity: CrossViewSurfaceIdentity;
  metricImage: InputPhoto;
  faceId: string;
  label?: string;
  slopeOverrideDeg?: number;
}): RoofFaceMetricGeometry {
  const { identity, metricImage } = args;
  const quad = identity.metricPlane.polygonNormalized;
  const mpp = metricImage.metersPerPixel;
  const widthPx = metricImage.widthPx;
  const heightPx = metricImage.heightPx;
  if (!mpp || !widthPx || !heightPx) throw new Error("Surface métrique : échelle ou dimensions raster absentes.");
  const px = (a: Point2D, b: Point2D) => Math.hypot((b.x - a.x) * widthPx, (b.y - a.y) * heightPx);
  const [bl, br, tr, tl] = quad;
  const eaveGround = Math.min(px(bl, br), px(tl, tr)) * mpp;
  const runGround = ((px(bl, tl) + px(br, tr)) / 2) * mpp;
  const slopeDeg = args.slopeOverrideDeg ?? identity.slopeDeg;
  const slopeLength = runGround / Math.max(0.26, Math.cos((slopeDeg * Math.PI) / 180));
  if (!(eaveGround > 0.4) || !(slopeLength > 0.4)) throw new Error("Surface métrique : dimensions physiques non fiables.");

  const basis = metricBasis(quad, widthPx, heightPx, mpp, slopeDeg);
  const obstaclePolygonsMm = identity.obstacles.flatMap((obstacle) => {
    const roofPolygon = obstacle.roofPolygonNormalized ?? undefined;
    const metricPolygonDirect = obstacle.metricPolygonNormalized ?? undefined;

    // Contextual obstacles on neighbouring roofs/buildings must never block the
    // selected support. Classification is purely geometric, not text based.
    if (roofPolygon?.length >= 3
      && roofPolygon.every(normalizedPoint)
      && !polygonsOverlapOrTouch(roofPolygon, identity.roofPlane.polygonNormalized)) {
      return [];
    }
    if (metricPolygonDirect?.length >= 3
      && metricPolygonDirect.every(normalizedPoint)
      && !polygonsOverlapOrTouch(metricPolygonDirect, identity.metricPlane.polygonNormalized)) {
      return [];
    }

    let metricPolygon = metricPolygonDirect;
    if (!metricPolygon?.length && roofPolygon?.length) {
      metricPolygon = reprojectPolygonBetweenQuads(
        identity.roofPlane.polygonNormalized,
        identity.metricPlane.polygonNormalized,
        roofPolygon,
      );
    }
    if (!metricPolygon?.length || metricPolygon.length < 3 || !metricPolygon.every(normalizedPoint)) {
      throw new Error(`Surface métrique : l'obstacle « ${obstacle.description} » touche potentiellement le pan sélectionné mais son emprise métrique ne peut pas être démontrée.`);
    }
    if (!polygonsOverlapOrTouch(metricPolygon, identity.metricPlane.polygonNormalized)) {
      return [];
    }
    return [{
      type: obstacle.type,
      description: obstacle.description,
      polygonMm: metricPolygon.map(basis.toMetric),
    }];
  });

  return {
    id: args.faceId,
    label: args.label ?? args.faceId,
    widthMm: Math.floor(eaveGround * 1000),
    slopeLengthMm: Math.floor(slopeLength * 1000),
    slopeDeg,
    surfacePolygonMm: quad.map(basis.toMetric),
    obstaclePolygonsMm,
    source: "ign-derived",
  };
}
