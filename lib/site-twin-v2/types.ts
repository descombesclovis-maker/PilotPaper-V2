export type TwinLonLat = [longitude: number, latitude: number];
export type TwinXY = { x: number; y: number };
export type TwinXYZ = { x: number; y: number; z: number };

export type SiteTwinEvidenceSource =
  | "address"
  | "cadastre"
  | "bdtopo"
  | "ign-ortho"
  | "ign-lidar-hd"
  | "google-solar"
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

/**
 * One physical roof plane. `id` is stable and must NEVER depend on display
 * lettering or on the requested PV configuration.
 */
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
  /** SHA-256 of normalized image bytes. */
  digest: string;
};

export type SiteTwinCameraRegistration = {
  photoId: string;
  status: "unregistered" | "automatic" | "confirmed" | "manual";
  /** 3x3 homography from one selected roof plane to the normalized photo. */
  homography?: [number, number, number, number, number, number, number, number, number];
  reprojectionErrorPx?: number;
  evidence: SiteTwinEvidence[];
};

export type SiteTwinSources = {
  lidar: "available" | "unavailable" | "not-checked";
  lidarReference?: string;
  orthoReference?: string;
  googleSolarBuildingCenter?: TwinLonLat;
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
  /** Changes only when the physical site model changes. */
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

/**
 * Eligibility is deliberately separate from roof detection. A real roof face
 * must remain visible even when the current PV configuration does not fit.
 */
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
