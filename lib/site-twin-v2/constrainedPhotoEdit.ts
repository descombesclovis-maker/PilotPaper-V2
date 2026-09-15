import "server-only";

import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";
import type { DpPieceInput, PiecePhotoInput } from "@/lib/pilotpaper-image2-types";
import { buildPanelIslandsMaskForPng } from "@/lib/dp-ai-engine/utils/maskPng";
import { decodePng, strictCompositePng } from "@/lib/dp-ai-engine/utils/pngPixels";
import { fetchGoogleSolarDataLayers, downloadGoogleGeoTiff } from "./googleSolarDataLayers";
import { buildSiteTwinDocumentContext } from "./dpPieceBridge";
import { projectSiteTwinModulesToPhoto } from "./geometryEngineClient";
import type { SiteTwinDocumentContext } from "./documentContext";

const IMAGE_MODEL = "gpt-image-2";
const EDIT_PADDING = 0.0035;

type Point = { x: number; y: number };

function base64ToBlob(base64: string, mimeType: string) {
  return new Blob([Buffer.from(base64, "base64")], { type: mimeType });
}

function pointInPolygon(x: number, y: number, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (((a.y > y) !== (b.y > y)) && x < ((b.x - a.x) * (y - a.y)) / ((b.y - a.y) || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

function changedIslandRatio(originalBase64: string, candidateBase64: string, polygons: Point[][]) {
  const original = decodePng(originalBase64);
  const candidate = decodePng(candidateBase64);
  if (original.width !== candidate.width || original.height !== candidate.height) return 0;
  let inside = 0;
  let changed = 0;
  for (let y = 0; y < original.height; y += 1) {
    for (let x = 0; x < original.width; x += 1) {
      const nx = (x + 0.5) / original.width;
      const ny = (y + 0.5) / original.height;
      if (!polygons.some((polygon) => pointInPolygon(nx, ny, polygon))) continue;
      inside += 1;
      const offset = (y * original.width + x) * 4;
      const delta = Math.abs(original.rgba[offset]! - candidate.rgba[offset]!)
        + Math.abs(original.rgba[offset + 1]! - candidate.rgba[offset + 1]!)
        + Math.abs(original.rgba[offset + 2]! - candidate.rgba[offset + 2]!);
      if (delta >= 24) changed += 1;
    }
  }
  return inside > 0 ? changed / inside : 0;
}

function insertionPrompt(input: DpPieceInput, context: SiteTwinDocumentContext, role: PiecePhotoInput["role"]) {
  const module = requireVerifiedPvModule(input.moduleReference ?? "");
  const faceId = context.layout.selectedFaceIds[0];
  const face = context.siteTwin.roof.faces.find((candidate) => candidate.id === faceId);
  return [
    "PILOTPAPER — GEOMETRY-LOCKED PHOTOVOLTAIC PHOTO EDIT.",
    "The editable transparent islands already encode the exact physical projection of the photovoltaic modules. Do NOT move, resize, merge, delete or add islands.",
    `Render exactly one realistic photovoltaic module inside each editable island. Total islands/modules: ${context.layout.modules.length}.`,
    `Module: ${module.manufacturer} ${module.canonicalReference}; real dimensions ${module.widthMm} × ${module.heightMm} × ${module.thicknessMm} mm; orientation ${context.layout.configuration.orientation}.`,
    `Physical roof face: ${face?.displayLabel ?? faceId}; slope ${face?.slopeDeg.toFixed(1) ?? "unknown"}°; azimuth ${face?.azimuthDeg.toFixed(1) ?? "unknown"}°; source role ${role}.`,
    "Keep the panel glass, frame, cell pattern, reflections, local lighting, roof contact and subtle shadows photorealistic and consistent with the existing photograph.",
    "Every module belongs to the same roof plane and must look like the same physical product under one camera perspective.",
    "Do not add labels, arrows, borders, masks, debug marks, people, tools or new architecture.",
    "Everything outside the editable islands is immutable and will be restored pixel-for-pixel by PilotPaper after generation.",
  ].join("\n");
}

export type ConstrainedPhotoInsertion = {
  context: SiteTwinDocumentContext;
  base64: string;
  sourcePngBase64: string;
  panelPolygonsNormalized: Point[][];
  registration: {
    reprojectionErrorPx: number;
    matches: number;
    inliers: number;
    inlierRatio: number;
    method: string;
  };
  changedIslandRatio: number;
};

export async function renderGeometryLockedPhotoInsertion(args: {
  input: DpPieceInput;
  photo: PiecePhotoInput;
}): Promise<ConstrainedPhotoInsertion> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Clé du moteur visuel absente du poste local.");
  const context = await buildSiteTwinDocumentContext(args.input);
  const [longitude, latitude] = context.siteTwin.addressPoint;
  const layers = await fetchGoogleSolarDataLayers({ latitude, longitude, radiusMeters: 70, pixelSizeMeters: 0.1 });
  if (!layers.rgbUrl) throw new Error("La référence orthophotographique métrique requise pour le recalage photo n'est pas disponible.");
  const referenceGeoTiff = await downloadGoogleGeoTiff(layers.rgbUrl, "RGB");
  const projection = await projectSiteTwinModulesToPhoto({
    origin: context.siteTwin.roof.origin,
    modulePolygonsLocalM: context.layout.modules.map((module) => module.polygonLocalM),
    referenceGeoTiff,
    photo: Buffer.from(args.photo.base64, "base64"),
    photoMimeType: args.photo.mimeType,
  });
  const polygons = projection.panelPolygonsNormalized;
  if (polygons.length !== context.layout.configuration.panelCount) {
    throw new Error(`Projection photo incomplète : ${polygons.length}/${context.layout.configuration.panelCount} modules.`);
  }
  const mask = buildPanelIslandsMaskForPng(projection.photoBase64, polygons, EDIT_PADDING);
  if (!mask) throw new Error("Le masque géométrique des panneaux n'a pas pu être construit.");

  const form = new FormData();
  form.set("model", IMAGE_MODEL);
  form.set("prompt", insertionPrompt(args.input, context, args.photo.role));
  form.set("quality", "high");
  form.append("image[]", base64ToBlob(projection.photoBase64, "image/png"), "immutable-source.png");
  form.set("mask", base64ToBlob(mask, "image/png"), "panel-islands-mask.png");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) throw new Error(`Moteur visuel indisponible (${response.status}).`);
  const json = await response.json() as { data?: Array<{ b64_json?: string }> };
  const rawCandidate = json.data?.[0]?.b64_json;
  if (!rawCandidate) throw new Error("Le moteur visuel n'a produit aucune insertion.");

  const base64 = strictCompositePng(projection.photoBase64, rawCandidate, polygons, EDIT_PADDING);
  const changeRatio = changedIslandRatio(projection.photoBase64, base64, polygons);
  if (changeRatio < 0.12) {
    throw new Error(`Insertion visuelle insuffisante : seulement ${Math.round(changeRatio * 100)} % des pixels des zones PV ont été réellement modifiés.`);
  }

  return {
    context,
    base64,
    sourcePngBase64: projection.photoBase64,
    panelPolygonsNormalized: polygons,
    registration: {
      reprojectionErrorPx: projection.registration.reprojectionErrorPx,
      matches: projection.registration.matches,
      inliers: projection.registration.inliers,
      inlierRatio: projection.registration.inlierRatio,
      method: projection.registration.method,
    },
    changedIslandRatio: changeRatio,
  };
}
