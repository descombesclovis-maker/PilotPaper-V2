import { decodePng, encodePng } from "@/lib/dp-ai-engine/utils/pngPixels";

type Point = { x: number; y: number };

type PixelPoint = { x: number; y: number };

function pointInPolygon(x: number, y: number, polygon: PixelPoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (((a.y > y) !== (b.y > y)) && x < ((b.x - a.x) * (y - a.y)) / ((b.y - a.y) || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

function pointSegmentDistance(x: number, y: number, a: PixelPoint, b: PixelPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  if (denominator <= 1e-12) return Math.hypot(x - a.x, y - a.y);
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / denominator));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

function polygonArea(polygon: PixelPoint[]) {
  let twiceArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twiceArea) / 2;
}

/**
 * Planning-plan renderer: the aerial photograph remains untouched outside the
 * exact module polygons. Each physical module receives its own visible border,
 * so the requested module count remains readable even when real module gaps are
 * sub-pixel at cadastral scale.
 */
export function overlayPlanningPanelsPng(base64: string, polygons: Point[][]) {
  const image = decodePng(base64);
  if (image.width < 320 || image.height < 240) {
    throw new Error(`DP2 : fond cartographique trop petit (${image.width}×${image.height}).`);
  }
  const out = new Uint8Array(image.rgba);
  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex += 1) {
    const polygon = polygons[polygonIndex]!;
    if (polygon.length !== 4) throw new Error("Le plan de masse exige quatre coins projetés par module.");
    if (polygon.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      throw new Error(`DP2 : coordonnées non finies pour le module ${polygonIndex + 1}.`);
    }
    const px = polygon.map((point) => ({ x: point.x * image.width, y: point.y * image.height }));
    const areaPx = polygonArea(px);
    if (areaPx < 8) {
      throw new Error(`DP2 : module ${polygonIndex + 1} trop petit pour être lisible sur le plan (${areaPx.toFixed(1)} px²).`);
    }
    const minX = Math.max(0, Math.floor(Math.min(...px.map((point) => point.x)) - 2));
    const maxX = Math.min(image.width - 1, Math.ceil(Math.max(...px.map((point) => point.x)) + 2));
    const minY = Math.max(0, Math.floor(Math.min(...px.map((point) => point.y)) - 2));
    const maxY = Math.min(image.height - 1, Math.ceil(Math.max(...px.map((point) => point.y)) + 2));
    let paintedPixels = 0;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const cx = x + 0.5;
        const cy = y + 0.5;
        if (!pointInPolygon(cx, cy, px)) continue;
        paintedPixels += 1;
        let edgeDistance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < px.length; index += 1) {
          edgeDistance = Math.min(edgeDistance, pointSegmentDistance(cx, cy, px[index]!, px[(index + 1) % px.length]!));
        }
        const offset = (y * image.width + x) * 4;
        if (edgeDistance <= 1.25) {
          out[offset] = 238;
          out[offset + 1] = 246;
          out[offset + 2] = 250;
          out[offset + 3] = 255;
        } else {
          out[offset] = Math.round(out[offset]! * 0.16 + 14 * 0.84);
          out[offset + 1] = Math.round(out[offset + 1]! * 0.16 + 63 * 0.84);
          out[offset + 2] = Math.round(out[offset + 2]! * 0.16 + 96 * 0.84);
          out[offset + 3] = 255;
        }
      }
    }
    if (paintedPixels < 4) {
      throw new Error(`DP2 : le module ${polygonIndex + 1} n'a produit aucun tracé lisible sur le plan.`);
    }
  }
  return encodePng(image.width, image.height, out);
}
