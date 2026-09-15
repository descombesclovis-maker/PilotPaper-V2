import type { SiteTwinPieceReceipt } from "./site-twin-v2/documentContext";

export type DPNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type PhotoRole = "near" | "roof" | "far";

export type PiecePhotoInput = {
  role: PhotoRole;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
  filename?: string;
};

export type VisualReference = {
  dp: 2 | 3 | 4 | 5;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  base64: string;
  geometryReceipt?: SiteTwinPieceReceipt;
};

export type DpPieceInput = {
  dp: DPNumber;
  address: string;
  moduleReference?: string;
  panelCount?: number;
  rows?: number;
  columns?: number;
  orientation?: "portrait" | "landscape";
  placement?: "centered" | "left" | "right" | "custom";
  instructions?: string;
  roofWidthMm?: number;
  roofSlopeLengthMm?: number;
  roofSlopeDeg?: number;
  gutterClearanceMm?: number;
  interPanelGapMm?: number;
  mountingSystem?: string;
  photos?: PiecePhotoInput[];
  references?: VisualReference[];
  /** In diagnostic test mode, rejected candidates should be preserved instead of hidden whenever a candidate exists. */
  testMode?: boolean;
};

export type DpInspectorResult = {
  passed: boolean;
  score: number;
  checks: string[];
  issues: string[];
};

export type DpPieceOutput = {
  dp: DPNumber;
  title: string;
  validationStatus: "test_unverified";
  mimeType: string;
  base64?: string;
  text?: string;
  sourceSummary: string[];
  inspector: DpInspectorResult;
  geometryReceipt?: SiteTwinPieceReceipt;
};
