import { polygonsOverlapOrTouch } from "../geometry/metricSurfaceFromIdentity";
import type { CrossViewObstacle, CrossViewSurfaceIdentity } from "../identity/crossViewSurfaceIdentity";
import { openaiJson } from "../providers/openaiJson";
import type { InputPhoto, Point2D } from "../types";
import { toDataUrl } from "../utils/dataUrl";

export type SurfaceObstacleCandidate = {
  id: string;
  type: string;
  description: string;
  confidence: number;
  roofPolygonNormalized: Point2D[] | null;
  metricPolygonNormalized: Point2D[] | null;
};

type DetectionPass = {
  obstacles: SurfaceObstacleCandidate[];
  notes: string[];
};

type AuditPass = {
  obstacles: SurfaceObstacleCandidate[];
  rejectedCandidateIds: string[];
  coverageConfidence: number;
  notes: string[];
};

export type SurfaceObstacleInventory = {
  obstacles: CrossViewObstacle[];
  coverageConfidence: number;
  detectorCount: number;
  notes: string[];
};

const pointSchema = {
  type: "object",
  additionalProperties: false,
  properties: { x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 } },
  required: ["x", "y"],
} as const;

const obstacleSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    type: { type: "string" },
    description: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    roofPolygonNormalized: { type: ["array", "null"], minItems: 3, maxItems: 12, items: pointSchema },
    metricPolygonNormalized: { type: ["array", "null"], minItems: 3, maxItems: 12, items: pointSchema },
  },
  required: ["id", "type", "description", "confidence", "roofPolygonNormalized", "metricPolygonNormalized"],
} as const;

const detectionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    obstacles: { type: "array", maxItems: 32, items: obstacleSchema },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["obstacles", "notes"],
} as const;

const auditSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    obstacles: { type: "array", maxItems: 32, items: obstacleSchema },
    rejectedCandidateIds: { type: "array", maxItems: 32, items: { type: "string" } },
    coverageConfidence: { type: "number", minimum: 0, maximum: 1 },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["obstacles", "rejectedCandidateIds", "coverageConfidence", "notes"],
} as const;

function finitePoint(point: Point2D) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function normalizedPoint(point: Point2D) {
  return finitePoint(point) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function validPolygon(polygon: Point2D[] | null | undefined): polygon is Point2D[] {
  return Array.isArray(polygon) && polygon.length >= 3 && polygon.every(normalizedPoint);
}

function polygonArea(poly: Point2D[]) {
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    area += poly[j]!.x * poly[i]!.y - poly[i]!.x * poly[j]!.y;
  }
  return Math.abs(area) / 2;
}

function centroid(poly: Point2D[]) {
  return {
    x: poly.reduce((sum, point) => sum + point.x, 0) / poly.length,
    y: poly.reduce((sum, point) => sum + point.y, 0) / poly.length,
  };
}

function sameCandidate(a: SurfaceObstacleCandidate, b: SurfaceObstacleCandidate) {
  const aPoly = validPolygon(a.roofPolygonNormalized) ? a.roofPolygonNormalized : a.metricPolygonNormalized;
  const bPoly = validPolygon(b.roofPolygonNormalized) ? b.roofPolygonNormalized : b.metricPolygonNormalized;
  if (!validPolygon(aPoly) || !validPolygon(bPoly)) return a.id === b.id;
  if (polygonsOverlapOrTouch(aPoly, bPoly)) return true;
  const ac = centroid(aPoly);
  const bc = centroid(bPoly);
  const distance = Math.hypot(ac.x - bc.x, ac.y - bc.y);
  return distance < 0.018 && a.type.trim().toLowerCase() === b.type.trim().toLowerCase();
}

function deduplicate(candidates: SurfaceObstacleCandidate[]) {
  const result: SurfaceObstacleCandidate[] = [];
  for (const candidate of candidates) {
    const existingIndex = result.findIndex((existing) => sameCandidate(existing, candidate));
    if (existingIndex < 0) {
      result.push(candidate);
      continue;
    }
    const existing = result[existingIndex]!;
    const existingPoly = validPolygon(existing.roofPolygonNormalized) ? existing.roofPolygonNormalized : existing.metricPolygonNormalized;
    const candidatePoly = validPolygon(candidate.roofPolygonNormalized) ? candidate.roofPolygonNormalized : candidate.metricPolygonNormalized;
    const existingArea = validPolygon(existingPoly) ? polygonArea(existingPoly) : 0;
    const candidateArea = validPolygon(candidatePoly) ? polygonArea(candidatePoly) : 0;
    if (candidate.confidence > existing.confidence + 0.05 || candidateArea > existingArea * 1.2) {
      result[existingIndex] = candidate;
    }
  }
  return result;
}

function candidateTouchesMatchedPlane(candidate: SurfaceObstacleCandidate, identity: CrossViewSurfaceIdentity) {
  const roofTouches = validPolygon(candidate.roofPolygonNormalized)
    && polygonsOverlapOrTouch(candidate.roofPolygonNormalized, identity.roofPlane.polygonNormalized);
  const metricTouches = validPolygon(candidate.metricPolygonNormalized)
    && polygonsOverlapOrTouch(candidate.metricPolygonNormalized, identity.metricPlane.polygonNormalized);
  return Boolean(roofTouches || metricTouches);
}

export function finalizeSurfaceObstacleCandidates(
  candidates: SurfaceObstacleCandidate[],
  identity: CrossViewSurfaceIdentity,
) {
  const relevant = deduplicate(candidates).filter((candidate) => candidateTouchesMatchedPlane(candidate, identity));
  const unresolved = relevant.filter((candidate) => !validPolygon(candidate.roofPolygonNormalized) && !validPolygon(candidate.metricPolygonNormalized));
  if (unresolved.length) {
    throw new Error(`Obstacle Engine : ${unresolved.length} obstacle(s) du pan sont visibles mais sans emprise exploitable.`);
  }
  const weak = relevant.filter((candidate) => candidate.confidence < 0.55);
  if (weak.length) {
    throw new Error(`Obstacle Engine : ${weak.length} obstacle(s) potentiels sur le pan restent trop incertains après l'audit indépendant.`);
  }
  return relevant.map<CrossViewObstacle>((candidate) => ({
    type: candidate.type,
    description: candidate.description,
    roofPolygonNormalized: validPolygon(candidate.roofPolygonNormalized) ? candidate.roofPolygonNormalized : null,
    metricPolygonNormalized: validPolygon(candidate.metricPolygonNormalized) ? candidate.metricPolygonNormalized : null,
  }));
}

function detectorPrompt(identity: CrossViewSurfaceIdentity, faceLabel: string) {
  return `You are PilotPaper's Surface Obstacle Census Engine.

The physical building and target roof/support plane have ALREADY been identified. Do not identify another building or another plane. Your only task is a HIGH-RECALL, exhaustive census of physical objects that can prevent photovoltaic modules from occupying part of the locked plane.

TARGET FACE LABEL: ${faceLabel}
IMAGE 1 target metric plane polygon: ${JSON.stringify(identity.metricPlane.polygonNormalized)}
IMAGE 2 target real-photo plane polygon: ${JSON.stringify(identity.roofPlane.polygonNormalized)}

Systematic inspection procedure (mandatory):
1. Inspect IMAGE 2 only inside and immediately along the target polygon. Sweep LEFT -> CENTER -> RIGHT, and in each zone sweep GUTTER -> MID-SLOPE -> RIDGE.
2. Then inspect every target-plane edge separately: left edge, right edge, gutter edge, ridge edge.
3. Look specifically for small or slender fixtures that are easy to miss: chimney stacks, roof windows/skylights, vents, flues, antenna masts, dishes, aerial bases, HVAC/roof units, dormers, pipes, safety anchors, permanent rails, cable trays or other fixed equipment whose physical footprint would prevent a module from occupying that area.
4. Do NOT report shadows, stains, roof tiles, texture changes, vegetation that does not physically occupy the target plane, gutters/ridges as normal roof boundaries, or objects entirely on a neighbouring plane/building.
5. For EVERY reported obstacle visible in IMAGE 2, provide a tight polygon around its physical footprint in IMAGE 2 coordinates. Even a thin mast/antenna must receive a small polygon around its attachment/base or occupied footprint. Do not return null merely because an object is small.
6. If the same obstacle footprint can be directly seen in IMAGE 1, also provide metricPolygonNormalized. Otherwise set metricPolygonNormalized to null; PilotPaper will project the IMAGE 2 footprint mathematically onto the locked metric plane.
7. Prefer recall: if a physical object may occupy the target plane, include it with an honest confidence rather than silently omitting it.
8. IDs must be unique: O1, O2, O3...

IMAGE 1 is the authoritative orthographic metric view. IMAGE 2 is the real roof photograph. Return only the structured object.`;
}

function auditPrompt(
  identity: CrossViewSurfaceIdentity,
  faceLabel: string,
  detector: DetectionPass,
) {
  return `You are PilotPaper's INDEPENDENT Surface Obstacle Audit Engine.

The target plane is already locked. Perform a fresh inspection of BOTH images and produce the FINAL exhaustive inventory of physical photovoltaic-blocking obstacles on that exact plane.

TARGET FACE LABEL: ${faceLabel}
IMAGE 1 target metric plane polygon: ${JSON.stringify(identity.metricPlane.polygonNormalized)}
IMAGE 2 target real-photo plane polygon: ${JSON.stringify(identity.roofPlane.polygonNormalized)}

First-pass candidates to audit:
${JSON.stringify(detector.obstacles)}

Audit rules:
1. Re-scan the entire target plane yourself; do not merely approve the first pass. Use the same left/center/right and gutter-to-ridge sweep, then check all four edges.
2. Give EXTRA attention to thin or small objects: antenna/mast bases, vents, flues, roof anchors, pipes, dishes, skylights and small chimney stacks.
3. The final obstacles array must contain every confirmed physical obstacle intersecting the target plane, including newly discovered obstacles missed by the first pass.
4. Preserve the same ID for a retained first-pass candidate. New discoveries use IDs A1, A2, A3...
5. Every first-pass ID that is not retained MUST appear in rejectedCandidateIds, and may be rejected only when it is clearly a false positive or entirely outside the locked target plane.
6. If a candidate is uncertain but can physically occupy the target plane, KEEP it in the final inventory with an honest lower confidence; do not reject it just to simplify the layout.
7. Every obstacle visible in IMAGE 2 must have a tight roofPolygonNormalized. If directly visible in IMAGE 1, also give metricPolygonNormalized; otherwise null is correct.
8. coverageConfidence measures confidence that the FINAL list contains all visible PV-blocking obstacles on the target plane, not confidence in the roof identity.
9. Do not report shadows, stains, ordinary tiles, normal ridge/eave boundaries, or objects entirely outside the target plane.

Return only the structured audit object.`;
}

async function detect(args: {
  apiKey: string;
  model: string;
  identity: CrossViewSurfaceIdentity;
  metricImage: InputPhoto;
  realImage: InputPhoto;
  faceLabel: string;
}) {
  return openaiJson<DetectionPass>({
    apiKey: args.apiKey,
    model: args.model,
    prompt: detectorPrompt(args.identity, args.faceLabel),
    imageDataUrls: [toDataUrl(args.metricImage), toDataUrl(args.realImage)],
    imageLabels: [
      "IMAGE 1 — AUTHORITATIVE ROLE = satellite_mass. Orthographic metric evidence.",
      "IMAGE 2 — AUTHORITATIVE ROLE = roof. Real project photograph; primary obstacle-census evidence.",
    ],
    schemaName: "surface_obstacle_census",
    schema: detectionSchema as unknown as Record<string, unknown>,
  });
}

async function audit(args: {
  apiKey: string;
  model: string;
  identity: CrossViewSurfaceIdentity;
  metricImage: InputPhoto;
  realImage: InputPhoto;
  faceLabel: string;
  detector: DetectionPass;
}) {
  return openaiJson<AuditPass>({
    apiKey: args.apiKey,
    model: args.model,
    prompt: auditPrompt(args.identity, args.faceLabel, args.detector),
    imageDataUrls: [toDataUrl(args.metricImage), toDataUrl(args.realImage)],
    imageLabels: [
      "IMAGE 1 — AUTHORITATIVE ROLE = satellite_mass. Independent obstacle-audit evidence.",
      "IMAGE 2 — AUTHORITATIVE ROLE = roof. Independent obstacle-audit evidence.",
    ],
    schemaName: "surface_obstacle_audit",
    schema: auditSchema as unknown as Record<string, unknown>,
  });
}

/**
 * Dedicated two-pass obstacle pipeline. Roof identity is intentionally not
 * re-solved here: the engine receives a locked physical plane and performs an
 * independent high-recall census followed by a completeness/precision audit.
 */
export async function resolveSurfaceObstacleInventory(args: {
  apiKey: string;
  model: string;
  identity: CrossViewSurfaceIdentity;
  metricImage: InputPhoto;
  realImage: InputPhoto;
  faceLabel: string;
}): Promise<SurfaceObstacleInventory> {
  const detector = await detect(args);
  const audited = await audit({ ...args, detector });

  const retainedIds = new Set(audited.obstacles.map((obstacle) => obstacle.id));
  const rejectedIds = new Set(audited.rejectedCandidateIds);
  const omitted = detector.obstacles
    .map((obstacle) => obstacle.id)
    .filter((id) => !retainedIds.has(id) && !rejectedIds.has(id));
  if (omitted.length) {
    throw new Error(`Obstacle Engine : audit incomplet, candidat(s) non statué(s) : ${omitted.join(", ")}.`);
  }
  if (audited.coverageConfidence < 0.78) {
    throw new Error(`Obstacle Engine : couverture de l'audit insuffisante (${audited.coverageConfidence.toFixed(2)} < 0.78).`);
  }

  const obstacles = finalizeSurfaceObstacleCandidates(audited.obstacles, args.identity);
  return {
    obstacles,
    coverageConfidence: audited.coverageConfidence,
    detectorCount: detector.obstacles.length,
    notes: [...detector.notes, ...audited.notes],
  };
}
