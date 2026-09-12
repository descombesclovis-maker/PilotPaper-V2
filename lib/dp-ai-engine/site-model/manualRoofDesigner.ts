import type { MetricFrame } from "../context/officialParcel";
import type { MetricPoint2D, Point2D, RoofFaceMetricGeometry, RoofViewObservation } from "../types";

export type ManualRoofQuad = [Point2D, Point2D, Point2D, Point2D];

export type ManualRoofKeepout = {
  id: string;
  type?: string;
  polygonNormalized: Point2D[];
};

export type ManualRoofDesign = {
  quadNormalized: ManualRoofQuad;
  slopeDeg: number;
  keepouts?: ManualRoofKeepout[];
};

type GroundPointM = { x: number; y: number };

function finitePoint(point: Point2D) {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function polygonArea(points: Point2D[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function normalizedToGround(point: Point2D, frame: MetricFrame): GroundPointM {
  return {
    x: point.x * frame.widthMeters,
    y: (1 - point.y) * frame.heightMeters,
  };
}

function midpoint(a: GroundPointM, b: GroundPointM): GroundPointM {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function length(a: GroundPointM, b: GroundPointM) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function normalize(vector: GroundPointM) {
  const norm = Math.hypot(vector.x, vector.y);
  if (norm < 1e-9) throw new Error("Roof Designer : l'arête de gouttière est trop courte.");
  return { x: vector.x / norm, y: vector.y / norm };
}

export function validateManualRoofDesign(design: ManualRoofDesign) {
  const issues: string[] = [];
  if (!Array.isArray(design.quadNormalized) || design.quadNormalized.length !== 4) {
    issues.push("exactement 4 coins du pan sont requis");
    return issues;
  }
  if (!design.quadNormalized.every(finitePoint)) issues.push("les coins du pan doivent rester dans l'orthophoto");
  if (polygonArea(design.quadNormalized) < 0.00008) issues.push("le pan tracé est trop petit ou dégénéré");
  if (!Number.isFinite(design.slopeDeg) || design.slopeDeg < 0 || design.slopeDeg > 75) issues.push("la pente doit être comprise entre 0° et 75°");
  for (const keepout of design.keepouts ?? []) {
    if (!Array.isArray(keepout.polygonNormalized) || keepout.polygonNormalized.length < 3) {
      issues.push(`l'obstacle ${keepout.id} n'a pas de polygone exploitable`);
      continue;
    }
    if (!keepout.polygonNormalized.every(finitePoint)) issues.push(`l'obstacle ${keepout.id} sort de l'orthophoto`);
    if (polygonArea(keepout.polygonNormalized) < 0.000002) issues.push(`l'obstacle ${keepout.id} est trop petit ou dégénéré`);
  }
  return issues;
}

export function metricSurfaceFromManualRoofDesign(args: {
  frame: MetricFrame;
  design: ManualRoofDesign;
  faceId: string;
  label?: string;
}) {
  const issues = validateManualRoofDesign(args.design);
  if (issues.length) throw new Error(`Roof Designer : ${issues.join(" ; ")}.`);

  const [gutterLeftN, gutterRightN, ridgeRightN, ridgeLeftN] = args.design.quadNormalized;
  const gutterLeft = normalizedToGround(gutterLeftN, args.frame);
  const gutterRight = normalizedToGround(gutterRightN, args.frame);
  const ridgeRight = normalizedToGround(ridgeRightN, args.frame);
  const ridgeLeft = normalizedToGround(ridgeLeftN, args.frame);

  const along = normalize({ x: gutterRight.x - gutterLeft.x, y: gutterRight.y - gutterLeft.y });
  const gutterMid = midpoint(gutterLeft, gutterRight);
  const ridgeMid = midpoint(ridgeLeft, ridgeRight);
  let up = { x: -along.y, y: along.x };
  const toRidge = { x: ridgeMid.x - gutterMid.x, y: ridgeMid.y - gutterMid.y };
  if (toRidge.x * up.x + toRidge.y * up.y < 0) up = { x: -up.x, y: -up.y };

  const cosSlope = Math.cos(args.design.slopeDeg * Math.PI / 180);
  if (cosSlope < 0.25) throw new Error("Roof Designer : pente trop forte pour la projection V1.");

  const toMetric = (point: Point2D): MetricPoint2D => {
    const ground = normalizedToGround(point, args.frame);
    const dx = ground.x - gutterLeft.x;
    const dy = ground.y - gutterLeft.y;
    return {
      xMm: (dx * along.x + dy * along.y) * 1000,
      yMm: ((dx * up.x + dy * up.y) / cosSlope) * 1000,
    };
  };

  const rawSurface = args.design.quadNormalized.map(toMetric);
  const minX = Math.min(...rawSurface.map((point) => point.xMm));
  const minY = Math.min(...rawSurface.map((point) => point.yMm));
  const translate = (point: MetricPoint2D): MetricPoint2D => ({ xMm: point.xMm - minX, yMm: point.yMm - minY });
  const surfacePolygonMm = rawSurface.map(translate);

  const keepouts = (args.design.keepouts ?? []).map((keepout) => ({
    type: keepout.type ?? "manual_keepout",
    description: `Keepout validé par l'utilisateur · ${keepout.id}`,
    polygonMm: keepout.polygonNormalized.map(toMetric).map(translate),
  }));

  const metricGeometry: RoofFaceMetricGeometry = {
    id: args.faceId,
    label: args.label ?? `Pan ${args.faceId}`,
    widthMm: Math.round(Math.max(...surfacePolygonMm.map((point) => point.xMm)) - Math.min(...surfacePolygonMm.map((point) => point.xMm))),
    slopeLengthMm: Math.round(Math.max(...surfacePolygonMm.map((point) => point.yMm)) - Math.min(...surfacePolygonMm.map((point) => point.yMm))),
    slopeDeg: args.design.slopeDeg,
    surfacePolygonMm,
    obstaclePolygonsMm: keepouts,
    source: "calibration",
  };

  const view: RoofViewObservation = {
    role: "satellite_mass",
    faceId: args.faceId,
    selectedFaceVisible: true,
    confidence: 1,
    roofPolygonNormalized: args.design.quadNormalized,
    gutterLineNormalized: [gutterLeftN, gutterRightN],
    ridgeLineNormalized: [ridgeLeftN, ridgeRightN],
    perspectiveNotes: [
      "Pan tracé et validé par l'utilisateur sur orthophoto IGN métrée.",
      `Pente déclarée : ${args.design.slopeDeg.toFixed(1)}°; dimensions planimétriques dérivées du repère IGN.`,
    ],
  };

  const obstacles = (args.design.keepouts ?? []).map((keepout) => ({
    type: keepout.type ?? "manual_keepout",
    description: `Keepout validé par l'utilisateur · ${keepout.id}`,
    polygonNormalized: keepout.polygonNormalized,
    viewRole: "satellite_mass" as const,
  }));

  return {
    metricGeometry,
    view,
    obstacles,
    widthGroundM: length(gutterLeft, gutterRight),
    slopeDeg: args.design.slopeDeg,
  };
}
