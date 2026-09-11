import { configFromEnv } from "@/lib/dp-ai-engine/config";
import {
  allPanelPolygonsForRoleProjective,
  assertValidProjectiveQuad,
  projectivePointInQuad,
} from "@/lib/dp-ai-engine/geometry/panelProjection";
import { resolveProjectLayout } from "@/lib/dp-ai-engine/geometry/projectLayout";
import { openaiJson } from "@/lib/dp-ai-engine/providers/openaiJson";
import type {
  InputPhoto,
  MetricPoint2D,
  Point2D,
  ProjectContext,
  ProjectForm,
  RoofFaceMetricGeometry,
} from "@/lib/dp-ai-engine/types";
import { toDataUrl } from "@/lib/dp-ai-engine/utils/dataUrl";
import type { DpPieceInput, DpPieceOutput } from "@/lib/dp-piece-engine";
import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";

const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 1000;
const MASS_ASPECT = IMAGE_HEIGHT / IMAGE_WIDTH;
const WEB_MERCATOR_LIMIT = 20_037_508.342789244;
const IDENTITY_THRESHOLD = 0.8;
const SLOPE_THRESHOLD = 0.65;

type LonLat = [number, number];
type ParcelGeometry =
  | { type: "Polygon"; coordinates: LonLat[][] }
  | { type: "MultiPolygon"; coordinates: LonLat[][][] };

type RasterCandidate = { label: string; url: URL };
type MetricFrame = {
  longitude: number;
  latitude: number;
  widthMeters: number;
  heightMeters: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type Dp2OfficialContext = {
  normalizedAddress: string;
  municipality: string;
  parcelReference: string;
  parcelAreaM2: number;
  parcelGeometry: ParcelGeometry;
  parcelPolygonNormalized: Point2D[];
  mass: InputPhoto;
  cadastralOverlay: string;
  imagerySource: string;
  cadastreSource: string;
};

type PlaneEvidence = {
  polygonNormalized: [Point2D, Point2D, Point2D, Point2D];
  gutterLineNormalized: [Point2D, Point2D];
  ridgeLineNormalized: [Point2D, Point2D];
};

type CrossViewObstacle = {
  type: string;
  description: string;
  roofPolygonNormalized: Point2D[] | null;
  metricPolygonNormalized: Point2D[] | null;
};

export type Dp2CrossViewIdentity = {
  sameBuilding: boolean;
  sameRoofPlane: boolean;
  confidence: number;
  slopeDeg: number;
  slopeConfidence: number;
  metricPlane: PlaneEvidence;
  roofPlane: PlaneEvidence;
  evidence: {
    parcelPositionConsistent: boolean;
    roofShapeConsistent: boolean;
    ridgeEaveAxisConsistent: boolean;
    obstaclePatternConsistent: boolean;
    annexContextConsistent: boolean;
  };
  obstacles: CrossViewObstacle[];
  notes: string[];
};

const pointSchema = {
  type: "object",
  additionalProperties: false,
  properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"],
} as const;

const quadSchema = {
  type: "array",
  minItems: 4,
  maxItems: 4,
  items: pointSchema,
} as const;

const lineSchema = {
  type: "array",
  minItems: 2,
  maxItems: 2,
  items: pointSchema,
} as const;

const identitySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sameBuilding: { type: "boolean" },
    sameRoofPlane: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    slopeDeg: { type: "number", minimum: 0, maximum: 75 },
    slopeConfidence: { type: "number", minimum: 0, maximum: 1 },
    metricPlane: {
      type: "object",
      additionalProperties: false,
      properties: {
        polygonNormalized: quadSchema,
        gutterLineNormalized: lineSchema,
        ridgeLineNormalized: lineSchema,
      },
      required: ["polygonNormalized", "gutterLineNormalized", "ridgeLineNormalized"],
    },
    roofPlane: {
      type: "object",
      additionalProperties: false,
      properties: {
        polygonNormalized: quadSchema,
        gutterLineNormalized: lineSchema,
        ridgeLineNormalized: lineSchema,
      },
      required: ["polygonNormalized", "gutterLineNormalized", "ridgeLineNormalized"],
    },
    evidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        parcelPositionConsistent: { type: "boolean" },
        roofShapeConsistent: { type: "boolean" },
        ridgeEaveAxisConsistent: { type: "boolean" },
        obstaclePatternConsistent: { type: "boolean" },
        annexContextConsistent: { type: "boolean" },
      },
      required: [
        "parcelPositionConsistent",
        "roofShapeConsistent",
        "ridgeEaveAxisConsistent",
        "obstaclePatternConsistent",
        "annexContextConsistent",
      ],
    },
    obstacles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string" },
          description: { type: "string" },
          roofPolygonNormalized: {
            type: ["array", "null"],
            minItems: 3,
            items: pointSchema,
          },
          metricPolygonNormalized: {
            type: ["array", "null"],
            minItems: 3,
            items: pointSchema,
          },
        },
        required: ["type", "description", "roofPolygonNormalized", "metricPolygonNormalized"],
      },
    },
    notes: { type: "array", items: { type: "string" } },
  },
  required: [
    "sameBuilding",
    "sameRoofPlane",
    "confidence",
    "slopeDeg",
    "slopeConfidence",
    "metricPlane",
    "roofPlane",
    "evidence",
    "obstacles",
    "notes",
  ],
} as const;

function escapeXml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[char] ?? char);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function number(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} doit être un entier positif.`);
  return parsed;
}

function finitePoint(point: Point2D) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function normalizedPoint(point: Point2D) {
  return finitePoint(point) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function polygonArea(poly: Point2D[]) {
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    area += poly[j]!.x * poly[i]!.y - poly[i]!.x * poly[j]!.y;
  }
  return Math.abs(area) / 2;
}

function polygonCentroid(poly: Point2D[]) {
  return {
    x: poly.reduce((sum, point) => sum + point.x, 0) / poly.length,
    y: poly.reduce((sum, point) => sum + point.y, 0) / poly.length,
  };
}

function pointInPolygon(point: Point2D, polygon: Point2D[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects =
      (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-12) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function toWebMercator(longitude: number, latitude: number) {
  const boundedLatitude = clamp(latitude, -85.05112878, 85.05112878);
  return {
    x: (longitude * WEB_MERCATOR_LIMIT) / 180,
    y: (Math.log(Math.tan(((90 + boundedLatitude) * Math.PI) / 360)) * WEB_MERCATOR_LIMIT) / Math.PI,
  };
}

function fromWebMercator(x: number, y: number) {
  return {
    longitude: (x / WEB_MERCATOR_LIMIT) * 180,
    latitude: (Math.atan(Math.sinh((y / WEB_MERCATOR_LIMIT) * Math.PI)) * 180) / Math.PI,
  };
}

function isLonLat(value: unknown): value is LonLat {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]));
}

function parseParcelGeometry(value: unknown): ParcelGeometry {
  if (!value || typeof value !== "object") throw new Error("DP2 : géométrie cadastrale officielle absente.");
  const raw = value as { type?: unknown; coordinates?: unknown };
  if (raw.type === "Polygon" && Array.isArray(raw.coordinates)) {
    const rings = raw.coordinates as unknown[];
    if (!rings.length || !rings.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isLonLat))) {
      throw new Error("DP2 : géométrie cadastrale Polygon invalide.");
    }
    return { type: "Polygon", coordinates: rings as LonLat[][] };
  }
  if (raw.type === "MultiPolygon" && Array.isArray(raw.coordinates)) {
    const polygons = raw.coordinates as unknown[];
    if (!polygons.length || !polygons.every((polygon) => Array.isArray(polygon)
      && polygon.length > 0
      && polygon.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isLonLat)))) {
      throw new Error("DP2 : géométrie cadastrale MultiPolygon invalide.");
    }
    return { type: "MultiPolygon", coordinates: polygons as LonLat[][][] };
  }
  throw new Error(`DP2 : type de géométrie cadastrale non pris en charge (${String(raw.type ?? "inconnu")}).`);
}

function parcelRings(geometry: ParcelGeometry): LonLat[][] {
  return geometry.type === "Polygon"
    ? geometry.coordinates
    : geometry.coordinates.flatMap((polygon) => polygon);
}

function parcelPoints(geometry: ParcelGeometry): LonLat[] {
  return parcelRings(geometry).flat();
}

function largestParcelRing(geometry: ParcelGeometry) {
  const rings = parcelRings(geometry);
  return [...rings].sort((a, b) => b.length - a.length)[0] ?? [];
}

async function fetchOfficialParcel(args: { cityCode: string; section: string; parcelNumber: string }) {
  const url = new URL("https://apicarto.ign.fr/api/cadastre/parcelle");
  url.searchParams.set("code_insee", args.cityCode);
  url.searchParams.set("section", args.section);
  url.searchParams.set("numero", args.parcelNumber);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`DP2 : APICARTO Cadastre indisponible (${response.status}).`);
  const payload = await response.json() as {
    features?: Array<{ geometry?: unknown; properties?: { contenance?: number; idu?: string } }>;
  };
  const feature = payload.features?.[0];
  if (!feature?.geometry) throw new Error("DP2 : APICARTO n'a retourné aucune géométrie pour la parcelle cible.");
  const geometry = parseParcelGeometry(feature.geometry);
  const areaM2 = Number(feature.properties?.contenance);
  if (!Number.isFinite(areaM2) || areaM2 <= 0) throw new Error("DP2 : superficie cadastrale officielle absente.");
  return { geometry, areaM2, idu: String(feature.properties?.idu ?? "").trim() };
}

function metricFrameForParcel(geometry: ParcelGeometry, fallbackLongitude: number, fallbackLatitude: number): MetricFrame {
  const projected = parcelPoints(geometry).map(([longitude, latitude]) => toWebMercator(longitude, latitude));
  if (!projected.length) throw new Error("DP2 : parcelle officielle sans coordonnées exploitables.");
  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));
  const parcelWidth = Math.max(1, maxX - minX);
  const parcelHeight = Math.max(1, maxY - minY);
  const compactParcel = parcelWidth <= 120 && parcelHeight <= 90;
  const center = compactParcel
    ? fromWebMercator((minX + maxX) / 2, (minY + maxY) / 2)
    : { longitude: fallbackLongitude, latitude: fallbackLatitude };
  const desiredWidth = compactParcel
    ? Math.max(45, parcelWidth * 2.2, (parcelHeight * 2.2) / MASS_ASPECT)
    : 90;
  const widthMeters = clamp(desiredWidth, 45, 140);
  const heightMeters = widthMeters * MASS_ASPECT;
  const centerMercator = toWebMercator(center.longitude, center.latitude);
  return {
    longitude: center.longitude,
    latitude: center.latitude,
    widthMeters,
    heightMeters,
    minX: centerMercator.x - widthMeters / 2,
    maxX: centerMercator.x + widthMeters / 2,
    minY: centerMercator.y - heightMeters / 2,
    maxY: centerMercator.y + heightMeters / 2,
  };
}

function projectParcelRingNormalized(geometry: ParcelGeometry, frame: MetricFrame) {
  const ring = largestParcelRing(geometry).map(([longitude, latitude]) => {
    const point = toWebMercator(longitude, latitude);
    return {
      x: (point.x - frame.minX) / (frame.maxX - frame.minX),
      y: (frame.maxY - point.y) / (frame.maxY - frame.minY),
    };
  }).filter(normalizedPoint);
  if (ring.length < 4 || polygonArea(ring) < 1e-5) {
    throw new Error("DP2 : la parcelle officielle ne peut pas être projetée de manière fiable dans la vue IGN.");
  }
  return ring;
}

function wmsUrl(args: {
  endpoint: string;
  layer: string;
  style?: string;
  frame: MetricFrame;
  transparent?: boolean;
}) {
  const url = new URL(args.endpoint);
  const params: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: args.layer,
    STYLES: args.style ?? "",
    CRS: "EPSG:3857",
    BBOX: [args.frame.minX, args.frame.minY, args.frame.maxX, args.frame.maxY].join(","),
    WIDTH: String(IMAGE_WIDTH),
    HEIGHT: String(IMAGE_HEIGHT),
    FORMAT: "image/png",
    TRANSPARENT: args.transparent ? "true" : "false",
  };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

function orthophotoCandidates(frame: MetricFrame): RasterCandidate[] {
  return [
    {
      label: "IGN orthophoto standard",
      url: wmsUrl({ endpoint: "https://data.geopf.fr/wms-r/wms", layer: "ORTHOIMAGERY.ORTHOPHOTOS", frame }),
    },
    {
      label: "IGN orthophoto haute résolution",
      url: wmsUrl({ endpoint: "https://data.geopf.fr/wms-r/wms", layer: "HR.ORTHOIMAGERY.ORTHOPHOTOS", style: "normal", frame }),
    },
  ];
}

function cadastralCandidates(frame: MetricFrame): RasterCandidate[] {
  return [
    {
      label: "IGN Parcellaire Express",
      url: wmsUrl({
        endpoint: "https://data.geopf.fr/wms-r/wms",
        layer: "CADASTRALPARCELS.PARCELLAIRE_EXPRESS",
        style: "normal",
        frame,
        transparent: true,
      }),
    },
    {
      label: "IGN Parcellaire Express secours",
      url: wmsUrl({
        endpoint: "https://data.geopf.fr/wms-r",
        layer: "CADASTRALPARCELS.PARCELLAIRE_EXPRESS",
        style: "normal",
        frame,
        transparent: true,
      }),
    },
  ];
}

async function fetchRaster(candidates: RasterCandidate[], purpose: string) {
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, {
        headers: { Accept: "image/png,*/*;q=0.1" },
        signal: AbortSignal.timeout(30_000),
      });
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!response.ok || !contentType.startsWith("image/")) {
        failures.push(`${candidate.label}:${response.status}:${contentType || "type-inconnu"}`);
        continue;
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength < 2_000) {
        failures.push(`${candidate.label}:image-trop-petite`);
        continue;
      }
      return { base64: Buffer.from(bytes).toString("base64"), source: candidate.label };
    } catch (error) {
      failures.push(`${candidate.label}:${error instanceof Error ? error.name : "erreur"}`);
    }
  }
  console.error(`[dp2-v1] ${purpose} failed`, failures);
  throw new Error(`DP2 bloquée : ${purpose} officielle indisponible.`);
}

async function resolveOfficialContext(address: string): Promise<Dp2OfficialContext> {
  const cleanAddress = address.trim();
  if (cleanAddress.length < 8) throw new Error("Adresse trop imprécise pour les sources IGN.");

  const search = new URL("https://data.geopf.fr/geocodage/search");
  search.searchParams.set("q", cleanAddress);
  search.searchParams.set("index", "address");
  search.searchParams.set("limit", "1");
  const geocode = await fetch(search, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!geocode.ok) throw new Error(`Géocodage IGN indisponible (${geocode.status}).`);
  const payload = await geocode.json() as {
    features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> }>;
  };
  const feature = payload.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  if (!coordinates) throw new Error("Adresse non retrouvée par l'IGN.");
  const [addressLongitude, addressLatitude] = coordinates;
  const props = feature?.properties ?? {};
  const cityCode = String(props.citycode ?? "").trim();
  if (!cityCode) throw new Error("DP2 : code INSEE de la commune introuvable.");

  const reverse = new URL("https://data.geopf.fr/geocodage/reverse");
  reverse.searchParams.set("lon", String(addressLongitude));
  reverse.searchParams.set("lat", String(addressLatitude));
  reverse.searchParams.set("index", "parcel");
  reverse.searchParams.set("limit", "1");
  const reverseResponse = await fetch(reverse, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!reverseResponse.ok) throw new Error(`Cadastre IGN indisponible (${reverseResponse.status}).`);
  const reversePayload = await reverseResponse.json() as { features?: Array<{ properties?: Record<string, unknown> }> };
  const parcel = reversePayload.features?.[0]?.properties ?? {};
  const section = String(parcel.section ?? "").trim();
  const parcelNumber = String(parcel.number ?? parcel.numero ?? "").trim();
  const reverseParcelId = String(parcel.idu ?? parcel.id ?? parcel.parcelle ?? "").trim();
  if (!section || !parcelNumber) throw new Error("DP2 : section ou numéro cadastral introuvable.");

  const officialParcel = await fetchOfficialParcel({ cityCode, section, parcelNumber });
  const parcelReference = [section, parcelNumber].filter(Boolean).join(" ") || officialParcel.idu || reverseParcelId;
  const frame = metricFrameForParcel(officialParcel.geometry, addressLongitude, addressLatitude);
  const parcelPolygonNormalized = projectParcelRingNormalized(officialParcel.geometry, frame);
  const [massRaster, cadastralRaster] = await Promise.all([
    fetchRaster(orthophotoCandidates(frame), "la vue métrique IGN centrée sur la parcelle"),
    fetchRaster(cadastralCandidates(frame), "la couche cadastrale"),
  ]);

  return {
    normalizedAddress: String(props.label ?? props.name ?? cleanAddress),
    municipality: String(props.city ?? ""),
    parcelReference,
    parcelAreaM2: officialParcel.areaM2,
    parcelGeometry: officialParcel.geometry,
    parcelPolygonNormalized,
    mass: {
      role: "satellite_mass",
      mimeType: "image/png",
      base64: massRaster.base64,
      filename: `ign-dp2-${parcelReference.replace(/\s+/g, "-")}.png`,
      widthPx: IMAGE_WIDTH,
      heightPx: IMAGE_HEIGHT,
      metersPerPixel: frame.widthMeters / IMAGE_WIDTH,
    },
    cadastralOverlay: cadastralRaster.base64,
    imagerySource: massRaster.source,
    cadastreSource: cadastralRaster.source,
  };
}

function asRoofPhoto(input: DpPieceInput): InputPhoto {
  const photo = input.photos?.find((candidate) => candidate.role === "roof");
  if (!photo?.base64 || photo.base64.length < 1000) {
    throw new Error("DP2 : une vue oblique de toiture exploitable est requise.");
  }
  return { role: "roof", mimeType: photo.mimeType, base64: photo.base64, filename: photo.filename };
}

function buildBaseForm(input: DpPieceInput): ProjectForm {
  const module = requireVerifiedPvModule(input.moduleReference ?? "");
  const panelCount = positiveInteger(input.panelCount, "Le nombre de panneaux");
  const rows = positiveInteger(input.rows, "Le nombre de rangées");
  const columns = positiveInteger(input.columns, "Le nombre de colonnes");
  if (rows * columns !== panelCount) {
    throw new Error(`DP2 : le calepinage ${rows} × ${columns} ne correspond pas aux ${panelCount} panneaux demandés.`);
  }
  const faceId = input.roofFace?.trim() || "A";
  return {
    projectId: `v1-dp2-${crypto.randomUUID()}`,
    address: input.address.trim(),
    panel: {
      manufacturer: module.manufacturer,
      model: module.canonicalReference,
      widthMm: module.widthMm,
      heightMm: module.heightMm,
      frameColor: "black",
      powerWp: module.powerWp,
    },
    requestedPanelCount: panelCount,
    array: {
      rows,
      columns,
      orientation: input.orientation ?? "portrait",
      roofFace: faceId,
      placement: input.placement ?? "centered",
      layoutMode: "fixed",
      gutterClearanceMm: Math.max(0, number(input.gutterClearanceMm, 300)),
      interPanelGapMm: Math.max(0, number(input.interPanelGapMm, 20)),
    },
    roofSelection: { mode: "priority", priorityFaceId: faceId },
    support: { topology: "pitched", covering: "unknown", existingStructure: true },
  };
}

function identityPrompt(context: Dp2OfficialContext, form: ProjectForm, previousIssues: string[] = []) {
  return `You are PilotPaper's Cross-View Identity Engine for a French photovoltaic DP2 plan.

This stage has ONE job: prove which physical roof plane in the official orthographic image is the SAME physical roof plane shown in the user's real roof photograph. Do not perform PV layout and do not invent geometry.

IMAGE 1 is the official metric IGN orthophoto, already centered on the cadastral parcel of the project.
IMAGE 2 is the user's real oblique roof photograph.

Official target parcel reference: ${context.parcelReference}
Target parcel polygon in IMAGE 1 normalized coordinates: ${JSON.stringify(context.parcelPolygonNormalized)}
Requested face label to keep downstream: ${form.array.roofFace}

Identity procedure:
1. Restrict the search to buildings whose roof lies inside or materially intersects the official target parcel polygon.
2. Compare IMAGE 1 and IMAGE 2 using roof outline, ridge/eave axis, obstacle placement, annex relationships and relative proportions.
3. Return ONE roof plane pair representing the SAME physical plane in both images.
4. The polygon order for both planes MUST be bottom-left, bottom-right, top-right, top-left relative to that plane, with gutter/low edge first and ridge/high edge second.
5. If the same building or same plane cannot be established, set sameBuilding or sameRoofPlane to false and reduce confidence. Never manufacture a match just to satisfy the request.
6. Obstacles seen only in IMAGE 2 must still be reported. If their footprint is not directly visible in IMAGE 1, metricPolygonNormalized must be null; PilotPaper will reproject it only after the plane identity is proven.
7. Estimate slope only from the real roof photograph. If slope is weakly supported, lower slopeConfidence.

${previousIssues.length ? `A previous automatic attempt failed these deterministic checks:\n- ${previousIssues.join("\n- ")}\nCorrect the identity analysis rather than lowering confidence thresholds.` : ""}

Module/layout data is irrelevant to identity, but for context the requested array is ${form.array.rows}×${form.array.columns} ${form.array.orientation}.
Return only the requested structured object.`;
}

async function runIdentityPass(
  apiKey: string,
  model: string,
  context: Dp2OfficialContext,
  form: ProjectForm,
  roofPhoto: InputPhoto,
  previousIssues: string[] = [],
) {
  return openaiJson<Dp2CrossViewIdentity>({
    apiKey,
    model,
    prompt: identityPrompt(context, form, previousIssues),
    imageDataUrls: [toDataUrl(context.mass), toDataUrl(roofPhoto)],
    imageLabels: [
      `IMAGE 1 — AUTHORITATIVE ROLE = satellite_mass. Metric scale = ${context.mass.metersPerPixel} metre/pixel. Target parcel = ${context.parcelReference}.`,
      "IMAGE 2 — AUTHORITATIVE ROLE = roof. Real project photograph used for physical roof-plane identity.",
    ],
    schemaName: previousIssues.length ? "dp2_cross_view_identity_recovery" : "dp2_cross_view_identity",
    schema: identitySchema as unknown as Record<string, unknown>,
  });
}

export function validateDp2CrossViewIdentity(
  identity: Dp2CrossViewIdentity,
  parcelPolygonNormalized: Point2D[],
) {
  const issues: string[] = [];
  if (!identity.sameBuilding) issues.push("Le même bâtiment n'est pas démontré entre la vue IGN et la photo toiture.");
  if (!identity.sameRoofPlane) issues.push("Le même pan physique n'est pas démontré entre les deux vues.");
  if (identity.confidence < IDENTITY_THRESHOLD) {
    issues.push(`Confiance d'identité ${identity.confidence.toFixed(2)} < ${IDENTITY_THRESHOLD.toFixed(2)}.`);
  }
  if (identity.slopeConfidence < SLOPE_THRESHOLD) {
    issues.push(`Confiance de pente ${identity.slopeConfidence.toFixed(2)} < ${SLOPE_THRESHOLD.toFixed(2)}.`);
  }

  const evidence = identity.evidence;
  const secondaryEvidence = [
    evidence.roofShapeConsistent,
    evidence.ridgeEaveAxisConsistent,
    evidence.obstaclePatternConsistent,
    evidence.annexContextConsistent,
  ].filter(Boolean).length;
  if (!evidence.parcelPositionConsistent) issues.push("La position du toit n'est pas cohérente avec la parcelle officielle.");
  if (secondaryEvidence < 2) issues.push("Moins de deux indices visuels indépendants confirment l'identité du pan.");

  for (const [label, quad] of [
    ["IGN", identity.metricPlane.polygonNormalized],
    ["photo", identity.roofPlane.polygonNormalized],
  ] as const) {
    if (!quad.every(normalizedPoint)) {
      issues.push(`Le quadrilatère ${label} contient des coordonnées invalides.`);
      continue;
    }
    try {
      assertValidProjectiveQuad(quad);
    } catch (error) {
      issues.push(`Quadrilatère ${label} invalide : ${error instanceof Error ? error.message : "géométrie incorrecte"}`);
    }
  }

  const metricCentroid = polygonCentroid(identity.metricPlane.polygonNormalized);
  if (!pointInPolygon(metricCentroid, parcelPolygonNormalized)) {
    issues.push("Le centre du pan identifié par l'IA est hors de la parcelle cadastrale cible.");
  }
  return issues;
}

async function resolveCrossViewIdentity(
  apiKey: string,
  model: string,
  context: Dp2OfficialContext,
  form: ProjectForm,
  roofPhoto: InputPhoto,
) {
  const first = await runIdentityPass(apiKey, model, context, form, roofPhoto);
  const firstIssues = validateDp2CrossViewIdentity(first, context.parcelPolygonNormalized);
  if (!firstIssues.length) return first;

  const second = await runIdentityPass(apiKey, model, context, form, roofPhoto, firstIssues);
  const secondIssues = validateDp2CrossViewIdentity(second, context.parcelPolygonNormalized);
  if (secondIssues.length) {
    throw new Error(`DP2 bloquée après réconciliation d'identité automatique : ${secondIssues.join(" ")}`);
  }
  return second;
}

function projectiveCoefficients(q: [Point2D, Point2D, Point2D, Point2D]) {
  const [bl, br, tr, tl] = q;
  const dx1 = br.x - tr.x;
  const dx2 = tl.x - tr.x;
  const dx3 = bl.x - br.x + tr.x - tl.x;
  const dy1 = br.y - tr.y;
  const dy2 = tl.y - tr.y;
  const dy3 = bl.y - br.y + tr.y - tl.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  let g = 0;
  let h = 0;
  if (Math.abs(dx3) > 1e-12 || Math.abs(dy3) > 1e-12) {
    if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) return undefined;
    g = (dx3 * dy2 - dx2 * dy3) / denominator;
    h = (dx1 * dy3 - dx3 * dy1) / denominator;
  }
  return {
    a: br.x - bl.x + g * br.x,
    b: tl.x - bl.x + h * tl.x,
    c: bl.x,
    d: br.y - bl.y + g * br.y,
    e: tl.y - bl.y + h * tl.y,
    f: bl.y,
    g,
    h,
  };
}

function projectiveCoordinatesInQuad(q: [Point2D, Point2D, Point2D, Point2D], point: Point2D) {
  const coeff = projectiveCoefficients(q);
  if (!coeff) return undefined;
  const { a, b, c, d, e, f, g, h } = coeff;
  const a1 = a - point.x * g;
  const b1 = b - point.x * h;
  const c1 = point.x - c;
  const a2 = d - point.y * g;
  const b2 = e - point.y * h;
  const c2 = point.y - f;
  const det = a1 * b2 - a2 * b1;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return undefined;
  const u = (c1 * b2 - c2 * b1) / det;
  const v = (a1 * c2 - a2 * c1) / det;
  return Number.isFinite(u) && Number.isFinite(v) ? { u, v } : undefined;
}

function reprojectRoofPolygonToMetric(
  roofQuad: [Point2D, Point2D, Point2D, Point2D],
  metricQuad: [Point2D, Point2D, Point2D, Point2D],
  polygon: Point2D[],
) {
  const mapped: Point2D[] = [];
  for (const point of polygon) {
    if (!normalizedPoint(point)) return undefined;
    const uv = projectiveCoordinatesInQuad(roofQuad, point);
    if (!uv || uv.u < -0.08 || uv.u > 1.08 || uv.v < -0.08 || uv.v > 1.08) return undefined;
    mapped.push(projectivePointInQuad(metricQuad, uv.u, uv.v));
  }
  return mapped.length >= 3 && polygonArea(mapped) > 1e-8 ? mapped : undefined;
}

function metricBasis(
  quad: [Point2D, Point2D, Point2D, Point2D],
  metersPerPixel: number,
  slopeDeg: number,
) {
  const toPixels = (point: Point2D) => ({ x: point.x * IMAGE_WIDTH, y: point.y * IMAGE_HEIGHT });
  const [bl, br, tr, tl] = quad.map(toPixels) as [Point2D, Point2D, Point2D, Point2D];
  const dx = br.x - bl.x;
  const dy = br.y - bl.y;
  const eaveLength = Math.hypot(dx, dy);
  if (eaveLength < 1e-6) throw new Error("DP2 : rive basse IGN dégénérée.");
  const ex = dx / eaveLength;
  const ey = dy / eaveLength;
  let nx = -ey;
  let ny = ex;
  const lowerMid = { x: (bl.x + br.x) / 2, y: (bl.y + br.y) / 2 };
  const upperMid = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
  if ((upperMid.x - lowerMid.x) * nx + (upperMid.y - lowerMid.y) * ny < 0) {
    nx *= -1;
    ny *= -1;
  }
  const mmPerPixel = metersPerPixel * 1000;
  const cosSlope = Math.max(0.26, Math.cos((slopeDeg * Math.PI) / 180));
  return {
    toMetric(point: Point2D): MetricPoint2D {
      const p = toPixels(point);
      const vx = p.x - bl.x;
      const vy = p.y - bl.y;
      return {
        xMm: (vx * ex + vy * ey) * mmPerPixel,
        yMm: ((vx * nx + vy * ny) * mmPerPixel) / cosSlope,
      };
    },
  };
}

function metricFaceFromIdentity(
  form: ProjectForm,
  context: Dp2OfficialContext,
  identity: Dp2CrossViewIdentity,
): RoofFaceMetricGeometry {
  const quad = identity.metricPlane.polygonNormalized;
  const mpp = context.mass.metersPerPixel;
  if (!mpp) throw new Error("DP2 : échelle métrique IGN absente.");
  const px = (a: Point2D, b: Point2D) => Math.hypot((b.x - a.x) * IMAGE_WIDTH, (b.y - a.y) * IMAGE_HEIGHT);
  const [bl, br, tr, tl] = quad;
  const eaveGround = Math.min(px(bl, br), px(tl, tr)) * mpp;
  const runGround = ((px(bl, tl) + px(br, tr)) / 2) * mpp;
  const slopeDeg = form.roofGeometry?.slopeDeg ?? identity.slopeDeg;
  const slopeLength = runGround / Math.max(0.26, Math.cos((slopeDeg * Math.PI) / 180));
  if (!(eaveGround > 0.4) || !(slopeLength > 0.4)) throw new Error("DP2 : dimensions métriques de toiture non fiables.");

  const basis = metricBasis(quad, mpp, slopeDeg);
  const obstaclePolygonsMm = identity.obstacles.flatMap((obstacle) => {
    let metricPolygon = obstacle.metricPolygonNormalized ?? undefined;
    if (!metricPolygon?.length && obstacle.roofPolygonNormalized?.length) {
      metricPolygon = reprojectRoofPolygonToMetric(
        identity.roofPlane.polygonNormalized,
        identity.metricPlane.polygonNormalized,
        obstacle.roofPolygonNormalized,
      );
    }
    if (!metricPolygon?.length || metricPolygon.length < 3 || !metricPolygon.every(normalizedPoint)) {
      throw new Error(`DP2 : l'obstacle « ${obstacle.description} » est visible mais son emprise métrique ne peut pas être démontrée.`);
    }
    return [{
      type: obstacle.type,
      description: obstacle.description,
      polygonMm: metricPolygon.map(basis.toMetric),
    }];
  });

  return {
    id: form.array.roofFace,
    label: `Pan ${form.array.roofFace}`,
    widthMm: Math.floor(eaveGround * 1000),
    slopeLengthMm: Math.floor(slopeLength * 1000),
    slopeDeg,
    surfacePolygonMm: quad.map(basis.toMetric),
    obstaclePolygonsMm,
    source: "ign-derived",
  };
}

function buildProjectContext(
  form: ProjectForm,
  context: Dp2OfficialContext,
  identity: Dp2CrossViewIdentity,
): ProjectContext {
  const metricFace = metricFaceFromIdentity(form, context, identity);
  const layoutForm: ProjectForm = {
    ...form,
    roofFaces: [metricFace],
    roofGeometry: metricFace,
    roofSelection: { mode: "priority", priorityFaceId: metricFace.id },
  };
  const layout = resolveProjectLayout(layoutForm);
  if (layout.placements.length !== 1 || layout.placements[0]?.faceId !== metricFace.id) {
    throw new Error("DP2 : le Layout Engine a quitté le pan physiquement identifié.");
  }
  const placement = layout.placements[0]!;
  const resolvedPlacement = {
    leftMm: Math.max(0, placement.resolvedLeftMm ?? 0),
    rightMm: Math.max(0, placement.resolvedRightMm ?? 0),
    gutterMm: Math.max(0, placement.resolvedGutterMm),
    ridgeMm: Math.max(0, placement.resolvedRidgeMm ?? 0),
  };
  const faceId = metricFace.id;
  const metricObstacles = identity.obstacles.flatMap((obstacle) => {
    const metric = obstacle.metricPolygonNormalized
      ?? (obstacle.roofPolygonNormalized
        ? reprojectRoofPolygonToMetric(identity.roofPlane.polygonNormalized, identity.metricPlane.polygonNormalized, obstacle.roofPolygonNormalized)
        : undefined);
    return metric?.length ? [{ type: obstacle.type, description: obstacle.description, polygonNormalized: metric, viewRole: "satellite_mass" as const }] : [];
  });
  const metricView = {
    role: "satellite_mass" as const,
    faceId,
    selectedFaceVisible: true,
    confidence: identity.confidence,
    roofPolygonNormalized: identity.metricPlane.polygonNormalized,
    gutterLineNormalized: identity.metricPlane.gutterLineNormalized,
    ridgeLineNormalized: identity.metricPlane.ridgeLineNormalized,
    perspectiveNotes: ["Vue orthographique IGN métrique centrée sur la parcelle officielle."],
  };
  const roofView = {
    role: "roof" as const,
    faceId,
    selectedFaceVisible: true,
    confidence: identity.confidence,
    roofPolygonNormalized: identity.roofPlane.polygonNormalized,
    gutterLineNormalized: identity.roofPlane.gutterLineNormalized,
    ridgeLineNormalized: identity.roofPlane.ridgeLineNormalized,
    perspectiveNotes: ["Vue réelle utilisée pour l'identité cross-view du même pan."],
  };

  return {
    projectId: form.projectId,
    address: form.address,
    array: form.array,
    panel: form.panel,
    exactPanelCount: layout.count,
    fieldWidthMm: layout.primaryFieldWidthMm,
    fieldHeightMm: layout.primaryFieldHeightMm,
    roofGeometry: metricFace,
    resolvedPlacement,
    facePlacements: layout.placements,
    support: form.support,
    roof: {
      selectedFaceDescription: metricFace.label ?? faceId,
      confidence: Math.min(identity.confidence, identity.slopeConfidence),
      roofPolygonNormalized: identity.roofPlane.polygonNormalized,
      gutterLineNormalized: identity.roofPlane.gutterLineNormalized,
      ridgeLineNormalized: identity.roofPlane.ridgeLineNormalized,
      views: [metricView, roofView],
      faces: [{
        id: faceId,
        label: metricFace.label ?? faceId,
        confidence: identity.confidence,
        slopeDeg: metricFace.slopeDeg,
        views: [metricView, roofView],
        obstacles: metricObstacles,
      }],
      obstacles: metricObstacles.map(({ type, description, polygonNormalized }) => ({ type, description, polygonNormalized })),
      perspectiveNotes: identity.notes,
      uncertainties: [],
    },
    immutableFacts: [
      `Cross-view identity locked to physical roof face ${faceId}.`,
      `Official parcel ${context.parcelReference} (${Math.round(context.parcelAreaM2)} m²).`,
      `${layout.count} modules must remain on the identified physical face.`,
    ],
  };
}

function panelSvg(polygons: Point2D[][], x: number, y: number, width: number, height: number) {
  return polygons.map((polygon, index) => {
    const points = polygon.map((point) => `${(x + point.x * width).toFixed(1)},${(y + point.y * height).toFixed(1)}`).join(" ");
    return `<polygon data-module="${index + 1}" points="${points}" fill="#142f52" fill-opacity=".94" stroke="#ffffff" stroke-width="2"/>`;
  }).join("");
}

function buildDp2Svg(context: Dp2OfficialContext, project: ProjectContext) {
  const polygons = allPanelPolygonsForRoleProjective(project, "satellite_mass");
  if (!polygons || polygons.length !== project.exactPanelCount) {
    throw new Error("DP2 bloquée : la projection homographique ne démontre pas exactement tous les modules sur la vue métrique IGN.");
  }
  const width = 1200;
  const height = 900;
  const x = 70;
  const y = 166;
  const imageWidth = 1060;
  const imageHeight = 590;
  const orthophoto = `data:image/png;base64,${context.mass.base64}`;
  const cadastre = `data:image/png;base64,${context.cadastralOverlay}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#f7f7f4"/>
    <rect x="30" y="30" width="1140" height="840" rx="18" fill="#fff" stroke="#d9dde2" stroke-width="2"/>
    <rect x="58" y="58" width="76" height="44" rx="10" fill="#102a56"/>
    <text x="96" y="87" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#fff">DP2</text>
    <text x="158" y="87" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#17191d">Plan de masse — état projeté</text>
    <text x="58" y="126" font-family="Arial,sans-serif" font-size="16" fill="#656b75">${escapeXml(context.normalizedAddress)}</text>
    <rect x="58" y="154" width="1084" height="620" rx="12" fill="#edf0f2"/>
    <image href="${orthophoto}" x="${x}" y="${y}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="none"/>
    <image href="${cadastre}" x="${x}" y="${y}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="none" opacity=".9"/>
    ${panelSvg(polygons, x, y, imageWidth, imageHeight)}
    <rect x="82" y="650" width="510" height="94" rx="10" fill="#fff" fill-opacity=".94"/>
    <text x="102" y="680" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#102a56">PARCELLE ${escapeXml(context.parcelReference)} · ${project.exactPanelCount} MODULES</text>
    <text x="102" y="706" font-family="Arial,sans-serif" font-size="14" fill="#4b5563">Pan verrouillé ${escapeXml(project.array.roofFace)} · calepinage ${project.array.rows} × ${project.array.columns}</text>
    <text x="102" y="728" font-family="Arial,sans-serif" font-size="12" fill="#68717d">${Math.round(context.parcelAreaM2)} m² cadastraux · identité multi-vues contrôlée</text>
    <text x="1082" y="204" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#102a56">N</text>
    <path d="M1082 217 L1070 251 L1082 242 L1094 251 Z" fill="#102a56"/>
    <line x1="58" y1="832" x2="1142" y2="832" stroke="#102a56" stroke-width="2"/>
    <text x="58" y="857" font-family="Arial,sans-serif" font-size="13" fill="#68717d">PilotPaper V1 · MODE TEST · NON VALIDÉ</text>
    <text x="1142" y="857" text-anchor="end" font-family="Arial,sans-serif" font-size="13" fill="#68717d">${escapeXml(context.municipality)} · ${escapeXml(context.parcelReference)}</text>
  </svg>`;
}

export async function generateDp2Piece(input: DpPieceInput): Promise<DpPieceOutput> {
  if (input.dp !== 2) throw new Error("Le moteur DP2 V1 a reçu une autre pièce.");
  if (!input.address?.trim()) throw new Error("L'adresse du projet est requise.");

  const form = buildBaseForm(input);
  const roofPhoto = asRoofPhoto(input);
  const official = await resolveOfficialContext(input.address);
  const config = configFromEnv();
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY absente du poste local.");

  const identity = await resolveCrossViewIdentity(config.openaiApiKey, config.analysisModel, official, form, roofPhoto);
  const project = buildProjectContext(form, official, identity);
  const svg = buildDp2Svg(official, project);
  const score = Math.min(identity.confidence, identity.slopeConfidence);

  return {
    dp: 2,
    title: "Plan de masse",
    validationStatus: "test_unverified",
    mimeType: "image/svg+xml",
    text: svg,
    sourceSummary: [
      `IGN Géoplateforme — adresse : ${official.normalizedAddress}`,
      `APICARTO Cadastre — parcelle ${official.parcelReference} (${Math.round(official.parcelAreaM2)} m²)`,
      `IGN Géoplateforme — orthophoto métrique centrée sur la parcelle : ${official.imagerySource}`,
      `OpenAI ${config.analysisModel} — Cross-View Identity Engine (IGN ↔ photo toiture)`,
      "PV Layout Engine — placement déterministe sur le pan physiquement verrouillé",
      "Projection Engine — homographie sur la vue métrique IGN",
    ],
    inspector: {
      passed: true,
      score,
      checks: [
        "Parcelle officielle résolue avant toute compréhension de toiture",
        "Même bâtiment démontré entre IGN et photo réelle",
        "Même pan physique verrouillé dans les deux vues avant Layout Engine",
        "Centre du pan métrique vérifié à l'intérieur de la parcelle cible",
        "Au moins deux indices visuels indépendants confirment l'identité multi-vues",
        `Confiance identité ${(identity.confidence * 100).toFixed(0)} %`,
        `${project.exactPanelCount} modules projetés sur le même pan physique`,
      ],
      issues: identity.notes,
    },
  };
}
