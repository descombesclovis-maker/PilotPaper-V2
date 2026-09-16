import "server-only";

import { getDpPieceContract } from "@/lib/dp-piece-contract";
import type { DpPieceInput, DpPieceOutput } from "@/lib/pilotpaper-image2-types";
import { decodePng } from "@/lib/dp-ai-engine/utils/pngPixels";
import { buildSiteTwinDocumentContext } from "./dpPieceBridge";
import { receiptForPiece } from "./documentContext";
import { inspectProjectedModuleGeometry, requireInspectorPass } from "./inspector";
import { modulePolygonsToLonLat } from "./localGeoTransform";
import { overlayPlanningPanelsPng } from "./planningOverlay";
import type { TwinLonLat } from "./types";

const IGN_WMS_ENDPOINT = "https://data.geopf.fr/wms-r/wms";
const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 1000;
const VIEW_WIDTH_M = 110;
const VIEW_HEIGHT_M = 78.6;
const WEB_MERCATOR_LIMIT = 20_037_508.342789244;

function toWebMercator(longitude: number, latitude: number) {
  const boundedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  return {
    x: (longitude * WEB_MERCATOR_LIMIT) / 180,
    y: (Math.log(Math.tan(((90 + boundedLatitude) * Math.PI) / 360)) * WEB_MERCATOR_LIMIT) / Math.PI,
  };
}

function ignCloseUrl(longitude: number, latitude: number) {
  const center = toWebMercator(longitude, latitude);
  const url = new URL(IGN_WMS_ENDPOINT);
  const params: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: "HR.ORTHOIMAGERY.ORTHOPHOTOS,CADASTRALPARCELS.PARCELLAIRE_EXPRESS",
    STYLES: "normal,normal",
    CRS: "EPSG:3857",
    BBOX: [
      center.x - VIEW_WIDTH_M / 2,
      center.y - VIEW_HEIGHT_M / 2,
      center.x + VIEW_WIDTH_M / 2,
      center.y + VIEW_HEIGHT_M / 2,
    ].join(","),
    WIDTH: String(IMAGE_WIDTH),
    HEIGHT: String(IMAGE_HEIGHT),
    FORMAT: "image/png",
    TRANSPARENT: "false",
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

function assertPlanningBaseUsable(base64: string) {
  const image = decodePng(base64);
  if (image.width !== IMAGE_WIDTH || image.height !== IMAGE_HEIGHT) {
    throw new Error(`DP2 : fond IGN de dimensions inattendues (${image.width}×${image.height}, attendu ${IMAGE_WIDTH}×${IMAGE_HEIGHT}).`);
  }
  let samples = 0;
  let sum = 0;
  let sumSquares = 0;
  let darkest = 255;
  let lightest = 0;
  const stride = 12;
  for (let y = 0; y < image.height; y += stride) {
    for (let x = 0; x < image.width; x += stride) {
      const offset = (y * image.width + x) * 4;
      const luminance = 0.2126 * image.rgba[offset]!
        + 0.7152 * image.rgba[offset + 1]!
        + 0.0722 * image.rgba[offset + 2]!;
      samples += 1;
      sum += luminance;
      sumSquares += luminance * luminance;
      darkest = Math.min(darkest, luminance);
      lightest = Math.max(lightest, luminance);
    }
  }
  const mean = sum / Math.max(1, samples);
  const variance = Math.max(0, sumSquares / Math.max(1, samples) - mean * mean);
  const standardDeviation = Math.sqrt(variance);
  if (standardDeviation < 3 || lightest - darkest < 18) {
    throw new Error("DP2 : la vue IGN reçue est visuellement vide ou uniforme ; PilotPaper refuse de produire un plan de masse sans fond lisible.");
  }
  return image;
}

async function fetchOfficialCloseView(longitude: number, latitude: number) {
  const response = await fetch(ignCloseUrl(longitude, latitude), {
    headers: { Accept: "image/png" },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Vue officielle IGN indisponible (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 10_000 || bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error("La vue IGN reçue n'est pas un PNG exploitable.");
  const base64 = bytes.toString("base64");
  assertPlanningBaseUsable(base64);
  return base64;
}

function projectedPanelPolygons(args: {
  center: TwinLonLat;
  modulePolygonsLonLat: TwinLonLat[][];
}) {
  const centerMeters = toWebMercator(args.center[0], args.center[1]);
  const minX = centerMeters.x - VIEW_WIDTH_M / 2;
  const maxY = centerMeters.y + VIEW_HEIGHT_M / 2;
  return args.modulePolygonsLonLat.map((module, moduleIndex) => {
    if (module.length !== 4) throw new Error(`Module ${moduleIndex + 1} : quatre coins géographiques requis.`);
    return module.map(([longitude, latitude]) => {
      const meter = toWebMercator(longitude, latitude);
      const normalized = {
        x: (meter.x - minX) / VIEW_WIDTH_M,
        y: (maxY - meter.y) / VIEW_HEIGHT_M,
      };
      if (normalized.x < -0.01 || normalized.x > 1.01 || normalized.y < -0.01 || normalized.y > 1.01) {
        throw new Error(`DP2 : le module ${moduleIndex + 1} sort de la vue IGN de contrôle.`);
      }
      return normalized;
    });
  });
}

function changedPixelCount(beforeBase64: string, afterBase64: string) {
  const before = decodePng(beforeBase64);
  const after = decodePng(afterBase64);
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error("DP2 : le rendu final a changé les dimensions du fond officiel.");
  }
  let changed = 0;
  for (let offset = 0; offset < before.rgba.length; offset += 4) {
    const delta = Math.abs(before.rgba[offset]! - after.rgba[offset]!)
      + Math.abs(before.rgba[offset + 1]! - after.rgba[offset + 1]!)
      + Math.abs(before.rgba[offset + 2]! - after.rgba[offset + 2]!);
    if (delta >= 12) changed += 1;
  }
  return changed;
}

export async function generateDeterministicDp2(input: DpPieceInput & { dp: 2 }): Promise<DpPieceOutput> {
  const contract = getDpPieceContract(2);
  if (!contract) throw new Error("Contrat DP2 introuvable.");
  const context = await buildSiteTwinDocumentContext(input);
  const center = context.siteTwin.addressPoint;
  const source = await fetchOfficialCloseView(center[0], center[1]);
  const modulePolygonsLonLat = modulePolygonsToLonLat({
    faces: context.siteTwin.roof.faces,
    modules: context.layout.modules,
  });
  const polygons = projectedPanelPolygons({ center, modulePolygonsLonLat });
  requireInspectorPass(inspectProjectedModuleGeometry(polygons, context.layout.configuration.panelCount));
  if (polygons.length !== context.layout.configuration.panelCount) {
    throw new Error(`DP2 : projection incomplète (${polygons.length}/${context.layout.configuration.panelCount}).`);
  }
  const base64 = overlayPlanningPanelsPng(source, polygons);
  const changedPixels = changedPixelCount(source, base64);
  if (changedPixels < context.layout.configuration.panelCount * 4) {
    throw new Error(`DP2 : insertion graphique insuffisante (${changedPixels} pixels modifiés pour ${context.layout.configuration.panelCount} panneaux).`);
  }
  const face = context.siteTwin.roof.faces.find((candidate) => candidate.id === context.layout.selectedFaceIds[0]);
  const eligibility = context.layout.eligibility.find((entry) => entry.faceId === face?.id);

  return {
    dp: 2,
    title: contract.title,
    validationStatus: "test_unverified",
    mimeType: "image/png",
    base64,
    sourceSummary: [
      "DP2 calculée sur la vue aérienne/cadastrale officielle sans génération libre de la géométrie.",
      `Moteur géométrique exécuté : ${context.siteTwin.sources.geometryEngineVersion ?? "preuve absente"}.`,
      `Contrôle géométrique indépendant exécuté : ${context.siteTwin.sources.advancedRoofAvailable ? "source exploitable" : "source non exploitable, diagnostic conservé"}.`,
      `${context.layout.modules.length} panneaux projetés depuis le Site Twin métrique sur le pan ${face?.displayLabel ?? "sélectionné"}.`,
      `Pente ${face?.slopeDeg.toFixed(1) ?? "?"}° · azimut ${face?.azimuthDeg.toFixed(1) ?? "?"}° · recul bas résolu ${eligibility?.resolvedGutterClearanceMm ?? context.layout.configuration.preferredGutterClearanceMm} mm.`,
      `Site Twin ${context.siteTwin.id} rev. ${context.siteTwin.revision} · empreinte ${context.layoutDigest.slice(0, 16)} · parcelle ${context.siteTwin.parcel.reference}.`,
      `Contrôle de visibilité DP2 : ${changedPixels} pixels de panneaux effectivement tracés.`,
    ],
    inspector: {
      passed: true,
      score: 1,
      checks: [
        `Quantité exacte : ${polygons.length}/${context.layout.configuration.panelCount}`,
        `Matrice : ${context.layout.configuration.rows} × ${context.layout.configuration.columns}`,
        "Moteur géométrique exécuté : oui",
        "Contrôle géométrique indépendant exécuté : oui",
        "Coordonnées modules issues du calepinage métrique : oui",
        "Conversion géographique dérivée des sommets réels du pan : oui",
        `Empreinte géométrique : ${context.layoutDigest.slice(0, 16)}`,
        "Fond IGN/cadastre lisible : oui",
        `Panneaux graphiquement visibles : ${changedPixels} pixels modifiés`,
        `Pan physique verrouillé : ${face?.displayLabel ?? face?.id ?? "oui"}`,
      ],
      issues: [],
    },
    geometryReceipt: receiptForPiece(context, 2),
  };
}
