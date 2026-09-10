import type { PhotoRole, Point2D, RoofFaceObservation } from "../types";
import type { RoofTopology } from "./supportRules";

export type SurfaceBoundaryKind =
  | "gutter"
  | "low_edge"
  | "ridge"
  | "high_edge"
  | "left_edge"
  | "right_edge"
  | "hip"
  | "valley"
  | "parapet"
  | "unknown";

export interface SurfaceBoundary {
  kind: SurfaceBoundaryKind;
  points: [Point2D, Point2D];
  confidence: number;
}

export interface SurfaceSupportView {
  role: PhotoRole;
  selectedFaceVisible: boolean;
  confidence: number;
  polygonNormalized: Point2D[];
  boundaries: SurfaceBoundary[];
}

export interface SurfaceSupportObstacle {
  type: string;
  description: string;
  polygonNormalized?: Point2D[];
  viewRole?: PhotoRole;
}

/**
 * Generic geometric support understood by PilotPaper.
 *
 * V1 uses it for pitched residential roof faces. V2/V3 can add richer adapters
 * without changing the downstream layout/projection contract.
 */
export interface SurfaceSupport {
  id: string;
  label: string;
  topology: RoofTopology;
  confidence: number;
  orientation?: string;
  slopeDeg?: number;
  views: SurfaceSupportView[];
  obstacles: SurfaceSupportObstacle[];
}

export interface SurfaceConfidenceBreakdown {
  surface: number;
  boundaries: number;
  metric: number;
  obstacles: number;
  multiView: number;
}

export interface SurfaceUnderstandingAudit {
  passed: boolean;
  confidence: number;
  components: SurfaceConfidenceBreakdown;
  errors: string[];
  warnings: string[];
}

export interface AllocatedSurfaceGateResult {
  confidence: number;
  warnings: string[];
  audits: Record<string, SurfaceUnderstandingAudit>;
}

export interface SurfaceLayoutEligibilityResult {
  eligibleFaceIds: string[];
  rejected: Record<string, string[]>;
  warnings: string[];
  audits: Record<string, SurfaceUnderstandingAudit>;
}

function finitePoint(point: Point2D) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function normalizedPoint(point: Point2D) {
  return finitePoint(point) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function normalizedConfidence(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, Number(value))) : 0;
}

export function normalizedPolygonArea(poly: Point2D[]) {
  if (poly.length < 3) return 0;
  let value = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    value += poly[j]!.x * poly[i]!.y - poly[i]!.x * poly[j]!.y;
  }
  return Math.abs(value) / 2;
}

function lowBoundaryKind(topology: RoofTopology): SurfaceBoundaryKind {
  if (topology === "flat") return "parapet";
  if (topology === "mono_pitch" || topology === "carport" || topology === "canopy") return "low_edge";
  return "gutter";
}

function highBoundaryKind(topology: RoofTopology): SurfaceBoundaryKind {
  if (topology === "flat") return "parapet";
  if (topology === "mono_pitch" || topology === "carport" || topology === "canopy") return "high_edge";
  return "ridge";
}

function hasValidPolygon(polygon: Point2D[] | undefined) {
  return Boolean(
    polygon &&
    polygon.length >= 3 &&
    polygon.every(normalizedPoint) &&
    normalizedPolygonArea(polygon) >= 0.00001,
  );
}

function isMetricRole(role: PhotoRole | undefined) {
  return role == null || role === "satellite_mass";
}

/**
 * Lossless adapter from the current vision contract into the future generic
 * SurfaceSupport model. No metric dimension is invented here.
 */
export function surfaceSupportFromRoofFace(
  face: RoofFaceObservation,
  topology: RoofTopology,
): SurfaceSupport {
  return {
    id: face.id,
    label: face.label,
    topology,
    confidence: face.confidence,
    orientation: face.orientation,
    slopeDeg: face.slopeDeg,
    obstacles: face.obstacles.map((obstacle) => ({ ...obstacle })),
    views: face.views.map((view) => {
      const boundaries: SurfaceBoundary[] = [];
      if (view.gutterLineNormalized) {
        boundaries.push({
          kind: lowBoundaryKind(topology),
          points: view.gutterLineNormalized,
          confidence: view.confidence,
        });
      }
      if (view.ridgeLineNormalized) {
        boundaries.push({
          kind: highBoundaryKind(topology),
          points: view.ridgeLineNormalized,
          confidence: view.confidence,
        });
      }
      return {
        role: view.role,
        selectedFaceVisible: view.selectedFaceVisible,
        confidence: view.confidence,
        polygonNormalized: view.roofPolygonNormalized.map((point) => ({ ...point })),
        boundaries,
      };
    }),
  };
}

function confidenceBreakdown(surface: SurfaceSupport): SurfaceConfidenceBreakdown {
  const visible = surface.views.filter((view) => view.selectedFaceVisible);
  const metricViews = visible.filter(
    (view) => view.role === "satellite_mass" && view.polygonNormalized.length === 4,
  );
  const realViews = visible.filter(
    (view) => !["satellite", "satellite_mass"].includes(view.role) && view.polygonNormalized.length === 4,
  );
  const boundaryPairs = visible.flatMap((view) => {
    const low = view.boundaries.find((boundary) => ["gutter", "low_edge", "parapet"].includes(boundary.kind));
    const high = view.boundaries.find((boundary) => ["ridge", "high_edge", "parapet"].includes(boundary.kind));
    return low && high ? [Math.min(normalizedConfidence(low.confidence), normalizedConfidence(high.confidence))] : [];
  });

  const obstacleScores = surface.obstacles.map((obstacle) => {
    if (!hasValidPolygon(obstacle.polygonNormalized)) return 0;
    if (!isMetricRole(obstacle.viewRole)) return 0;
    const metricView = metricViews[0];
    return metricView ? normalizedConfidence(metricView.confidence) : 0;
  });

  const realScores = realViews.map((view) => normalizedConfidence(view.confidence));
  return {
    surface: normalizedConfidence(surface.confidence),
    boundaries: boundaryPairs.length ? Math.max(...boundaryPairs) : 0,
    metric: metricViews.length ? Math.max(...metricViews.map((view) => normalizedConfidence(view.confidence))) : 0,
    obstacles: obstacleScores.length ? Math.min(...obstacleScores) : 1,
    multiView: realScores.length ? Math.min(...realScores) : 0,
  };
}

/**
 * Deterministic V1 gate for vision geometry. It deliberately checks geometry
 * instead of trusting an AI confidence score alone.
 */
export function auditSurfaceUnderstanding(
  surface: SurfaceSupport,
  minimumConfidence = 0.72,
): SurfaceUnderstandingAudit {
  const errors: string[] = [];
  const warnings: string[] = [];
  const visible = surface.views.filter((view) => view.selectedFaceVisible);
  const components = confidenceBreakdown(surface);

  if (!surface.id.trim()) errors.push("Surface support has no stable id.");
  if (!Number.isFinite(surface.confidence) || surface.confidence < minimumConfidence) {
    errors.push(`Surface ${surface.id || "?"} confidence is below the V1 threshold.`);
  }
  if (!visible.length) errors.push(`Surface ${surface.id || "?"} is not visibly demonstrated.`);

  for (const view of visible) {
    if (view.polygonNormalized.length !== 4) {
      errors.push(`Surface ${surface.id} view ${view.role} does not provide exactly four V1 corners.`);
      continue;
    }
    if (!view.polygonNormalized.every(normalizedPoint)) {
      errors.push(`Surface ${surface.id} view ${view.role} contains invalid normalized coordinates.`);
      continue;
    }
    if (normalizedPolygonArea(view.polygonNormalized) < 0.0025) {
      errors.push(`Surface ${surface.id} view ${view.role} polygon is degenerate or too small.`);
    }
    if (!Number.isFinite(view.confidence) || view.confidence < minimumConfidence) {
      warnings.push(`Surface ${surface.id} view ${view.role} has low confidence.`);
    }
  }

  const hasOrthographic = visible.some((view) => view.role === "satellite_mass");
  const realViews = visible.filter((view) => !["satellite", "satellite_mass"].includes(view.role));
  if (!hasOrthographic) warnings.push(`Surface ${surface.id} has no visible IGN close-view evidence.`);
  if (!realViews.length) warnings.push(`Surface ${surface.id} has no visible real-photo evidence.`);
  if (realViews.length < 2) {
    warnings.push(`Surface ${surface.id} has fewer than two independent real-photo roof observations; multi-view confidence is limited.`);
  }
  if (components.boundaries < minimumConfidence) {
    warnings.push(`Surface ${surface.id} does not have a strong low/high boundary pair in the supplied evidence.`);
  }

  const confidenceCandidates = [
    components.surface,
    components.metric || 1,
    components.multiView || 1,
  ].filter(Number.isFinite);
  const confidence = confidenceCandidates.length ? Math.min(...confidenceCandidates) : 0;

  return {
    passed: errors.length === 0,
    confidence,
    components,
    errors,
    warnings,
  };
}

function surfaceBlockingErrors(
  surface: SurfaceSupport,
  audit: SurfaceUnderstandingAudit,
  minimumConfidence: number,
): string[] {
  const visible = surface.views.filter((view) => view.selectedFaceVisible);
  const errors = [...audit.errors];
  const hasOrthographic = visible.some(
    (view) => view.role === "satellite_mass" &&
      view.polygonNormalized.length === 4 &&
      hasValidPolygon(view.polygonNormalized) &&
      normalizedConfidence(view.confidence) >= minimumConfidence,
  );
  const hasRealPhoto = visible.some(
    (view) => !["satellite", "satellite_mass"].includes(view.role) &&
      view.polygonNormalized.length === 4 &&
      hasValidPolygon(view.polygonNormalized) &&
      normalizedConfidence(view.confidence) >= minimumConfidence,
  );

  if (!hasOrthographic) {
    errors.push(`Surface ${surface.id} is not demonstrated on the metric IGN close view.`);
  }
  if (!hasRealPhoto) {
    errors.push(`Surface ${surface.id} is not demonstrated in a usable real project photograph.`);
  }

  // V1 dossiers already require an independent close and roof/oblique project
  // photograph. Requiring the selected face in both observations prevents one
  // perspective from silently carrying the entire geometric interpretation.
  for (const role of ["near", "roof"] as const) {
    const demonstrated = visible.some(
      (view) => view.role === role &&
        view.polygonNormalized.length === 4 &&
        hasValidPolygon(view.polygonNormalized) &&
        normalizedConfidence(view.confidence) >= minimumConfidence,
    );
    if (!demonstrated) {
      errors.push(
        `Surface ${surface.id} has no reliable ${role} observation of the same selected roof face.`,
      );
    }
  }

  for (const obstacle of surface.obstacles) {
    if (!hasValidPolygon(obstacle.polygonNormalized)) {
      errors.push(
        `Obstacle ${obstacle.type} on surface ${surface.id} has no usable polygon and cannot be safely excluded from PV layout.`,
      );
      continue;
    }
    if (!isMetricRole(obstacle.viewRole)) {
      errors.push(
        `Obstacle ${obstacle.type} on surface ${surface.id} is only localized in ${obstacle.viewRole} evidence and has no metric IGN footprint.`,
      );
    }
  }

  return [...new Set(errors)];
}

/**
 * Determine which detected surfaces are safe enough to be offered to the
 * deterministic Layout Engine. Invalid or insufficiently demonstrated faces are
 * excluded instead of being allowed to influence allocation.
 */
export function selectLayoutEligibleSurfaces(
  faces: RoofFaceObservation[],
  topology: RoofTopology,
  minimumConfidence = 0.72,
): SurfaceLayoutEligibilityResult {
  const eligibleFaceIds: string[] = [];
  const rejected: Record<string, string[]> = {};
  const audits: Record<string, SurfaceUnderstandingAudit> = {};
  const warnings: string[] = [];

  for (const face of faces) {
    const surface = surfaceSupportFromRoofFace(face, topology);
    const audit = auditSurfaceUnderstanding(surface, minimumConfidence);
    audits[face.id] = audit;
    const errors = surfaceBlockingErrors(surface, audit, minimumConfidence);
    if (errors.length) {
      rejected[face.id] = errors;
      continue;
    }
    eligibleFaceIds.push(face.id);
    warnings.push(...audit.warnings);
  }

  return {
    eligibleFaceIds,
    rejected,
    warnings: [...new Set(warnings)],
    audits,
  };
}

/**
 * Gate only the surfaces that the deterministic Layout Engine actually selected.
 * A weak unrelated face must not block an otherwise well-demonstrated project,
 * while every allocated face must be demonstrated by metric IGN evidence and the
 * independent near + roof project photographs before image generation can start.
 */
export function gateAllocatedSurfaces(
  faces: RoofFaceObservation[],
  topology: RoofTopology,
  allocatedFaceIds: string[],
  minimumConfidence = 0.72,
): AllocatedSurfaceGateResult {
  const uniqueIds = [...new Set(allocatedFaceIds)];
  if (!uniqueIds.length) throw new Error("No allocated surface was supplied to the V1 understanding gate.");

  const audits: Record<string, SurfaceUnderstandingAudit> = {};
  const warnings: string[] = [];
  const confidences: number[] = [];

  for (const faceId of uniqueIds) {
    const face = faces.find((candidate) => candidate.id === faceId);
    if (!face) throw new Error(`Allocated surface ${faceId} was not detected by vision analysis.`);

    const surface = surfaceSupportFromRoofFace(face, topology);
    const audit = auditSurfaceUnderstanding(surface, minimumConfidence);
    audits[faceId] = audit;
    const errors = surfaceBlockingErrors(surface, audit, minimumConfidence);

    if (errors.length) {
      throw new Error(`Surface understanding rejected ${faceId}: ${errors.join(" ")}`);
    }

    warnings.push(...audit.warnings);
    confidences.push(audit.confidence);
  }

  return {
    confidence: confidences.length ? Math.min(...confidences) : 0,
    warnings: [...new Set(warnings)],
    audits,
  };
}
