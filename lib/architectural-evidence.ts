export type NormalizedPoint = {
  x: number;
  y: number;
};

export type FaceAllocationGeometry = {
  face_id: string;
  label: string;
  panel_count: number;
  rows: number;
  columns: number;
  last_row_count: number;
  gutter_clearance_mm: number;
  satellite_roof_outline: NormalizedPoint[];
  satellite_panel_cells: NormalizedPoint[][];
  project_photo_role: string;
  project_roof_outline: NormalizedPoint[];
  project_panel_cells: NormalizedPoint[][];
};

export type ArchitecturalGeometry = {
  verdict: "verified" | "blocked";
  confidence: number;
  satellite_roof_outline: NormalizedPoint[];
  satellite_array_quad: NormalizedPoint[];
  satellite_eave_line: NormalizedPoint[];
  satellite_plane_anchors: NormalizedPoint[];
  near_roof_outline: NormalizedPoint[];
  near_array_quad: NormalizedPoint[];
  near_eave_line: NormalizedPoint[];
  near_plane_anchors: NormalizedPoint[];
  roof_pitch_deg: number;
  layout_rows: number;
  layout_columns: number;
  module_orientation: "portrait" | "landscape";
  agreement_iou: Record<string, number>;
  source_sha256: Record<string, string>;
  evidence: string[];
  /** New AI-first engine: independent fields; no field may bridge a ridge/hip. */
  face_allocations?: FaceAllocationGeometry[];
  project_photo_role?: string;
};

export type VerifiedDimension = {
  dimension_id: string;
  label: string;
  value_mm: number | null;
  tolerance_mm: number | null;
  provenance: string;
  evidence: string;
  verified: boolean;
};

export type ArchitecturalEvidence = {
  geometry: ArchitecturalGeometry;
  dimensions: VerifiedDimension[];
};

export function dimensionValue(
  evidence: ArchitecturalEvidence,
  id: string,
): number | null {
  const dimension = evidence.dimensions.find(
    (candidate) => candidate.dimension_id === id && candidate.verified,
  );
  return dimension?.value_mm ?? null;
}
