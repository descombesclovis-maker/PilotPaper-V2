import {
  cadastralCandidates,
  fetchIgnRaster,
  orthophotoCandidates,
} from "@/lib/dp-ai-engine/context/ignRaster";
import {
  parcelRings,
  resolveOfficialParcelContext,
  toWebMercator,
  type MetricFrame,
  type OfficialParcelContext,
} from "@/lib/dp-ai-engine/context/officialParcel";
import type { DpPieceInput, DpPieceOutput } from "@/lib/dp-piece-engine";

const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 779;
const MAP_X = 70;
const MAP_Y = 166;
const MAP_WIDTH = 1060;
const MAP_HEIGHT = 590;
const MAP_ASPECT = MAP_HEIGHT / MAP_WIDTH;
const MIN_SITUATION_WIDTH_METERS = 420;
const MAX_SITUATION_WIDTH_METERS = 850;
const PARCEL_CONTEXT_SCALE = 5.5;
const TARGET_PARCEL_STROKE = "#00a9bd";

type IgnDp1Context = OfficialParcelContext & {
  situationFrame: MetricFrame;
  situationBase64: string;
  situationMimeType: "image/jpeg" | "image/png";
  imagerySource: string;
  cadastralOverlayBase64?: string;
  cadastralOverlaySource?: string;
};
type ProjectedRing = Array<{ x: number; y: number }>;

function escapeXml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[char] ?? char);
}

function frameFromCenter(args: { longitude: number; latitude: number; widthMeters: number }): MetricFrame {
  const center = toWebMercator(args.longitude, args.latitude);
  const heightMeters = args.widthMeters * MAP_ASPECT;
  return {
    longitude: args.longitude,
    latitude: args.latitude,
    widthMeters: args.widthMeters,
    heightMeters,
    minX: center.x - args.widthMeters / 2,
    maxX: center.x + args.widthMeters / 2,
    minY: center.y - heightMeters / 2,
    maxY: center.y + heightMeters / 2,
  };
}

function parcelAwareSituationFrame(site: OfficialParcelContext): MetricFrame {
  const projected = parcelRings(site.parcelGeometry)
    .flat()
    .map(([longitude, latitude]) => toWebMercator(longitude, latitude));
  if (!projected.length) return frameFromCenter({ longitude: site.longitude, latitude: site.latitude, widthMeters: MIN_SITUATION_WIDTH_METERS });

  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));
  const parcelWidth = Math.max(8, maxX - minX);
  const parcelHeight = Math.max(8, maxY - minY);
  const desiredWidth = Math.max(
    MIN_SITUATION_WIDTH_METERS,
    parcelWidth * PARCEL_CONTEXT_SCALE,
    (parcelHeight * PARCEL_CONTEXT_SCALE) / MAP_ASPECT,
  );
  const requiredWidth = Math.max(parcelWidth * 1.45, (parcelHeight * 1.45) / MAP_ASPECT);
  const widthMeters = Math.max(requiredWidth, Math.min(MAX_SITUATION_WIDTH_METERS, desiredWidth));
  const heightMeters = widthMeters * MAP_ASPECT;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    longitude: site.longitude,
    latitude: site.latitude,
    widthMeters,
    heightMeters,
    minX: centerX - widthMeters / 2,
    maxX: centerX + widthMeters / 2,
    minY: centerY - heightMeters / 2,
    maxY: centerY + heightMeters / 2,
  };
}

export function buildDp1IgnWmsCandidates(longitude: number, latitude: number) {
  return orthophotoCandidates({
    frame: frameFromCenter({ longitude, latitude, widthMeters: MIN_SITUATION_WIDTH_METERS }),
    widthPx: IMAGE_WIDTH,
    heightPx: IMAGE_HEIGHT,
    format: "image/jpeg",
  });
}

function buildCadastralWmsCandidates(longitude: number, latitude: number) {
  return cadastralCandidates({
    frame: frameFromCenter({ longitude, latitude, widthMeters: MIN_SITUATION_WIDTH_METERS }),
    widthPx: IMAGE_WIDTH,
    heightPx: IMAGE_HEIGHT,
  });
}

async function resolveIgnDp1Context(address: string): Promise<IgnDp1Context> {
  const site = await resolveOfficialParcelContext(address);
  const situationFrame = parcelAwareSituationFrame(site);
  const [situation, cadastralOverlay] = await Promise.all([
    fetchIgnRaster(orthophotoCandidates({
      frame: situationFrame,
      widthPx: IMAGE_WIDTH,
      heightPx: IMAGE_HEIGHT,
      format: "image/jpeg",
    }), {
      purpose: "DP1 : vue aérienne IGN rapprochée sur la parcelle",
      minBytes: 10_000,
      required: true,
    }),
    fetchIgnRaster(cadastralCandidates({
      frame: situationFrame,
      widthPx: IMAGE_WIDTH,
      heightPx: IMAGE_HEIGHT,
    }), {
      purpose: "DP1 : limites cadastrales voisines",
      minBytes: 1_000,
      required: false,
    }),
  ]);
  if (!situation) throw new Error("DP1 bloquée : orthophoto IGN indisponible.");
  return {
    ...site,
    situationFrame,
    situationBase64: situation.base64,
    situationMimeType: situation.mimeType,
    imagerySource: situation.source,
    cadastralOverlayBase64: cadastralOverlay?.mimeType === "image/png" ? cadastralOverlay.base64 : undefined,
    cadastralOverlaySource: cadastralOverlay?.mimeType === "image/png" ? cadastralOverlay.source : undefined,
  };
}

function projectParcelRings(context: IgnDp1Context): ProjectedRing[] {
  const bounds = context.situationFrame;
  const rings = parcelRings(context.parcelGeometry).map((ring) => ring.map(([longitude, latitude]) => {
    const point = toWebMercator(longitude, latitude);
    const nx = (point.x - bounds.minX) / (bounds.maxX - bounds.minX);
    const ny = (bounds.maxY - point.y) / (bounds.maxY - bounds.minY);
    return {
      x: MAP_X + nx * MAP_WIDTH,
      y: MAP_Y + ny * MAP_HEIGHT,
    };
  }));
  const finite = rings.filter((ring) => ring.length >= 4 && ring.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  if (!finite.length) throw new Error("La géométrie cadastrale n'a pas pu être projetée sur la vue IGN.");
  const allPoints = finite.flat();
  const intersectsMap = allPoints.some((point) => point.x >= MAP_X && point.x <= MAP_X + MAP_WIDTH && point.y >= MAP_Y && point.y <= MAP_Y + MAP_HEIGHT);
  if (!intersectsMap) throw new Error("La géométrie cadastrale officielle ne recoupe pas l'emprise de la vue de situation.");
  return finite;
}

function ringPath(ring: ProjectedRing) {
  return ring.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ") + " Z";
}

function parcelPath(context: IgnDp1Context) {
  return projectParcelRings(context).map(ringPath).join(" ");
}

function documentFrame(args: { code: string; title: string; address: string; body: string; footer?: string }) {
  const width = 1200;
  const height = 900;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#f7f7f4"/>
    <rect x="30" y="30" width="1140" height="840" rx="18" fill="#fff" stroke="#d9dde2" stroke-width="2"/>
    <rect x="58" y="58" width="76" height="44" rx="10" fill="#102a56"/>
    <text x="96" y="87" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#fff">${escapeXml(args.code)}</text>
    <text x="158" y="87" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#17191d">${escapeXml(args.title)}</text>
    <text x="58" y="126" font-family="Arial,sans-serif" font-size="16" fill="#656b75">${escapeXml(args.address)}</text>
    ${args.body}
    <line x1="58" y1="832" x2="1142" y2="832" stroke="#102a56" stroke-width="2"/>
    <text x="58" y="857" font-family="Arial,sans-serif" font-size="13" fill="#68717d">PilotPaper V1 · MODE TEST · NON VALIDÉ</text>
    <text x="1142" y="857" text-anchor="end" font-family="Arial,sans-serif" font-size="13" fill="#68717d">${escapeXml(args.footer ?? "Validation K-par-K")}</text>
  </svg>`;
}

function buildDp1Svg(context: IgnDp1Context) {
  const image = `data:${context.situationMimeType};base64,${context.situationBase64}`;
  const cadastralOverlay = context.cadastralOverlayBase64
    ? `<image href="data:image/png;base64,${context.cadastralOverlayBase64}" x="${MAP_X}" y="${MAP_Y}" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" preserveAspectRatio="none" opacity=".34"/>`
    : "";
  const path = parcelPath(context);
  const body = `<rect x="58" y="154" width="1084" height="620" rx="12" fill="#edf0f2"/>
    <clipPath id="dp1-map-clip"><rect x="${MAP_X}" y="${MAP_Y}" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" rx="8"/></clipPath>
    <g clip-path="url(#dp1-map-clip)">
      <image href="${image}" x="${MAP_X}" y="${MAP_Y}" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" preserveAspectRatio="none"/>
      ${cadastralOverlay}
      <path d="${path}" fill="${TARGET_PARCEL_STROKE}" fill-opacity=".035" fill-rule="evenodd" stroke="#ffffff" stroke-width="5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <path d="${path}" fill="none" fill-rule="evenodd" stroke="${TARGET_PARCEL_STROKE}" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </g>
    <rect x="78" y="680" width="570" height="56" rx="10" fill="#fff" fill-opacity=".90"/>
    <text x="98" y="704" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#102a56">Parcelle cible ${escapeXml(context.parcelReference)} · ${Math.round(context.parcelAreaM2)} m²</text>
    <text x="98" y="725" font-family="Arial,sans-serif" font-size="12" fill="#68717d">Contour officiel APICARTO · limites voisines IGN en surimpression légère</text>
    <text x="1080" y="205" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#102a56">N</text>
    <path d="M1080 218 L1068 252 L1080 243 L1092 252 Z" fill="#102a56"/>`;
  return documentFrame({
    code: "DP1",
    title: "Plan de situation",
    address: context.normalizedAddress,
    body,
    footer: `${context.municipality} · ${context.parcelReference}`,
  });
}

export async function generateDp1Piece(input: DpPieceInput): Promise<DpPieceOutput> {
  if (input.dp !== 1) throw new Error("Le moteur DP1 a reçu une autre pièce.");
  if (!input.address?.trim()) throw new Error("L'adresse du projet est requise.");

  const context = await resolveIgnDp1Context(input.address);
  const projectedRings = projectParcelRings(context);
  if (!projectedRings.length) throw new Error("DP1 bloquée : le contour cadastral officiel n'a pas pu être représenté.");

  return {
    dp: 1,
    title: "Plan de situation",
    validationStatus: "test_unverified",
    mimeType: "image/svg+xml",
    text: buildDp1Svg(context),
    sourceSummary: [
      `IGN Géoplateforme — géocodage officiel : ${context.normalizedAddress}`,
      `IGN/APICARTO Cadastre — parcelle ${context.parcelReference} · ${Math.round(context.parcelAreaM2)} m²`,
      `IGN Géoplateforme — orthophoto : ${context.imagerySource}`,
      ...(context.cadastralOverlaySource ? [`IGN Géoplateforme — limites cadastrales : ${context.cadastralOverlaySource}`] : []),
    ],
    inspector: {
      passed: true,
      score: 1,
      checks: [
        "Adresse et parcelle résolues par le moteur cadastral commun PilotPaper",
        `Parcelle ${context.parcelReference} confirmée par IGN + APICARTO`,
        "Géométrie vectorielle officielle récupérée par APICARTO Cadastre",
        "Contour cadastral projeté mathématiquement dans la même emprise EPSG:3857 que l'orthophoto",
        `Superficie cadastrale officielle : ${Math.round(context.parcelAreaM2)} m²`,
        "Orthophoto officielle récupérée indépendamment de la couche cadastrale",
        "Cadrage de situation recentré automatiquement sur la parcelle avec contexte voisin conservé",
        "Nord et parcelle du projet représentés sans étiquette opaque sur la toiture",
      ],
      issues: context.cadastralOverlaySource ? [] : ["La couche contextuelle des limites cadastrales voisines est indisponible ; le contour vectoriel officiel de la parcelle du projet reste présent."],
    },
  };
}
