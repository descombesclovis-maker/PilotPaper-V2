import { assertValidProjectiveQuad } from "../geometry/panelProjection";
import { openaiJson } from "../providers/openaiJson";
import type { InputPhoto, Point2D } from "../types";
import { toDataUrl } from "../utils/dataUrl";

export type PlaneEvidence = {
  polygonNormalized: [Point2D, Point2D, Point2D, Point2D];
  gutterLineNormalized: [Point2D, Point2D];
  ridgeLineNormalized: [Point2D, Point2D];
};

export type CrossViewObstacle = {
  type: string;
  description: string;
  roofPolygonNormalized: Point2D[] | null;
  metricPolygonNormalized: Point2D[] | null;
};

export type CrossViewSurfaceIdentity = {
  sameBuilding: boolean;
  sameRoofPlane: boolean;
  confidence: number;
  slopeDeg: number;
  slopeConfidence: number;
  metricPlane: PlaneEvidence;
  roofPlane: PlaneEvidence;
  evidence: {
    parcelPositionConsistent: boolean;
    roofShapeConsistent: boolean;
    ridgeEaveAxisConsistent: boolean;
    obstaclePatternConsistent: boolean;
    annexContextConsistent: boolean;
  };
  obstacles: CrossViewObstacle[];
  notes: string[];
};

export type CrossViewIdentityThresholds = {
  identity: number;
  slope: number;
  minimumIndependentVisualCues: number;
};

const DEFAULT_THRESHOLDS: CrossViewIdentityThresholds = {
  identity: 0.8,
  slope: 0.65,
  minimumIndependentVisualCues: 2,
};

const pointSchema = {
  type: "object",
  additionalProperties: false,
  properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"],
} as const;
const quadSchema = { type: "array", minItems: 4, maxItems: 4, items: pointSchema } as const;
const lineSchema = { type: "array", minItems: 2, maxItems: 2, items: pointSchema } as const;
const identitySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sameBuilding: { type: "boolean" },
    sameRoofPlane: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    slopeDeg: { type: "number", minimum: 0, maximum: 75 },
    slopeConfidence: { type: "number", minimum: 0, maximum: 1 },
    metricPlane: {
      type: "object",
      additionalProperties: false,
      properties: { polygonNormalized: quadSchema, gutterLineNormalized: lineSchema, ridgeLineNormalized: lineSchema },
      required: ["polygonNormalized", "gutterLineNormalized", "ridgeLineNormalized"],
    },
    roofPlane: {
      type: "object",
      additionalProperties: false,
      properties: { polygonNormalized: quadSchema, gutterLineNormalized: lineSchema, ridgeLineNormalized: lineSchema },
      required: ["polygonNormalized", "gutterLineNormalized", "ridgeLineNormalized"],
    },
    evidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        parcelPositionConsistent: { type: "boolean" },
        roofShapeConsistent: { type: "boolean" },
        ridgeEaveAxisConsistent: { type: "boolean" },
        obstaclePatternConsistent: { type: "boolean" },
        annexContextConsistent: { type: "boolean" },
      },
      required: ["parcelPositionConsistent", "roofShapeConsistent", "ridgeEaveAxisConsistent", "obstaclePatternConsistent", "annexContextConsistent"],
    },
    obstacles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string" },
          description: { type: "string" },
          roofPolygonNormalized: { type: ["array", "null"], minItems: 3, items: pointSchema },
          metricPolygonNormalized: { type: ["array", "null"], minItems: 3, items: pointSchema },
        },
        required: ["type", "description", "roofPolygonNormalized", "metricPolygonNormalized"],
      },
    },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["sameBuilding", "sameRoofPlane", "confidence", "slopeDeg", "slopeConfidence", "metricPlane", "roofPlane", "evidence", "obstacles", "notes"],
} as const;

function finitePoint(point: Point2D) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
function normalizedPoint(point: Point2D) {
  return finitePoint(point) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}
function polygonCentroid(poly: Point2D[]) {
  return {
    x: poly.reduce((sum, point) => sum + point.x, 0) / poly.length,
    y: poly.reduce((sum, point) => sum + point.y, 0) / poly.length,
  };
}
function pointInPolygon(point: Point2D, polygon: Point2D[]) {
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

export function validateCrossViewSurfaceIdentity(
  identity: CrossViewSurfaceIdentity,
  parcelPolygonNormalized: Point2D[],
  thresholds: CrossViewIdentityThresholds = DEFAULT_THRESHOLDS,
) {
  const issues: string[] = [];
  if (!identity.sameBuilding) issues.push("Le même bâtiment n'est pas démontré entre la vue métrique et la photo réelle.");
  if (!identity.sameRoofPlane) issues.push("Le même pan physique n'est pas démontré entre les deux vues.");
  if (identity.confidence < thresholds.identity) {
    issues.push(`Confiance d'identité ${identity.confidence.toFixed(2)} < ${thresholds.identity.toFixed(2)}.`);
  }
  if (identity.slopeConfidence < thresholds.slope) {
    issues.push(`Confiance de pente ${identity.slopeConfidence.toFixed(2)} < ${thresholds.slope.toFixed(2)}.`);
  }
  const evidence = identity.evidence;
  const independentCues = [
    evidence.roofShapeConsistent,
    evidence.ridgeEaveAxisConsistent,
    evidence.obstaclePatternConsistent,
    evidence.annexContextConsistent,
  ].filter(Boolean).length;
  if (!evidence.parcelPositionConsistent) issues.push("La position du toit n'est pas cohérente avec la parcelle officielle.");
  if (independentCues < thresholds.minimumIndependentVisualCues) {
    issues.push(`Moins de ${thresholds.minimumIndependentVisualCues} indices visuels indépendants confirment l'identité du pan.`);
  }
  for (const [label, quad] of [
    ["métrique", identity.metricPlane.polygonNormalized],
    ["photo", identity.roofPlane.polygonNormalized],
  ] as const) {
    if (!quad.every(normalizedPoint)) {
      issues.push(`Le quadrilatère ${label} contient des coordonnées invalides.`);
      continue;
    }
    try {
      assertValidProjectiveQuad(quad);
    } catch (error) {
      issues.push(`Quadrilatère ${label} invalide : ${error instanceof Error ? error.message : "géométrie incorrecte"}`);
    }
  }
  const metricCentroid = polygonCentroid(identity.metricPlane.polygonNormalized);
  if (!pointInPolygon(metricCentroid, parcelPolygonNormalized)) {
    issues.push("Le centre du pan identifié est hors de la parcelle cadastrale cible.");
  }
  return issues;
}

function identityPrompt(args: {
  parcelReference: string;
  parcelPolygonNormalized: Point2D[];
  faceLabel: string;
  previousIssues: string[];
  contextNotes?: string;
}) {
  return `You are PilotPaper's Cross-View Surface Identity Engine.

Your ONLY job is to prove which physical roof/support plane in IMAGE 1 is the SAME physical plane shown in IMAGE 2. Do not perform photovoltaic layout and do not invent geometry.

IMAGE 1 is an authoritative metric orthographic view centered on the official cadastral parcel.
IMAGE 2 is a real oblique photograph of the project support.

Official target parcel reference: ${args.parcelReference}
Target parcel polygon in IMAGE 1 normalized coordinates: ${JSON.stringify(args.parcelPolygonNormalized)}
Downstream stable face label: ${args.faceLabel}
${args.contextNotes ? `Context: ${args.contextNotes}\n` : ""}
Identity procedure:
1. Restrict the search to buildings/supports lying inside or materially intersecting the official parcel polygon.
2. Compare roof/support outline, ridge/eave axis, obstacle placement, annex relationships and relative proportions.
3. Return ONE plane pair representing the SAME physical plane in both images.
4. Both polygons MUST be ordered bottom-left, bottom-right, top-right, top-left relative to the plane, with low edge first and high edge second.
5. If the same building/support or same plane cannot be established, set the corresponding boolean to false and lower confidence. Never manufacture a match.
6. Obstacles seen only in IMAGE 2 must still be reported. When their footprint is not directly visible in IMAGE 1, metricPolygonNormalized must be null.
7. Estimate slope from the real photograph only; lower slopeConfidence when weakly supported.
${args.previousIssues.length ? `\nA previous automatic attempt failed deterministic checks:\n- ${args.previousIssues.join("\n- ")}\nCorrect the identity analysis; do not lower confidence thresholds.\n` : ""}
Return only the requested structured object.`;
}

async function runIdentityPass(args: {
  apiKey: string;
  model: string;
  parcelReference: string;
  parcelPolygonNormalized: Point2D[];
  metricImage: InputPhoto;
  realImage: InputPhoto;
  faceLabel: string;
  contextNotes?: string;
  previousIssues?: string[];
}) {
  const previousIssues = args.previousIssues ?? [];
  return openaiJson<CrossViewSurfaceIdentity>({
    apiKey: args.apiKey,
    model: args.model,
    prompt: identityPrompt({
      parcelReference: args.parcelReference,
      parcelPolygonNormalized: args.parcelPolygonNormalized,
      faceLabel: args.faceLabel,
      previousIssues,
      contextNotes: args.contextNotes,
    }),
    imageDataUrls: [toDataUrl(args.metricImage), toDataUrl(args.realImage)],
    imageLabels: [
      `IMAGE 1 — AUTHORITATIVE ROLE = satellite_mass. Metric scale = ${args.metricImage.metersPerPixel ?? "unknown"} metre/pixel. Target parcel = ${args.parcelReference}.`,
      `IMAGE 2 — AUTHORITATIVE ROLE = ${args.realImage.role}. Real project photograph used for physical surface identity.`,
    ],
    schemaName: previousIssues.length ? "cross_view_surface_identity_recovery" : "cross_view_surface_identity",
    schema: identitySchema as unknown as Record<string, unknown>,
  });
}

/**
 * Fail-closed two-pass identity reconciliation. The second pass receives the
 * deterministic reasons for rejection; thresholds never move to make a case pass.
 */
export async function resolveCrossViewSurfaceIdentity(args: {
  apiKey: string;
  model: string;
  parcelReference: string;
  parcelPolygonNormalized: Point2D[];
  metricImage: InputPhoto;
  realImage: InputPhoto;
  faceLabel: string;
  contextNotes?: string;
  thresholds?: CrossViewIdentityThresholds;
}) {
  const thresholds = args.thresholds ?? DEFAULT_THRESHOLDS;
  const first = await runIdentityPass({ ...args });
  const firstIssues = validateCrossViewSurfaceIdentity(first, args.parcelPolygonNormalized, thresholds);
  if (!firstIssues.length) return first;
  const second = await runIdentityPass({ ...args, previousIssues: firstIssues });
  const secondIssues = validateCrossViewSurfaceIdentity(second, args.parcelPolygonNormalized, thresholds);
  if (secondIssues.length) {
    throw new Error(`Surface identity bloquée après réconciliation automatique : ${secondIssues.join(" ")}`);
  }
  return second;
}
