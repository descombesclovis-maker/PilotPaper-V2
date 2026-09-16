export type TwinLonLat = [longitude: number, latitude: number];
export type TwinXY = { x: number; y: number };
export type TwinXYZ = { x: number; y: number; z: number };

export type SiteTwinEvidenceSource =
  | "address"
  | "cadastre"
  | "bdtopo"
  | "ign-ortho"
  | "ign-lidar-hd"
  | "ign-mns"
  | "google-solar"
  | "google-solar-dsm"
  | "google-3d-tiles"
  | "advanced-roof-model"
  | "photogrammetry"
  | "lightglue"
  | "user-photo"
  | "vision"
  | "user-correction";

export type SiteTwinEvidence = {
  source: SiteTwinEvidenceSource;
  confidence: number;
  capturedAt?: string;
  reference?: string;
  notes?: string[];
};

export type SiteTwinParcel = {
  reference: string;
  polygonLonLat: TwinLonLat[];
  areaM2?: number;
};

export type SiteTwinBuilding = {
  id: string;
  polygonLonLat: TwinLonLat[];
  heightM?: number;
  evidence: SiteTwinEvidence[];
};

export type SiteTwinRoofEdgeKind = "eave" | "ridge" | "hip" | "valley" | "party" | "unknown";

export type SiteTwinRoofEdge = {
  id: string;
  a: TwinXYZ;
  b: TwinXYZ;
  kind: SiteTwinRoofEdgeKind;
  adjacentFaceIds: string[];
};

export type SiteTwinObstacle = {
  id: string;
  type: "chimney" | "roof-window" | "vent" | "antenna" | "dormer" | "parapet" | "other";
  polygonLocalM: TwinXY[];
  heightM?: number;
  keepoutMm?: number;
  evidence: SiteTwinEvidence[];
};

export type SiteTwinRoofFace = {
  id: string;
  displayLabel: string;
  buildingId: string;
  polygonLocalM: TwinXY[];
  polygonLonLat?: TwinLonLat[];
  plane: { a: number; b: number; c: number };
  slopeDeg: number;
  azimuthDeg: number;
  areaM2: number;
  centerLocalM: TwinXY;
  edgeIds: string[];
  obstacles: SiteTwinObstacle[];
  evidence: SiteTwinEvidence[];
  confidence: number;
};

export type SiteTwinRoof = {
  origin: TwinLonLat;
  faces: SiteTwinRoofFace[];
  edges: SiteTwinRoofEdge[];
};

export type SiteTwinPhoto = {
  id: string;
  role: "near" | "roof" | "far";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  widthPx: number;
  heightPx: number;
  digest: string;
};

export type SiteTwinCameraRegistration = {
  photoId: string;
  status: "unregistered" | "automatic" | "confirmed" | "manual";
  homography?: [number, number, number, number, number, number, number, number, number];
  reprojectionErrorPx?: number;
  evidence: SiteTwinEvidence[];
};

export type SiteTwinRoofFacetComparison = {
  localFaceId: string;
  localDisplayLabel: string;
  remoteFacetId: string;
  azimuthDeltaDeg: number | null;
  slopeDeltaDeg: number | null;
  areaRelativeError: number | null;
  metricCount: number;
  status: "agreement" | "conflict";
};

export type SiteTwinRoofCrossCheck = {
  source: "advanced-roof-model";
  localFaceCount: number;
  remoteFacetCount: number;
  matchedFacetCount: number;
  comparableFacetCount: number;
  agreementCount: number;
  conflictCount: number;
  closeRatio: number;
  blockingConflict: boolean;
  status: "not-comparable" | "consistent" | "conflict";
  comparisons: SiteTwinRoofFacetComparison[];
};

export type SiteTwinSources = {
  lidar: "available" | "unavailable" | "not-checked";
  lidarReference?: string;
  terrainElevationM?: number;
  orthoReference?: string;
  googleSolarBuildingCenter?: TwinLonLat;
  googleDsmReference?: string;
  google3dTilesReference?: string;
  photogrammetryReference?: string;
  geometryEngineVersion?: string;
  geometryPrimarySource?: "google-dsm" | "ign-mns" | "ign-lidar" | "photogrammetry" | "advanced-roof-model";
  advancedRoofProjectId?: number;
  advancedRoofFacetCount?: number;
  advancedRoofAutoDesignAvailable?: boolean;
  advancedRoofCrossCheck?: SiteTwinRoofCrossCheck;
};

export type SiteTwin = {
  version: "pilotpaper-site-twin-v2";
  id: string;
  address: string;
  normalizedAddress: string;
  addressPoint: TwinLonLat;
  parcel: SiteTwinParcel;
  buildings: SiteTwinBuilding[];
  targetBuildingIds: string[];
  roof: SiteTwinRoof;
  photos: SiteTwinPhoto[];
  cameraRegistrations: SiteTwinCameraRegistration[];
  sources: SiteTwinSources;
  evidence: SiteTwinEvidence[];
  confidence: number;
  revision: number;
};

export type PvConfiguration = {
  moduleReference: string;
  moduleWidthMm: number;
  moduleHeightMm: number;
  panelCount: number;
  rows: number;
  columns: number;
  orientation: "portrait" | "landscape";
  interPanelGapMm: number;
  preferredGutterClearanceMm: number;
  placement: "centered" | "left" | "right" | "custom";
};

export type PvFaceEligibility = {
  faceId: string;
  fits: boolean;
  maximumPanelCount: number;
  resolvedRows?: number;
  resolvedColumns?: number;
  resolvedGutterClearanceMm?: number;
  reasons: string[];
};

export type PvModulePlacement = {
  moduleIndex: number;
  faceId: string;
  polygonLocalM: TwinXY[];
};

export type PvLayoutSnapshot = {
  siteTwinId: string;
  siteTwinRevision: number;
  configuration: PvConfiguration;
  selectedFaceIds: string[];
  eligibility: PvFaceEligibility[];
  modules: PvModulePlacement[];
};

export type SiteTwinCorrection =
  | { type: "confirm-target-building"; buildingIds: string[] }
  | { type: "exclude-building"; buildingId: string }
  | { type: "add-roof-face"; face: SiteTwinRoofFace }
  | { type: "remove-roof-face"; faceId: string }
  | { type: "split-roof-face"; faceId: string; splitLine: [TwinXY, TwinXY] }
  | { type: "merge-roof-faces"; faceIds: string[] }
  | { type: "move-roof-vertex"; faceId: string; vertexIndex: number; point: TwinXY }
  | { type: "confirm-camera-registration"; photoId: string };

export type SiteTwinRegressionExpectation = {
  address: string;
  expectedTargetBuildingCount?: number;
  expectedRoofFaceCount?: number;
  expectedRoofFaceIds?: string[];
  expectedCompatibleFaceCount?: number;
  notes?: string[];
};
