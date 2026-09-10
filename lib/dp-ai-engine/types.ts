import type { RoofCovering, RoofTopology } from "./geometry/supportRules";
export type { RoofCovering, RoofTopology } from "./geometry/supportRules";

export type PhotoRole = "satellite" | "satellite_mass" | "front" | "left_oblique" | "right_oblique" | "near" | "roof" | "far";

export interface InputPhoto {
  role: PhotoRole;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
  filename?: string;
  widthPx?: number;
  heightPx?: number;
  metersPerPixel?: number;
}

export interface PanelSpec {
  manufacturer?: string;
  model: string;
  widthMm: number;
  heightMm: number;
  frameColor?: string;
  powerWp?: number;
}

export interface ArraySpec {
  rows: number;
  columns: number;
  orientation: "portrait" | "landscape";
  roofFace: string;
  placement: "centered" | "left" | "right" | "custom";
  layoutMode?: "fixed" | "automatic";
  allowSplitAcrossFaces?: boolean;
  gutterClearanceMm?: number;
  ridgeClearanceMm?: number;
  leftEdgeClearanceMm?: number;
  rightEdgeClearanceMm?: number;
  interPanelGapMm?: number;
}

export interface RoofMetricGeometry {
  /** Horizontal eave-to-eave width of the SELECTED roof face. */
  widthMm?: number;
  /** Distance gutter -> ridge/high edge measured ON the selected roof plane. */
  slopeLengthMm?: number;
  slopeDeg?: number;
  eaveHeightMm?: number;
  source?: "form" | "survey" | "plan" | "calibration" | "external-data" | "ign-derived";
}

export interface MetricPoint2D {
  /** Local coordinate parallel to the low/eave edge. */
  xMm: number;
  /** Local coordinate measured up the physical roof/support plane. */
  yMm: number;
}

export interface RoofFaceMetricObstacle {
  type: string;
  description: string;
  polygonMm: MetricPoint2D[];
}

export interface RoofFaceMetricGeometry extends RoofMetricGeometry {
  id: string;
  label?: string;
  /**
   * Exact local support polygon derived from the calibrated IGN close view.
   * Coordinates are expressed in millimetres in the roof-plane basis.
   */
  surfacePolygonMm?: MetricPoint2D[];
  /** Exact obstacle footprints in the same local roof-plane basis. */
  obstaclePolygonsMm?: RoofFaceMetricObstacle[];
  /**
   * Transitional compatibility field used by the legacy capacity allocator.
   * V1.2 must stop relying on it once polygon-aware placement is validated.
   */
  blockedCells?: number;
}

export interface ProjectSupport {
  topology: RoofTopology;
  covering: RoofCovering;
  existingStructure?: boolean;
  rackTiltDeg?: number;
}

export interface ProjectForm {
  projectId: string;
  address: string;
  applicantName?: string;
  parcelReference?: string;
  panel: PanelSpec;
  array: ArraySpec;
  /** Primary quantity: user-requested panel count. Falls back to rows×columns for old forms. */
  requestedPanelCount?: number;
  roofGeometry?: RoofMetricGeometry;
  roofFaces?: RoofFaceMetricGeometry[];
  roofSelection?: { mode: "automatic" | "priority"; priorityFaceId?: string };
  support?: ProjectSupport;
  notes?: string;
}

export interface Point2D { x: number; y: number }

export interface RoofViewObservation {
  role: PhotoRole;
  faceId?: string;
  selectedFaceVisible: boolean;
  confidence: number;
  roofPolygonNormalized: Point2D[];
  gutterLineNormalized?: [Point2D, Point2D];
  ridgeLineNormalized?: [Point2D, Point2D];
  perspectiveNotes: string[];
}

export interface RoofFaceObservation {
  id: string;
  label: string;
  orientation?: string;
  confidence: number;
  slopeDeg?: number;
  views: RoofViewObservation[];
  obstacles: Array<{ type: string; description: string; polygonNormalized?: Point2D[]; viewRole?: PhotoRole }>;
}

export interface RoofObservation {
  selectedFaceDescription: string;
  confidence: number;
  roofPolygonNormalized?: Point2D[];
  gutterLineNormalized?: [Point2D, Point2D];
  ridgeLineNormalized?: [Point2D, Point2D];
  views?: RoofViewObservation[];
  faces?: RoofFaceObservation[];
  obstacles: Array<{ type: string; description: string; polygonNormalized?: Point2D[] }>; // single-face compatibility
  perspectiveNotes: string[];
  uncertainties: string[];
}

export interface FacePlacement {
  faceId: string;
  label?: string;
  panelCount: number;
  rows: number;
  columns: number;
  lastRowCount: number;
  resolvedGutterMm: number;
  /** Resolved physical distance from the top of the PV field to the ridge/high edge. */
  resolvedRidgeMm?: number;
  /** Resolved lateral origin of the full PV field on the roof plane. */
  resolvedLeftMm?: number;
  /** Remaining clearance from the full PV field to the opposite lateral edge. */
  resolvedRightMm?: number;
  widthMm: number;
  slopeLengthMm: number;
}

export interface ProjectContext {
  projectId: string;
  address: string;
  array: ArraySpec;
  panel: PanelSpec;
  exactPanelCount: number;
  fieldWidthMm: number;
  fieldHeightMm: number;
  roof: RoofObservation;
  roofGeometry?: RoofMetricGeometry;
  resolvedPlacement?: { leftMm: number; rightMm: number; gutterMm: number; ridgeMm: number };
  facePlacements?: FacePlacement[];
  support?: ProjectSupport;
  immutableFacts: string[];
}

export type DPNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface GeneratedAsset {
  dp: DPNumber;
  kind: "image" | "svg" | "pdf" | "json";
  mimeType: string;
  base64?: string;
  text?: string;
  generationPrompt?: string;
  attempt: number;
  /** DP7/DP8 can be immutable source photographs rather than AI edits. */
  sourceRole?: PhotoRole;
}

export interface QualityIssue {
  code: string;
  severity: "warning" | "error" | "fatal";
  message: string;
  correction: string;
}

export interface QualityReport {
  passed: boolean;
  score: number;
  panelCountObserved?: number;
  rowsObserved?: number;
  columnsObserved?: number;
  buildingPreserved: boolean;
  perspectiveCoherent: boolean;
  scaleCoherent: boolean;
  placementCoherent: boolean;
  roofFaceCorrect: boolean;
  insideSelectedRoofFace: boolean;
  singleRoofPlane: boolean;
  crossesRidge: boolean;
  arrayGeometryConsistent: boolean;
  expectedFaceAllocationsMatched?: boolean;
  /** Dedicated photo-realism QA. These are intentionally independent from geometry. */
  photorealismScore?: number;
  materialRealistic?: boolean;
  lightingMatched?: boolean;
  reflectionsNatural?: boolean;
  contactShadowsNatural?: boolean;
  edgeIntegrationNatural?: boolean;
  localSharpnessMatched?: boolean;
  localNoiseCompressionMatched?: boolean;
  cgiArtifactsAbsent?: boolean;
  roofTexturePreserved?: boolean;
  issues: QualityIssue[];
  correctionPrompt: string;
}

export interface GenerationResult {
  context: ProjectContext;
  assets: GeneratedAsset[];
  quality: Record<number, QualityReport>;
}

export interface CrossPieceQualityReport {
  passed: boolean;
  score: number;
  samePanelCount: boolean;
  sameLayout: boolean;
  sameRoofFace: boolean;
  sameRelativePlacement: boolean;
  sameArrayIdentity: boolean;
  invalidDPs: Array<4|6>;
  issues: QualityIssue[];
  corrections: Array<{ dp: 4|6; correction: string }>;
}
