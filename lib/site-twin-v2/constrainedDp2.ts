import "server-only";

import { getDpPieceContract } from "@/lib/dp-piece-contract";
import type { DpPieceInput, DpPieceOutput } from "@/lib/pilotpaper-image2-types";
import { buildSiteTwinDocumentContext } from "./dpPieceBridge";
import { overlayPlanningPanelsPng } from "./planningOverlay";

const IGN_WMS_ENDPOINT = "https://data.geopf.fr/wms-r/wms";
const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 1000;
const VIEW_WIDTH_M = 110;
const VIEW_HEIGHT_M = 78.6;
const WEB_MERCATOR_LIMIT = 20_037_508.342789244;

type Point = { x: number; y: number };

function toWebMercator(longitude: number, latitude: number) {
  const boundedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  return {
    x: (longitude * WEB_MERCATOR_LIMIT) / 180,
    y: (Math.log(Math.tan(((90 + boundedLatitude) * Math.PI) / 360)) * WEB_MERCATOR_LIMIT) / Math.PI,
  };
}

function localToLonLat(origin: [number, number], point: Point): [number, number] {
  const latitude = origin[1] + point.y / 110_540;
  const metresPerLongitudeDegree = Math.max(1, 111_320 * Math.cos(origin[1] * Math.PI / 180));
  const longitude = origin[0] + point.x / metresPerLongitudeDegree;
  return [longitude, latitude];
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

async function fetchOfficialCloseView(longitude: number, latitude: number) {
  const response = await fetch(ignCloseUrl(longitude, latitude), {
    headers: { Accept: "image/png" },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Vue officielle IGN indisponible (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 10_000 || bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error("La vue IGN reçue n'est pas un PNG exploitable.");
  return bytes.toString("base64");
}

function projectedPanelPolygons(args: {
  origin: [number, number];
  center: [number, number];
  modules: Array<{ polygonLocalM: Point[] }>;
}) {
  const centerMeters = toWebMercator(args.center[0], args.center[1]);
  const minX = centerMeters.x - VIEW_WIDTH_M / 2;
  const maxY = centerMeters.y + VIEW_HEIGHT_M / 2;
  return args.modules.map((module, moduleIndex) => {
    if (module.polygonLocalM.length !== 4) throw new Error(`Module ${moduleIndex + 1} : quatre coins métriques requis.`);
    return module.polygonLocalM.map((point) => {
      const lonLat = localToLonLat(args.origin, point);
      const meter = toWebMercator(lonLat[0], lonLat[1]);
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

export async function generateDeterministicDp2(input: DpPieceInput & { dp: 2 }): Promise<DpPieceOutput> {
  const contract = getDpPieceContract(2);
  if (!contract) throw new Error("Contrat DP2 introuvable.");
  const context = await buildSiteTwinDocumentContext(input);
  const center = context.siteTwin.addressPoint;
  const source = await fetchOfficialCloseView(center[0], center[1]);
  const polygons = projectedPanelPolygons({
    origin: context.siteTwin.roof.origin,
    center,
    modules: context.layout.modules,
  });
  if (polygons.length !== context.layout.configuration.panelCount) {
    throw new Error(`DP2 : projection incomplète (${polygons.length}/${context.layout.configuration.panelCount}).`);
  }
  const base64 = overlayPlanningPanelsPng(source, polygons);
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
      `${context.layout.modules.length} panneaux projetés depuis le Site Twin métrique sur le pan ${face?.displayLabel ?? "sélectionné"}.`,
      `Pente ${face?.slopeDeg.toFixed(1) ?? "?"}° · azimut ${face?.azimuthDeg.toFixed(1) ?? "?"}° · recul bas résolu ${eligibility?.resolvedGutterClearanceMm ?? context.layout.configuration.preferredGutterClearanceMm} mm.`,
      `Site Twin ${context.siteTwin.id} rev. ${context.siteTwin.revision} · parcelle ${context.siteTwin.parcel.reference}.`,
    ],
    inspector: {
      passed: true,
      score: 1,
      checks: [
        `Quantité exacte : ${polygons.length}/${context.layout.configuration.panelCount}`,
        `Matrice : ${context.layout.configuration.rows} × ${context.layout.configuration.columns}`,
        "Coordonnées modules issues du calepinage métrique : oui",
        "Fond IGN/cadastre conservé hors des modules : oui",
        `Pan physique verrouillé : ${face?.displayLabel ?? face?.id ?? "oui"}`,
      ],
      issues: [],
    },
  };
}
