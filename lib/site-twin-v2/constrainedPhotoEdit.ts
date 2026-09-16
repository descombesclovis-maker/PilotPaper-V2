import "server-only";

import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";
import type { DpPieceInput, PiecePhotoInput } from "@/lib/pilotpaper-image2-types";
import { buildPanelIslandsMaskForPng } from "@/lib/dp-ai-engine/utils/maskPng";
import {
  annotatePngWithPanelPolygons,
  decodePng,
  encodePng,
  geometryLockedCompositePng,
} from "@/lib/dp-ai-engine/utils/pngPixels";
import { fetchGoogleSolarDataLayers, downloadGoogleGeoTiff } from "./googleSolarDataLayers";
import { fetchIgnOrthophotoGeoTiff } from "./ignOrthophoto";
import { buildSiteTwinDocumentContext } from "./dpPieceBridge";
import { projectSiteTwinModulesToPhoto } from "./geometryEngineClient";
import { inspectProjectedModuleGeometry, requireInspectorPass } from "./inspector";
import { modulePolygonsToLonLat } from "./localGeoTransform";
import { SITE_TWIN_POLICY } from "./policy";
import type { SiteTwinDocumentContext } from "./documentContext";

const IMAGE_MODEL = "gpt-image-2";
const AI_EDIT_PADDING = 0.004;
const COMPOSITE_FEATHER_PIXELS = 4;
const OUTSIDE_BLEND_MAX = 0.18;
const LOCAL_CROP_MARGIN_FACTOR = 0.35;
const LOCAL_CROP_MIN_MARGIN_PX = 72;
const MIN_AGGREGATE_PANEL_CHANGE_RATIO = 0.15;
const MIN_SINGLE_PANEL_CHANGE_RATIO = 0.08;

type Point = { x: number; y: number };
type CropRegion = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  height: number;
  pngBase64: string;
  polygonsNormalized: Point[][];
};

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

function polygonAreaNormalized(polygon: Point[]) {
  let twiceArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twiceArea) / 2;
}

function changedRatioForPolygon(original: ReturnType<typeof decodePng>, candidate: ReturnType<typeof decodePng>, polygon: Point[]) {
  let inside = 0;
  let changed = 0;
  for (let y = 0; y < original.height; y += 1) {
    for (let x = 0; x < original.width; x += 1) {
      const nx = (x + 0.5) / original.width;
      const ny = (y + 0.5) / original.height;
      if (!pointInPolygon(nx, ny, polygon)) continue;
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

function changedIslandRatios(originalBase64: string, candidateBase64: string, polygons: Point[][]) {
  const original = decodePng(originalBase64);
  const candidate = decodePng(candidateBase64);
  if (original.width !== candidate.width || original.height !== candidate.height) {
    throw new Error("Le composite final n'a pas les mêmes dimensions que la photographie source.");
  }
  return polygons.map((polygon) => changedRatioForPolygon(original, candidate, polygon));
}

function changedIslandRatio(originalBase64: string, candidateBase64: string, polygons: Point[][]) {
  const ratios = changedIslandRatios(originalBase64, candidateBase64, polygons);
  if (!ratios.length) return 0;
  return ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function expandCropToMaximumAspect(region: { x0: number; y0: number; x1: number; y1: number }, imageWidth: number, imageHeight: number) {
  let { x0, y0, x1, y1 } = region;
  const width = () => x1 - x0;
  const height = () => y1 - y0;
  if (width() / height() > 3) {
    const wantedHeight = width() / 3;
    const extra = wantedHeight - height();
    y0 -= extra / 2;
    y1 += extra / 2;
  } else if (height() / width() > 3) {
    const wantedWidth = height() / 3;
    const extra = wantedWidth - width();
    x0 -= extra / 2;
    x1 += extra / 2;
  }
  if (x0 < 0) { x1 -= x0; x0 = 0; }
  if (y0 < 0) { y1 -= y0; y0 = 0; }
  if (x1 > imageWidth) { x0 -= x1 - imageWidth; x1 = imageWidth; }
  if (y1 > imageHeight) { y0 -= y1 - imageHeight; y1 = imageHeight; }
  return {
    x0: clamp(Math.floor(x0), 0, Math.max(0, imageWidth - 1)),
    y0: clamp(Math.floor(y0), 0, Math.max(0, imageHeight - 1)),
    x1: clamp(Math.ceil(x1), 1, imageWidth),
    y1: clamp(Math.ceil(y1), 1, imageHeight),
  };
}

function cropAroundPanelField(base64: string, polygons: Point[][]): CropRegion {
  const source = decodePng(base64);
  if (!polygons.length) throw new Error("Le crop HD exige au moins un polygone photovoltaïque.");
  const points = polygons.flat();
  const minX = Math.min(...points.map((point) => point.x)) * source.width;
  const maxX = Math.max(...points.map((point) => point.x)) * source.width;
  const minY = Math.min(...points.map((point) => point.y)) * source.height;
  const maxY = Math.max(...points.map((point) => point.y)) * source.height;
  const fieldWidth = Math.max(1, maxX - minX);
  const fieldHeight = Math.max(1, maxY - minY);
  const marginX = Math.max(LOCAL_CROP_MIN_MARGIN_PX, fieldWidth * LOCAL_CROP_MARGIN_FACTOR);
  const marginY = Math.max(LOCAL_CROP_MIN_MARGIN_PX, fieldHeight * LOCAL_CROP_MARGIN_FACTOR);
  const bounds = expandCropToMaximumAspect({
    x0: minX - marginX,
    y0: minY - marginY,
    x1: maxX + marginX,
    y1: maxY + marginY,
  }, source.width, source.height);
  const width = bounds.x1 - bounds.x0;
  const height = bounds.y1 - bounds.y0;
  if (width < 32 || height < 32) throw new Error("Le crop HD du champ photovoltaïque est trop petit.");
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = ((bounds.y0 + y) * source.width + (bounds.x0 + x)) * 4;
      const targetOffset = (y * width + x) * 4;
      rgba[targetOffset] = source.rgba[sourceOffset]!;
      rgba[targetOffset + 1] = source.rgba[sourceOffset + 1]!;
      rgba[targetOffset + 2] = source.rgba[sourceOffset + 2]!;
      rgba[targetOffset + 3] = source.rgba[sourceOffset + 3]!;
    }
  }
  const remapped = polygons.map((polygon) => polygon.map((point) => ({
    x: ((point.x * source.width) - bounds.x0) / width,
    y: ((point.y * source.height) - bounds.y0) / height,
  })));
  return {
    ...bounds,
    width,
    height,
    pngBase64: encodePng(width, height, rgba),
    polygonsNormalized: remapped,
  };
}

/**
 * GPT Image currently accepts only fixed image sizes or `auto` for edits.
 * `auto` is deliberately used here so the service chooses the closest supported
 * canvas without PilotPaper sending an invalid arbitrary 2048×N value.
 */
function imageEditSize(_width: number, _height: number) {
  return "auto";
}

function resizeRgba(source: { width: number; height: number; rgba: Uint8Array }, width: number, height: number) {
  if (source.width === width && source.height === height) return source.rgba;
  const output = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = clamp((y + 0.5) * source.height / height - 0.5, 0, source.height - 1);
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const wy = sourceY - y0;
    for (let x = 0; x < width; x += 1) {
      const sourceX = clamp((x + 0.5) * source.width / width - 0.5, 0, source.width - 1);
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(source.width - 1, x0 + 1);
      const wx = sourceX - x0;
      const destination = (y * width + x) * 4;
      const topLeft = (y0 * source.width + x0) * 4;
      const topRight = (y0 * source.width + x1) * 4;
      const bottomLeft = (y1 * source.width + x0) * 4;
      const bottomRight = (y1 * source.width + x1) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = source.rgba[topLeft + channel]! * (1 - wx) + source.rgba[topRight + channel]! * wx;
        const bottom = source.rgba[bottomLeft + channel]! * (1 - wx) + source.rgba[bottomRight + channel]! * wx;
        output[destination + channel] = Math.round(top * (1 - wy) + bottom * wy));
      }
    }
  }
  return output;
}

function restoreCropIntoFullImage(fullSourceBase64: string, cropCandidateBase64: string, crop: CropRegion) {
  const full = decodePng(fullSourceBase64);
  const candidate = decodePng(cropCandidateBase64);
  if (candidate.width < 256 || candidate.height < 256) {
    throw new Error(`Le moteur visuel a renvoyé une image trop petite (${candidate.width}×${candidate.height}).`);
  }
  const candidatePixels = resizeRgba(candidate, crop.width, crop.height);
  const output = new Uint8Array(full.rgba);
  for (let y = 0; y < crop.height; y += 1) {
    for (let x = 0; x < crop.width; x += 1) {
      const sourceOffset = (y * crop.width + x) * 4;
      const destinationOffset = ((crop.y0 + y) * full.width + (crop.x0 + x)) * 4;
      output[destinationOffset] = candidatePixels[sourceOffset]!;
      output[destinationOffset + 1] = candidatePixels[sourceOffset + 1]!;
      output[destinationOffset + 2] = candidatePixels[sourceOffset + 2]!;
      output[destinationOffset + 3] = candidatePixels[sourceOffset + 3]!;
    }
  }
  return encodePng(full.width, full.height, output);
}

function assertProjectionUsable(args: {
  photoWidth: number;
  photoHeight: number;
  polygons: Point[][];
  expectedCount: number;
  registration: {
    reprojectionErrorPx: number;
    matches: number;
    inliers: number;
    inlierRatio: number;
    method: string;
  };
  role: PiecePhotoInput["role"];
}) {
  if (args.photoWidth < 320 || args.photoHeight < 240) {
    throw new Error(`Photographie normalisée trop petite pour une insertion fiable (${args.photoWidth}×${args.photoHeight}).`);
  }
  requireInspectorPass(inspectProjectedModuleGeometry(args.polygons, args.expectedCount));
  if (args.registration.reprojectionErrorPx > SITE_TWIN_POLICY.maximumAutomaticReprojectionErrorPx) {
    throw new Error(`Recalage photo trop imprécis : ${args.registration.reprojectionErrorPx.toFixed(1)} px (maximum ${SITE_TWIN_POLICY.maximumAutomaticReprojectionErrorPx} px).`);
  }
  if (args.registration.inliers < SITE_TWIN_POLICY.minimumAutomaticCameraInliers) {
    throw new Error(`Recalage photo insuffisamment démontré : ${args.registration.inliers} correspondances robustes (minimum ${SITE_TWIN_POLICY.minimumAutomaticCameraInliers}).`);
  }
  if (args.registration.inlierRatio < SITE_TWIN_POLICY.minimumAutomaticCameraInlierRatio) {
    throw new Error(`Recalage photo instable : ${Math.round(args.registration.inlierRatio * 100)} % de correspondances cohérentes (minimum ${Math.round(SITE_TWIN_POLICY.minimumAutomaticCameraInlierRatio * 100)} %).`);
  }
  if (!args.registration.method?.trim()) throw new Error("Recalage photo sans méthode géométrique déclarée.");

  const areasPx = args.polygons.map((polygon) => polygonAreaNormalized(polygon) * args.photoWidth * args.photoHeight);
  const minimumPanelAreaPx = args.role === "far" ? 8 : 24;
  const tooSmall = areasPx.findIndex((area) => area < minimumPanelAreaPx);
  if (tooSmall >= 0) {
    throw new Error(`Projection inexploitable : le panneau ${tooSmall + 1} n'occupe que ${areasPx[tooSmall]!.toFixed(1)} px² dans la photographie.`);
  }
  const points = args.polygons.flat();
  const fieldWidthPx = (Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x))) * args.photoWidth;
  const fieldHeightPx = (Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y))) * args.photoHeight;
  const minimumFieldExtentPx = args.role === "far" ? 8 : 20;
  if (fieldWidthPx < minimumFieldExtentPx || fieldHeightPx < minimumFieldExtentPx) {
    throw new Error(`Champ photovoltaïque projeté trop petit pour produire une pièce lisible (${fieldWidthPx.toFixed(1)}×${fieldHeightPx.toFixed(1)} px).`);
  }
}

function assertMaskUsable(maskBase64: string, crop: CropRegion) {
  const mask = decodePng(maskBase64);
  if (mask.width !== crop.width || mask.height !== crop.height) {
    throw new Error("Le masque d'édition ne correspond pas exactement au crop photovoltaïque.");
  }
  let editable = 0;
  let protectedPixels = 0;
  for (let offset = 3; offset < mask.rgba.length; offset += 4) {
    if (mask.rgba[offset]! < 128) editable += 1;
    else protectedPixels += 1;
  }
  const total = mask.width * mask.height;
  if (editable < 64) throw new Error("Le masque photovoltaïque ne contient pas assez de pixels éditables.");
  if (protectedPixels < 64 || editable / total > 0.65) {
    throw new Error("Le masque photovoltaïque autorise une zone d'édition anormalement large ; rendu refusé.");
  }
}

async function loadRegistrationReference(longitude: number, latitude: number) {
  const failures: string[] = [];
  try {
    const layers = await fetchGoogleSolarDataLayers({ latitude, longitude, radiusMeters: 70, pixelSizeMeters: 0.1 });
    if (layers.rgbUrl) {
      return {
        bytes: new Uint8Array(await downloadGoogleGeoTiff(layers.rgbUrl, "RGB")),
        source: "google-rgb" as const,
      };
    }
    failures.push("référence RGB Google absente");
  } catch (error) {
    failures.push(`référence RGB Google : ${error instanceof Error ? error.message : "échec inconnu"}`);
  }

  try {
    const ign = await fetchIgnOrthophotoGeoTiff({ longitude, latitude });
    return { bytes: ign.bytes, source: ign.source };
  } catch (error) {
    failures.push(`orthophoto IGN : ${error instanceof Error ? error.message : "échec inconnu"}`);
  }
  throw new Error(`Aucune orthophoto géoréférencée exploitable pour le recalage photo : ${failures.join(" | ")}`);
}

function insertionPrompt(
  input: DpPieceInput,
  context: SiteTwinDocumentContext,
  role: PiecePhotoInput["role"],
  correction?: string,
) {
  const module = requireVerifiedPvModule(input.moduleReference ?? "");
  const faceId = context.layout.selectedFaceIds[0];
  const face = context.siteTwin.roof.faces.find((candidate) => candidate.id === faceId);
  return [
    "PILOTPAPER — GEOMETRY-LOCKED PHOTOVOLTAIC PHOTO EDIT.",
    "This is a high-resolution local crop around the photovoltaic field, not the complete photograph.",
    "The input crop contains a deterministic dark-blue scaffold exactly on every physical photovoltaic footprint. Replace each scaffold with ONE realistic photovoltaic module without moving or resizing its four projected edges.",
    "The transparent edit mask includes only the physical module footprints plus a very narrow integration halo. The halo is ONLY for anti-aliasing, contact shadow and reflection blending; never extend panel glass or frame into it.",
    `Render exactly one realistic photovoltaic module for each scaffold. Total modules: ${context.layout.modules.length}.`,
    `Module: ${module.manufacturer} ${module.canonicalReference}; real dimensions ${module.widthMm} × ${module.heightMm} × ${module.thicknessMm} mm; orientation ${context.layout.configuration.orientation}.`,
    `Physical roof face: ${face?.displayLabel ?? faceId}; slope ${face?.slopeDeg.toFixed(1) ?? "unknown"}°; azimuth ${face?.azimuthDeg.toFixed(1) ?? "unknown"}°; source role ${role}.`,
    "Use the extra crop resolution for crisp module frames, plausible cell detail, glass reflections, local lighting and roof contact. Do not soften the module texture unnecessarily.",
    "Every module belongs to the same roof plane and must look like the same physical product under one camera perspective.",
    "Do not add labels, arrows, borders, masks, debug marks, people, tools or new architecture.",
    "Everything beyond the narrow edit halo is immutable; PilotPaper will restore it pixel-for-pixel after generation.",
    correction ? `VISUAL CORRECTION ONLY — geometry remains locked and cannot change:\n${correction}` : "",
  ].filter(Boolean).join("\n");
}

export type ConstrainedPhotoInsertion = {
  context: SiteTwinDocumentContext;
  base64: string;
  sourcePngBase64: string;
  panelPolygonsNormalized: Point[][];
  registrationReferenceSource: "google-rgb" | "ign-orthophoto";
  registration: {
    reprojectionErrorPx: number;
    matches: number;
    inliers: number;
    inlierRatio: number;
    method: string;
  };
  changedIslandRatio: number;
  perPanelChangedRatios: number[];
  renderCrop: {
    width: number;
    height: number;
    outputSize: string;
  };
};

export async function renderGeometryLockedPhotoInsertion(args: {
  input: DpPieceInput;
  photo: PiecePhotoInput;
  correction?: string;
}): Promise<ConstrainedPhotoInsertion> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Clé du moteur visuel absente du poste local.");
  const context = await buildSiteTwinDocumentContext(args.input);
  const [longitude, latitude] = context.siteTwin.addressPoint;
  const reference = await loadRegistrationReference(longitude, latitude);
  const modulePolygonsLonLat = modulePolygonsToLonLat({
    faces: context.siteTwin.roof.faces,
    modules: context.layout.modules,
  });
  const projection = await projectSiteTwinModulesToPhoto({
    modulePolygonsLonLat,
    referenceGeoTiff: reference.bytes,
    photo: Buffer.from(args.photo.base64, "base64"),
    photoMimeType: args.photo.mimeType,
  });
  const normalizedSource = decodePng(projection.photoBase64);
  if (normalizedSource.width !== projection.widthPx || normalizedSource.height !== projection.heightPx) {
    throw new Error(`Projection photo incohérente : PNG ${normalizedSource.width}×${normalizedSource.height}, métadonnées ${projection.widthPx}×${projection.heightPx}.`);
  }
  const polygons = projection.panelPolygonsNormalized;
  assertProjectionUsable({
    photoWidth: projection.widthPx,
    photoHeight: projection.heightPx,
    polygons,
    expectedCount: context.layout.configuration.panelCount,
    registration: projection.registration,
    role: args.photo.role,
  });
  if (polygons.length !== context.layout.configuration.panelCount) {
    throw new Error(`Projection photo incomplète : ${polygons.length}/${context.layout.configuration.panelCount} modules.`);
  }

  const crop = cropAroundPanelField(projection.photoBase64, polygons);
  const geometryGuide = annotatePngWithPanelPolygons(crop.pngBase64, crop.polygonsNormalized);
  const mask = buildPanelIslandsMaskForPng(crop.pngBase64, crop.polygonsNormalized, AI_EDIT_PADDING);
  if (!mask) throw new Error("Le masque géométrique des panneaux n'a pas pu être construit.");
  assertMaskUsable(mask, crop);
  const outputSize = imageEditSize(crop.width, crop.height);

  const form = new FormData();
  form.set("model", IMAGE_MODEL);
  form.set("prompt", insertionPrompt(args.input, context, args.photo.role, args.correction));
  form.set("quality", "high");
  form.set("size", outputSize);
  form.set("output_format", "png");
  form.append("image[]", base64ToBlob(geometryGuide, "image/png"), "geometry-locked-pv-crop.png");
  form.set("mask", base64ToBlob(mask, "image/png"), "panel-islands-mask.png");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Moteur visuel indisponible (${response.status})${body ? ` : ${body.slice(0, 500)}` : ""}.`);
  }
  const json = await response.json() as { data?: Array<{ b64_json?: string }> };
  const rawCropCandidate = json.data?.[0]?.b64_json;
  if (!rawCropCandidate || rawCropCandidate.length < 1000) throw new Error("Le moteur visuel n'a produit aucune insertion exploitable.");
  decodePng(rawCropCandidate);

  const fullCandidate = restoreCropIntoFullImage(projection.photoBase64, rawCropCandidate, crop);
  const base64 = geometryLockedCompositePng(projection.photoBase64, fullCandidate, polygons, {
    featherPixels: COMPOSITE_FEATHER_PIXELS,
    outsideBlendMax: OUTSIDE_BLEND_MAX,
  });
  const finalImage = decodePng(base64);
  if (finalImage.width !== normalizedSource.width || finalImage.height !== normalizedSource.height) {
    throw new Error("Le rendu final a changé les dimensions de la photographie source.");
  }
  const perPanelChangedRatios = changedIslandRatios(projection.photoBase64, base64, polygons);
  const changeRatio = changedIslandRatio(projection.photoBase64, base64, polygons);
  const weakestPanel = Math.min(...perPanelChangedRatios);
  if (changeRatio < MIN_AGGREGATE_PANEL_CHANGE_RATIO || weakestPanel < MIN_SINGLE_PANEL_CHANGE_RATIO) {
    throw new Error(
      `Insertion visuelle insuffisante : moyenne ${Math.round(changeRatio * 100)} %, panneau le moins modifié ${Math.round(weakestPanel * 100)} %.`,
    );
  }

  return {
    context,
    base64,
    sourcePngBase64: projection.photoBase64,
    panelPolygonsNormalized: polygons,
    registrationReferenceSource: reference.source,
    registration: {
      reprojectionErrorPx: projection.registration.reprojectionErrorPx,
      matches: projection.registration.matches,
      inliers: projection.registration.inliers,
      inlierRatio: projection.registration.inlierRatio,
      method: projection.registration.method,
    },
    changedIslandRatio: changeRatio,
    perPanelChangedRatios,
    renderCrop: {
      width: crop.width,
      height: crop.height,
      outputSize,
    },
  };
}
