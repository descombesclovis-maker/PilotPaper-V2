import { getDpPieceContract } from "@/lib/dp-piece-contract";
import type { DpPieceInput, DpPieceOutput } from "@/lib/pilotpaper-image2-types";

const IGN_WMS_ENDPOINT = "https://data.geopf.fr/wms-r/wms";
const CADASTRE_ENDPOINT = "https://apicarto.ign.fr/api/cadastre/parcelle";
const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 1000;
const VIEW_WIDTH_METERS = 650;
const VIEW_HEIGHT_METERS = 464;
const WEB_MERCATOR_LIMIT = 20_037_508.342789244;

type Coordinate = [number, number] | [number, number, number];
type PolygonGeometry = { type: "Polygon"; coordinates: Coordinate[][] };
type MultiPolygonGeometry = { type: "MultiPolygon"; coordinates: Coordinate[][][] };
type ParcelFeature = {
  type: "Feature";
  properties?: Record<string, unknown>;
  geometry?: PolygonGeometry | MultiPolygonGeometry;
};

type ParcelCollection = {
  type?: "FeatureCollection";
  features?: ParcelFeature[];
};

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  }[character] ?? character));
}

function toWebMercator(longitude: number, latitude: number) {
  const boundedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  return {
    x: (longitude * WEB_MERCATOR_LIMIT) / 180,
    y: (Math.log(Math.tan(((90 + boundedLatitude) * Math.PI) / 360)) * WEB_MERCATOR_LIMIT) / Math.PI,
  };
}

function ignImageUrl(longitude: number, latitude: number) {
  const { x, y } = toWebMercator(longitude, latitude);
  const url = new URL(IGN_WMS_ENDPOINT);
  const params: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: "HR.ORTHOIMAGERY.ORTHOPHOTOS,CADASTRALPARCELS.PARCELLAIRE_EXPRESS",
    STYLES: "normal,normal",
    CRS: "EPSG:3857",
    BBOX: [
      x - VIEW_WIDTH_METERS / 2,
      y - VIEW_HEIGHT_METERS / 2,
      x + VIEW_WIDTH_METERS / 2,
      y + VIEW_HEIGHT_METERS / 2,
    ].join(","),
    WIDTH: String(IMAGE_WIDTH),
    HEIGHT: String(IMAGE_HEIGHT),
    FORMAT: "image/png",
    TRANSPARENT: "false",
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function geocode(address: string) {
  const url = new URL("https://data.geopf.fr/geocodage/search");
  url.searchParams.set("q", address.trim());
  url.searchParams.set("index", "address");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`DP1 : adresse introuvable par le service officiel (${response.status}).`);
  const json = await response.json() as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: Record<string, unknown>;
    }>;
  };
  const feature = json.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  if (!coordinates) throw new Error("DP1 : l'adresse n'a pas pu être géolocalisée avec certitude.");
  const label = String(feature?.properties?.label ?? feature?.properties?.name ?? address).trim();
  return { longitude: coordinates[0], latitude: coordinates[1], label };
}

async function fetchOfficialParcel(longitude: number, latitude: number) {
  const url = new URL(CADASTRE_ENDPOINT);
  url.searchParams.set("geom", JSON.stringify({ type: "Point", coordinates: [longitude, latitude] }));
  url.searchParams.set("source_ign", "PCI");
  url.searchParams.set("_limit", "5");
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`DP1 : géométrie cadastrale officielle indisponible (${response.status}).`);
  const json = await response.json() as ParcelCollection;
  const usable = (json.features ?? []).filter((feature) => feature.geometry && (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon"));
  if (usable.length !== 1) {
    throw new Error(`DP1 : ${usable.length === 0 ? "aucune" : "plusieurs"} parcelle cadastrale intersecte le point d'adresse. PilotPaper refuse de deviner la parcelle.`);
  }
  return usable[0];
}

function parcelReference(feature: ParcelFeature) {
  const properties = feature.properties ?? {};
  const section = String(properties.section ?? properties.code_section ?? "").trim();
  const numero = String(properties.numero ?? properties.number ?? properties.numero_parcelle ?? "").trim();
  const id = String(properties.id ?? properties.idu ?? properties.parcelle ?? "").trim();
  const short = [section, numero].filter(Boolean).join(" ");
  return short || id || "référence cadastrale officielle";
}

async function fetchOfficialMap(longitude: number, latitude: number) {
  const response = await fetch(ignImageUrl(longitude, latitude), {
    headers: { Accept: "image/png" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`DP1 : fond IGN/cadastre officiel indisponible (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 10_000 || bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error("DP1 : fond officiel reçu invalide.");
  return bytes.toString("base64");
}

function geometryRings(geometry: PolygonGeometry | MultiPolygonGeometry) {
  if (geometry.type === "Polygon") return geometry.coordinates;
  return geometry.coordinates.flatMap((polygon) => polygon);
}

function renderOfficialDp1Svg(args: {
  longitude: number;
  latitude: number;
  mapBase64: string;
  feature: ParcelFeature;
  address: string;
  reference: string;
}) {
  const center = toWebMercator(args.longitude, args.latitude);
  const minX = center.x - VIEW_WIDTH_METERS / 2;
  const maxX = center.x + VIEW_WIDTH_METERS / 2;
  const minY = center.y - VIEW_HEIGHT_METERS / 2;
  const maxY = center.y + VIEW_HEIGHT_METERS / 2;
  const geometry = args.feature.geometry!;

  const rings = geometryRings(geometry).map((ring) => {
    const points = ring.map((coordinate) => {
      const mercator = toWebMercator(coordinate[0], coordinate[1]);
      const x = ((mercator.x - minX) / (maxX - minX)) * IMAGE_WIDTH;
      const y = ((maxY - mercator.y) / (maxY - minY)) * IMAGE_HEIGHT;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return points.join(" ");
  });

  if (!rings.length) throw new Error("DP1 : la géométrie officielle de la parcelle est vide.");

  const polygons = rings.map((points) => `<polygon points="${points}" fill="#102f5f" fill-opacity="0.18" stroke="#0b2e61" stroke-width="8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`).join("");
  const title = escapeXml("DP1 — Plan de situation");
  const address = escapeXml(args.address);
  const reference = escapeXml(args.reference);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" viewBox="0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}">
  <image href="data:image/png;base64,${args.mapBase64}" x="0" y="0" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" preserveAspectRatio="none"/>
  ${polygons}
  <g font-family="Arial, Helvetica, sans-serif">
    <rect x="24" y="22" width="560" height="92" rx="12" fill="white" fill-opacity="0.94"/>
    <text x="48" y="61" font-size="30" font-weight="700" fill="#102f5f">${title}</text>
    <text x="48" y="91" font-size="18" fill="#334155">Parcelle ${reference} · ${address}</text>
    <g transform="translate(1305 28)">
      <rect x="0" y="0" width="66" height="94" rx="10" fill="white" fill-opacity="0.94"/>
      <text x="33" y="27" text-anchor="middle" font-size="20" font-weight="700" fill="#102f5f">N</text>
      <path d="M33 36 L18 78 L33 69 L48 78 Z" fill="#102f5f"/>
    </g>
  </g>
</svg>`;
}

export async function generateOfficialDp1(input: DpPieceInput & { dp: 1 }): Promise<DpPieceOutput> {
  const contract = getDpPieceContract(1);
  if (!contract) throw new Error("Contrat DP1 introuvable.");
  if (!input.address?.trim()) throw new Error("L'adresse exacte du projet est requise.");

  const location = await geocode(input.address);
  const [feature, mapBase64] = await Promise.all([
    fetchOfficialParcel(location.longitude, location.latitude),
    fetchOfficialMap(location.longitude, location.latitude),
  ]);
  const reference = parcelReference(feature);
  const svg = renderOfficialDp1Svg({
    longitude: location.longitude,
    latitude: location.latitude,
    mapBase64,
    feature,
    address: location.label,
    reference,
  });

  return {
    dp: 1,
    title: contract.title,
    validationStatus: "test_unverified",
    mimeType: "image/svg+xml",
    base64: Buffer.from(svg, "utf8").toString("base64"),
    sourceSummary: [
      "DP1 déterministe : aucune IA générative utilisée pour la géométrie cadastrale",
      "Fond orthophoto + Parcellaire Express officiel IGN",
      `Contour cible issu directement de l'API Carto Cadastre · parcelle ${reference}`,
      "Aucune parcelle inventée ou redessinée par le moteur visuel",
    ],
    inspector: {
      passed: true,
      score: 1,
      checks: [
        "Fond officiel IGN : oui",
        "Géométrie de parcelle API Carto : oui",
        `Parcelle officielle : ${reference}`,
        "Contour génératif : aucun",
      ],
      issues: [],
    },
  };
}
