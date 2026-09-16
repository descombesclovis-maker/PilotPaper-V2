import type { SiteTwinPropertyLock } from "./propertyLock";
import type { SiteTwinRoofEdge, SiteTwinRoofFace, TwinLonLat } from "./types";
import type { IgnElevationPoint, IgnCopcTile } from "./ignLidar";
import { SiteTwinError } from "./errors";

export type GeometryEngineRoofResult = {
  engineVersion: string;
  source: "google-dsm" | "ign-mns" | "ign-lidar" | "photogrammetry" | "advanced-roof-model";
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

async function postGeometry(data: FormData) {
  let response: Response;
  try {
    response = await fetch(`${geometryEngineUrl()}/v1/roof/reconstruct`, {
      method: "POST",
      body: data,
      signal: AbortSignal.timeout(150_000),
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
      `Reconstruction géométrique refusée (${response.status})${body ? ` : ${body.slice(0, 500)}` : ""}.`,
      { recoverable: true },
    );
  }
  const result = await response.json() as unknown;
  assertGeometryResult(result);
  return result;
}

export async function reconstructRoofWithGeometryEngine(args: {
  property: SiteTwinPropertyLock;
  source: Exclude<GeometryEngineRoofResult["source"], "advanced-roof-model">;
  elevationGeoTiff?: Uint8Array;
  pointCloud?: Uint8Array;
  sampledPoints?: IgnElevationPoint[];
  copcTiles?: IgnCopcTile[];
  imagery?: Uint8Array;
}): Promise<GeometryEngineRoofResult> {
  if (!args.elevationGeoTiff && !args.pointCloud && !args.sampledPoints?.length && !args.copcTiles?.length) {
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
  if (args.sampledPoints?.length) {
    data.set("sampled_points", JSON.stringify(args.sampledPoints));
  }
  if (args.copcTiles?.length) {
    data.set("copc_tiles", JSON.stringify(args.copcTiles));
  }
  if (args.imagery) {
    data.set("imagery", new Blob([args.imagery], { type: "image/tiff" }), "imagery.tif");
  }
  return postGeometry(data);
}

export type PhotoRegistrationResult = {
  homography: [number, number, number, number, number, number, number, number, number];
  reprojectionErrorPx: number;
  matches: number;
  inliers: number;
  inlierRatio?: number;
  method: string;
  diagnostics: string[];
};

export async function registerPhotoWithGeometryEngine(args: {
  reference: Uint8Array;
  referenceMimeType: string;
  photo: Uint8Array;
  photoMimeType: string;
}): Promise<PhotoRegistrationResult> {
  const data = new FormData();
  data.set("reference", new Blob([args.reference], { type: args.referenceMimeType }), "reference-image");
  data.set("photo", new Blob([args.photo], { type: args.photoMimeType }), "project-photo");
  const response = await fetch(`${geometryEngineUrl()}/v1/photo/register`, {
    method: "POST",
    body: data,
    signal: AbortSignal.timeout(90_000),
    cache: "no-store",
  }).catch((error) => {
    throw new SiteTwinError("CAMERA_REGISTRATION_FAILED", "Le moteur de recalage photo n'a pas répondu.", {
      recoverable: true,
      cause: error,
    });
  });
  if (!response.ok) {
    throw new SiteTwinError(
      "CAMERA_REGISTRATION_FAILED",
      `Recalage photo refusé (${response.status}) : ${(await response.text()).slice(0, 500)}`,
      { recoverable: true },
    );
  }
  const result = await response.json() as PhotoRegistrationResult;
  if (!Array.isArray(result.homography) || result.homography.length !== 9 || !Number.isFinite(result.reprojectionErrorPx)) {
    throw new SiteTwinError("CAMERA_REGISTRATION_FAILED", "Le moteur photo a renvoyé une homographie invalide.");
  }
  return result;
}

export type SiteTwinPhotoProjection = {
  mimeType: "image/png";
  photoBase64: string;
  widthPx: number;
  heightPx: number;
  panelPolygonsNormalized: Array<Array<{ x: number; y: number }>>;
  registration: PhotoRegistrationResult & { inlierRatio: number };
};

export type SiteTwinProjectionReference = {
  bytes: Uint8Array;
  mimeType: "image/tiff" | "image/png";
  crs?: string;
  bbox?: [number, number, number, number];
};

export async function projectSiteTwinModulesToPhoto(args: {
  modulePolygonsLonLat: TwinLonLat[][];
  reference: SiteTwinProjectionReference;
  photo: Uint8Array;
  photoMimeType: string;
}): Promise<SiteTwinPhotoProjection> {
  if (
    !args.modulePolygonsLonLat.length
    || args.modulePolygonsLonLat.some((polygon) => (
      polygon.length !== 4
      || polygon.some((point) => point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))
    ))
  ) {
    throw new SiteTwinError("CAMERA_REGISTRATION_FAILED", "La projection photo exige quatre coins géographiques valides par module.");
  }
  if (!args.reference.bytes.length) {
    throw new SiteTwinError("CAMERA_REGISTRATION_FAILED", "La référence de recalage photographique est vide.");
  }
  if ((args.reference.crs && !args.reference.bbox) || (!args.reference.crs && args.reference.bbox)) {
    throw new SiteTwinError("CAMERA_REGISTRATION_FAILED", "La référence raster explicite exige à la fois un CRS et un BBOX.");
  }
  if (args.reference.bbox && (
    args.reference.bbox.length !== 4
    || args.reference.bbox.some((value) => !Number.isFinite(value))
    || args.reference.bbox[2] <= args.reference.bbox[0]
    || args.reference.bbox[3] <= args.reference.bbox[1]
  )) {
    throw new SiteTwinError("CAMERA_REGISTRATION_FAILED", "Le BBOX de la référence photographique est invalide.");
  }

  const data = new FormData();
  data.set("module_polygons_lonlat", JSON.stringify(args.modulePolygonsLonLat));
  const extension = args.reference.mimeType === "image/png" ? "png" : "tif";
  data.set("reference", new Blob([args.reference.bytes], { type: args.reference.mimeType }), `site-reference.${extension}`);
  if (args.reference.crs && args.reference.bbox) {
    data.set("reference_crs", args.reference.crs);
    data.set("reference_bbox", JSON.stringify(args.reference.bbox));
  }
  data.set("photo", new Blob([args.photo], { type: args.photoMimeType }), "project-photo");

  let response: Response;
  try {
    response = await fetch(`${geometryEngineUrl()}/v1/site-twin/project-modules`, {
      method: "POST",
      body: data,
      signal: AbortSignal.timeout(150_000),
      cache: "no-store",
    });
  } catch (error) {
    throw new SiteTwinError("CAMERA_REGISTRATION_FAILED", "La projection déterministe sur la photographie n'a pas répondu.", {
      recoverable: true,
      cause: error,
    });
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new SiteTwinError(
      "CAMERA_REGISTRATION_FAILED",
      `Projection photographique refusée (${response.status})${body ? ` : ${body.slice(0, 500)}` : ""}.`,
      { recoverable: true },
    );
  }
  const result = await response.json() as SiteTwinPhotoProjection;
  if (
    result.mimeType !== "image/png"
    || !result.photoBase64
    || !Number.isFinite(result.widthPx)
    || !Number.isFinite(result.heightPx)
    || result.widthPx <= 0
    || result.heightPx <= 0
    || !Array.isArray(result.panelPolygonsNormalized)
    || result.panelPolygonsNormalized.length !== args.modulePolygonsLonLat.length
    || result.panelPolygonsNormalized.some((polygon) => polygon.length !== 4)
    || !Number.isFinite(result.registration?.reprojectionErrorPx)
    || !Number.isFinite(result.registration?.inliers)
    || !Number.isFinite(result.registration?.matches)
    || !Number.isFinite(result.registration?.inlierRatio)
    || !result.registration?.method
  ) {
    throw new SiteTwinError("CAMERA_REGISTRATION_FAILED", "La projection photographique a renvoyé un résultat incomplet.");
  }
  return result;
}
