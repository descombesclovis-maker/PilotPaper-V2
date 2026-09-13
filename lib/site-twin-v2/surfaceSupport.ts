import type { SiteTwin, SiteTwinEvidence, SiteTwinObstacle, TwinXY } from "./types";

export type SurfaceSupportKind =
  | "pitched-roof"
  | "flat-roof"
  | "ground"
  | "carport"
  | "canopy"
  | "facade";

export type SurfaceSupport = {
  id: string;
  kind: SurfaceSupportKind;
  polygonLocalM: TwinXY[];
  slopeDeg: number;
  azimuthDeg: number;
  areaM2: number;
  obstacles: SiteTwinObstacle[];
  evidence: SiteTwinEvidence[];
  confidence: number;
  sourceEntityId: string;
};

/**
 * V1 currently adapts canonical roof faces into the generic support model.
 * V2/V3 can add flat roof, ground, carport, canopy and facade adapters without
 * changing the deterministic PV layout contract.
 */
export function roofSurfaceSupports(twin: SiteTwin): SurfaceSupport[] {
  return twin.roof.faces.map((face) => ({
    id: `support:${face.id}`,
    kind: face.slopeDeg <= 5 ? "flat-roof" : "pitched-roof",
    polygonLocalM: face.polygonLocalM,
    slopeDeg: face.slopeDeg,
    azimuthDeg: face.azimuthDeg,
    areaM2: face.areaM2,
    obstacles: face.obstacles,
    evidence: face.evidence,
    confidence: face.confidence,
    sourceEntityId: face.id,
  }));
}
