import type { LonLat, ParcelGeometry } from "../context/officialParcel";
import type { MetricPoint2D, RoofFaceMetricGeometry } from "../types";

export type SiteModelMode = "automatic" | "assisted";
export type SiteModelEvidenceKind = "cadastre" | "bdtopo" | "lidar-altimetry" | "orthophoto" | "photo" | "manual";

export type SiteModelEvidence = {
  kind: SiteModelEvidenceKind;
  source: string;
  confidence: number;
  notes?: string[];
};

export type BuildingFootprint = {
  id: string;
  polygon: LonLat[];
  centroid: LonLat;
  areaM2?: number;
  heightM?: number;
  source: "BDTOPO_V3:batiment" | "assisted-selection";
};

export type LidarHeightSample = {
  longitude: number;
  latitude: number;
  surfaceZ: number;
  terrainZ?: number;
  heightM?: number;
};

export type RoofPlaneModel = {
  id: string;
  confidence: number;
  slopeDeg: number;
  azimuthDeg: number;
  /** Local ground-plane polygon in metres. */
  polygonLocalM: Array<{ x: number; y: number }>;
  /** Four ordered corners BL, BR, TR, TL used for deterministic projection. */
  projectionQuadLocalM: [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  plane: { a: number; b: number; c: number };
  rmsErrorM: number;
  sampleCount: number;
};

export type SiteObstacle = {
  id: string;
  type: "unknown" | "chimney" | "roof_window" | "vent" | "antenna" | "mast" | "other";
  roofPlaneId: string;
  confidence: number;
  polygonLocalM: Array<{ x: number; y: number }>;
  maxHeightAbovePlaneM: number;
  keepoutMarginMm: number;
  source: "lidar-residual" | "manual";
};

export type SiteRoofModel = {
  origin: LonLat;
  planes: RoofPlaneModel[];
  obstacles: SiteObstacle[];
  lidarSamples: LidarHeightSample[];
  coverageConfidence: number;
};

export type SiteModel = {
  version: "pilotpaper-site-model-v1";
  mode: SiteModelMode;
  address: string;
  parcel: {
    reference: string;
    areaM2: number;
    geometry: ParcelGeometry;
  };
  building: BuildingFootprint;
  roof: SiteRoofModel;
  evidence: SiteModelEvidence[];
  warnings: string[];
};

export type SiteModelRoofFace = {
  sitePlane: RoofPlaneModel;
  metricGeometry: RoofFaceMetricGeometry;
  /** Same physical support represented in local ground coordinates. */
  projectionQuadLocalM: RoofPlaneModel["projectionQuadLocalM"];
  keepoutsMm: Array<{ id: string; polygonMm: MetricPoint2D[] }>;
};
