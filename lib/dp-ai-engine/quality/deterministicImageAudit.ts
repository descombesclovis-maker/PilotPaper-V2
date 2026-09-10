import type { Point2D } from "../types";
import { decodePng } from "../utils/pngPixels";

export type DeterministicImageAudit = {
  passed: boolean;
  panelCountExpected: number;
  panelCountProjected: number;
  exactPanelCount: boolean;
  allCoordinatesFinite: boolean;
  allPanelsInsideImage: boolean;
  allPanelsNonDegenerate: boolean;
  overlapPairs: number;
  exactOutsideMaskPreservation: boolean;
  changedOutsidePixels: number;
  outsidePixelsChecked: number;
  editablePixels: number;
  editableRatio: number;
  maxOutsideChannelDelta: number;
  panelIslandPixels: number[];
  panelIslandChangedPixels: number[];
  panelIslandsWithChanges: number;
  allPanelIslandsRendered: boolean;
  sourceWidthPx: number;
  sourceHeightPx: number;
  outputWidthPx: number;
  outputHeightPx: number;
};

function polygonArea(poly: Point2D[]) {
  let value = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    value += poly[j]!.x * poly[i]!.y - poly[i]!.x * poly[j]!.y;
  }
  return Math.abs(value) / 2;
}

function pointInside(point: Point2D, polygon: Point2D[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-12) + a.x
    ) inside = !inside;
  }
  return inside;
}

function orientation(a: Point2D, b: Point2D, c: Point2D) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a: Point2D, b: Point2D, c: Point2D, d: Point2D) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  const epsilon = 1e-10;
  return (
    ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) &&
    ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))
  );
}

function polygonsOverlap(a: Point2D[], b: Point2D[]) {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!;
    const a1 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j]!;
      const b1 = b[(j + 1) % b.length]!;
      if (segmentsCross(a0, a1, b0, b1)) return true;
    }
  }
  return pointInside(a[0]!, b) || pointInside(b[0]!, a);
}

function expand(polygons: Point2D[][], paddingNormalized: number) {
  return polygons.map((polygon) => {
    const cx = polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length;
    const cy = polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length;
    return polygon.map((point) => ({
      x: Math.max(0, Math.min(1, point.x + Math.sign(point.x - cx) * paddingNormalized)),
      y: Math.max(0, Math.min(1, point.y + Math.sign(point.y - cy) * paddingNormalized)),
    }));
  });
}

function pixelChanged(source: Uint8Array, output: Uint8Array, index: number) {
  for (let channel = 0; channel < 4; channel++) {
    if (source[index + channel] !== output[index + channel]) return true;
  }
  return false;
}

function auditPanelIslandPixels(args: {
  source: ReturnType<typeof decodePng>;
  output: ReturnType<typeof decodePng>;
  polygons: Point2D[][];
}) {
  const { source, output, polygons } = args;
  const panelIslandPixels = Array.from({ length: polygons.length }, () => 0);
  const panelIslandChangedPixels = Array.from({ length: polygons.length }, () => 0);
  if (source.width !== output.width || source.height !== output.height) {
    return { panelIslandPixels, panelIslandChangedPixels };
  }

  polygons.forEach((polygon, polygonIndex) => {
    if (!polygon.length) return;
    const minX = Math.max(0, Math.min(...polygon.map((point) => point.x)));
    const maxX = Math.min(1, Math.max(...polygon.map((point) => point.x)));
    const minY = Math.max(0, Math.min(...polygon.map((point) => point.y)));
    const maxY = Math.min(1, Math.max(...polygon.map((point) => point.y)));
    const x0 = Math.max(0, Math.floor(minX * source.width) - 1);
    const x1 = Math.min(source.width - 1, Math.ceil(maxX * source.width) + 1);
    const y0 = Math.max(0, Math.floor(minY * source.height) - 1);
    const y1 = Math.min(source.height - 1, Math.ceil(maxY * source.height) + 1);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const point = { x: (x + 0.5) / source.width, y: (y + 0.5) / source.height };
        if (!pointInside(point, polygon)) continue;
        panelIslandPixels[polygonIndex]!++;
        const index = (y * source.width + x) * 4;
        if (pixelChanged(source.rgba, output.rgba, index)) panelIslandChangedPixels[polygonIndex]!++;
      }
    }
  });

  return { panelIslandPixels, panelIslandChangedPixels };
}

export function auditDeterministicImage(params: {
  sourceBase64: string;
  outputBase64: string;
  panelPolygons: Point2D[][];
  expectedPanelCount: number;
  editablePaddingNormalized?: number;
}): DeterministicImageAudit {
  const source = decodePng(params.sourceBase64);
  const output = decodePng(params.outputBase64);
  const polygons = params.panelPolygons;
  const padding = params.editablePaddingNormalized ?? 0.002;

  const allCoordinatesFinite = polygons.every((polygon) =>
    polygon.length >= 3 && polygon.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
  );
  const allPanelsInsideImage = polygons.every((polygon) =>
    polygon.every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1),
  );
  const allPanelsNonDegenerate = polygons.every((polygon) => polygonArea(polygon) > 1e-8);

  let overlapPairs = 0;
  for (let i = 0; i < polygons.length; i++) {
    for (let j = i + 1; j < polygons.length; j++) {
      if (polygonsOverlap(polygons[i]!, polygons[j]!)) overlapPairs++;
    }
  }

  const sameSize = source.width === output.width && source.height === output.height;
  const allowed = expand(polygons, padding);
  let outsidePixelsChecked = 0;
  let editablePixels = 0;
  let changedOutsidePixels = 0;
  let maxOutsideChannelDelta = 0;

  if (sameSize) {
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const nx = (x + 0.5) / source.width;
        const ny = (y + 0.5) / source.height;
        const isEditable = allowed.some((polygon) => pointInside({ x: nx, y: ny }, polygon));
        if (isEditable) {
          editablePixels++;
          continue;
        }
        outsidePixelsChecked++;
        const index = (y * source.width + x) * 4;
        let changed = false;
        for (let channel = 0; channel < 4; channel++) {
          const delta = Math.abs(source.rgba[index + channel]! - output.rgba[index + channel]!);
          if (delta > 0) changed = true;
          maxOutsideChannelDelta = Math.max(maxOutsideChannelDelta, delta);
        }
        if (changed) changedOutsidePixels++;
      }
    }
  } else {
    changedOutsidePixels = -1;
    maxOutsideChannelDelta = 255;
  }

  const { panelIslandPixels, panelIslandChangedPixels } = auditPanelIslandPixels({ source, output, polygons });
  const panelIslandsWithChanges = panelIslandChangedPixels.filter((count, index) =>
    panelIslandPixels[index]! > 0 && count > 0,
  ).length;
  const allPanelIslandsRendered =
    sameSize &&
    polygons.length > 0 &&
    panelIslandsWithChanges === polygons.length;

  const exactPanelCount = polygons.length === params.expectedPanelCount;
  const exactOutsideMaskPreservation = sameSize && changedOutsidePixels === 0;
  const editableRatio = source.width * source.height > 0
    ? editablePixels / (source.width * source.height)
    : 0;
  const passed =
    exactPanelCount &&
    allCoordinatesFinite &&
    allPanelsInsideImage &&
    allPanelsNonDegenerate &&
    overlapPairs === 0 &&
    exactOutsideMaskPreservation;

  return {
    passed,
    panelCountExpected: params.expectedPanelCount,
    panelCountProjected: polygons.length,
    exactPanelCount,
    allCoordinatesFinite,
    allPanelsInsideImage,
    allPanelsNonDegenerate,
    overlapPairs,
    exactOutsideMaskPreservation,
    changedOutsidePixels,
    outsidePixelsChecked,
    editablePixels,
    editableRatio,
    maxOutsideChannelDelta,
    panelIslandPixels,
    panelIslandChangedPixels,
    panelIslandsWithChanges,
    allPanelIslandsRendered,
    sourceWidthPx: source.width,
    sourceHeightPx: source.height,
    outputWidthPx: output.width,
    outputHeightPx: output.height,
  };
}
