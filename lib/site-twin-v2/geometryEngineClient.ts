import type { SiteTwinPropertyLock } from "./propertyLock";
import type { SiteTwinRoofEdge, SiteTwinRoofFace, TwinLonLat } from "./types";
import { SiteTwinError } from "./errors";

export type GeometryEngineRoofResult = {
  engineVersion: string;
  source: "google-dsm" | "ign-mns" | "ign-lidar" | "photogrammetry";
  origin: TwinLonLat;
  faces: SiteTwinRoofFace[];
  edges: SiteTwinRoofEdge[];
  confidence: number;
  diagnostics: string[];
};

function geometryEngineUrl() {
  return (process.env.PILOTPAPER_GEOMETRY_ENGINE_URL || "http://127.0.0.1:8765").replace(/\/$/, "");
}

export async function checkGeometryEngine() {
  const url = `${geometryEngineUrl()}/health`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000), cache: "no-store" });
    if (!response.ok) return { available: false as const, reason: `HTTP ${response.status}` };
    const payload = await response.json() as { ok?: boolean; version?: string; capabilities?: string[] };
    return {
      available: payload.ok === true,
      version: payload.version,
      capabilities: payload.capabilities ?? [],
      reason: payload.ok === true ? undefined : "Réponse health invalide",
    };
  } catch (error) {
    return { available: false as const, reason: error instanceof Error ? error.message : "Moteur géométrique inaccessible" };
  }
}

function assertGeometryResult(value: unknown): asserts value is GeometryEngineRoofResult {
  if (!value || typeof value !== "object") {
    throw new SiteTwinError("GEOMETRY_RECONSTRUCTION_FAILED", "Le moteur géométrique a renvoyé une réponse invalide.");
  }
  const result = value as Partial<GeometryEngineRoofResult>;
  if (!Array.isArray(result.origin) || result.origin.length !== 2) {
    throw new SiteTwinError("GEOMETRY_RECONSTRUCTION_FAILED", "Le moteur géométrique n'a pas fourni d'origine métrique.");
  }
  if (!Array.isArray(result.faces) || !result.faces.length) {
    throw new SiteTwinError("GEOMETRY_RECONSTRUCTION_FAILED", "Le moteur géométrique n'a reconstruit aucun pan physique.");
  }
  for (const face of result.faces) {
    if (!face.id || !face.buildingId || !Array.isArray(face.polygonLocalM) || face.polygonLocalM.length < 3) {
      throw new SiteTwinError("GEOMETRY_RECONSTRUCTION_FAILED", "Un pan reconstruit est incomplet ou non rattaché au bâtiment cible.");
    }
    if (!(face.areaM2 > 0) || !Number.isFinite(face.slopeDeg) || !Number.isFinite(face.azimuthDeg)) {
      throw new SiteTwinError("GEOMETRY_RECONSTRUCTION_FAILED", `Géométrie métrique invalide pour le pan ${face.id}.`);
    }
  }
}

export async function reconstructRoofWithGeometryEngine(args: {
  property: SiteTwinPropertyLock;
  source: GeometryEngineRoofResult["source"];
  elevationGeoTiff?: Uint8Array;
  pointCloud?: Uint8Array;
  imagery?: Uint8Array;
}): Promise<GeometryEngineRoofResult> {
  if (!args.elevationGeoTiff && !args.pointCloud) {
    throw new SiteTwinError("GEOMETRY_RECONSTRUCTION_FAILED", "Aucune donnée altimétrique n'a été fournie au moteur géométrique.");
  }

  const data = new FormData();
  data.set("source", args.source);
  data.set("property", JSON.stringify(args.property));
  if (args.elevationGeoTiff) {
    data.set("elevation", new Blob([args.elevationGeoTiff], { type: "image/tiff" }), "elevation.tif");
  }
  if (args.pointCloud) {
    data.set("point_cloud", new Blob([args.pointCloud], { type: "application/octet-stream" }), "roof.laz");
  }
  if (args.imagery) {
    data.set("imagery", new Blob([args.imagery], { type: "image/tiff" }), "imagery.tif");
  }

  let response: Response;
  try {
    response = await fetch(`${geometryEngineUrl()}/v1/roof/reconstruct`, {
      method: "POST",
      body: data,
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Moteur géométrique inaccessible.";
    const isTimeout = /timeout|aborted/i.test(message);
    throw new SiteTwinError(
      isTimeout ? "GEOMETRY_ENGINE_TIMEOUT" : "GEOMETRY_ENGINE_OFFLINE",
      isTimeout
        ? "Le moteur géométrique a dépassé le délai autorisé."
        : "Le moteur géométrique local n'est pas disponible.",
      { recoverable: true, cause: error },
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new SiteTwinError(
      "GEOMETRY_RECONSTRUCTION_FAILED",
      `Reconstruction géométrique refusée (${response.status})${body ? ` : ${body.slice(0, 400)}` : ""}.`,
      { recoverable: true },
    );
  }
  const result = await response.json() as unknown;
  assertGeometryResult(result);
  return result;
}
