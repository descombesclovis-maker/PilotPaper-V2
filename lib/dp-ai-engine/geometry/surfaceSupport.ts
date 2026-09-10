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

export interface SurfaceUnderstandingAudit {
  passed: boolean;
  confidence: number;
  errors: string[];
  warnings: string[];
}

function finitePoint(point: Point2D) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function normalizedPoint(point: Point2D) {
  return finitePoint(point) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
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
  const hasRealPhoto = visible.some((view) => !["satellite", "satellite_mass"].includes(view.role));
  if (!hasOrthographic) warnings.push(`Surface ${surface.id} has no visible IGN close-view evidence.`);
  if (!hasRealPhoto) warnings.push(`Surface ${surface.id} has no visible real-photo evidence.`);

  const confidenceCandidates = [
    surface.confidence,
    ...visible.map((view) => view.confidence),
  ].filter(Number.isFinite);
  const confidence = confidenceCandidates.length ? Math.min(...confidenceCandidates) : 0;

  return {
    passed: errors.length === 0,
    confidence,
    errors,
    warnings,
  };
}
