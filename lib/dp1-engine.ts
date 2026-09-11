import type { DpPieceInput, DpPieceOutput } from "@/lib/dp-piece-engine";

const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 779;
const MAP_X = 70;
const MAP_Y = 166;
const MAP_WIDTH = 1060;
const MAP_HEIGHT = 590;
const SITUATION_WIDTH_METERS = 2500;
const SITUATION_HEIGHT_METERS = SITUATION_WIDTH_METERS * (MAP_HEIGHT / MAP_WIDTH);
const WEB_MERCATOR_LIMIT = 20_037_508.342789244;

type LonLat = [number, number];
type GeoJsonPolygon = { type: "Polygon"; coordinates: LonLat[][] };
type GeoJsonMultiPolygon = { type: "MultiPolygon"; coordinates: LonLat[][][] };
type ParcelGeometry = GeoJsonPolygon | GeoJsonMultiPolygon;

type IgnDp1Context = {
  normalizedAddress: string;
  longitude: number;
  latitude: number;
  municipality: string;
  cityCode: string;
  parcelReference: string;
  parcelAreaM2: number;
  parcelGeometry: ParcelGeometry;
  situationBase64: string;
  situationMimeType: "image/jpeg" | "image/png";
  imagerySource: string;
  cadastralOverlayBase64?: string;
  cadastralOverlayMimeType?: "image/png";
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

function toWebMercator(longitude: number, latitude: number) {
  const boundedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  return {
    x: (longitude * WEB_MERCATOR_LIMIT) / 180,
    y: (Math.log(Math.tan(((90 + boundedLatitude) * Math.PI) / 360)) * WEB_MERCATOR_LIMIT) / Math.PI,
  };
}

function situationBounds(longitude: number, latitude: number) {
  const center = toWebMercator(longitude, latitude);
  return {
    minX: center.x - SITUATION_WIDTH_METERS / 2,
    maxX: center.x + SITUATION_WIDTH_METERS / 2,
    minY: center.y - SITUATION_HEIGHT_METERS / 2,
    maxY: center.y + SITUATION_HEIGHT_METERS / 2,
  };
}

function buildWmsUrl(args: {
  endpoint: string;
  layer: string;
  style?: string;
  longitude: number;
  latitude: number;
  format: "image/jpeg" | "image/png";
  transparent: boolean;
}) {
  const bounds = situationBounds(args.longitude, args.latitude);
  const url = new URL(args.endpoint);
  const params: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: args.layer,
    STYLES: args.style ?? "",
    CRS: "EPSG:3857",
    BBOX: [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].join(","),
    WIDTH: String(IMAGE_WIDTH),
    HEIGHT: String(IMAGE_HEIGHT),
    FORMAT: args.format,
    TRANSPARENT: args.transparent ? "true" : "false",
  };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

export function buildDp1IgnWmsCandidates(longitude: number, latitude: number) {
  return [
    {
      label: "IGN WMS standard",
      url: buildWmsUrl({ endpoint: "https://data.geopf.fr/wms-r/wms", layer: "ORTHOIMAGERY.ORTHOPHOTOS", longitude, latitude, format: "image/jpeg", transparent: false }),
    },
    {
      label: "IGN WMS haute résolution",
      url: buildWmsUrl({ endpoint: "https://data.geopf.fr/wms-r/wms", layer: "HR.ORTHOIMAGERY.ORTHOPHOTOS", style: "normal", longitude, latitude, format: "image/jpeg", transparent: false }),
    },
    {
      label: "IGN WMS standard secours",
      url: buildWmsUrl({ endpoint: "https://data.geopf.fr/wms-r", layer: "ORTHOIMAGERY.ORTHOPHOTOS", longitude, latitude, format: "image/jpeg", transparent: false }),
    },
    {
      label: "IGN WMS haute résolution secours",
      url: buildWmsUrl({ endpoint: "https://data.geopf.fr/wms-r", layer: "HR.ORTHOIMAGERY.ORTHOPHOTOS", style: "normal", longitude, latitude, format: "image/jpeg", transparent: false }),
    },
  ] as const;
}

function buildCadastralWmsCandidates(longitude: number, latitude: number) {
  return [
    {
      label: "IGN Parcellaire Express PCI",
      url: buildWmsUrl({ endpoint: "https://data.geopf.fr/wms-r/wms", layer: "CADASTRALPARCELS.PARCELLAIRE_EXPRESS", style: "normal", longitude, latitude, format: "image/png", transparent: true }),
    },
    {
      label: "IGN Parcellaire Express PCI secours",
      url: buildWmsUrl({ endpoint: "https://data.geopf.fr/wms-r", layer: "CADASTRALPARCELS.PARCELLAIRE_EXPRESS", style: "normal", longitude, latitude, format: "image/png", transparent: true }),
    },
  ] as const;
}

async function fetchImageCandidates(
  candidates: readonly { label: string; url: URL }[],
  options: { required: boolean; minBytes: number; expectedTransparent?: boolean },
) {
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, {
        headers: { Accept: "image/png,image/jpeg;q=0.9,*/*;q=0.1" },
        signal: AbortSignal.timeout(30_000),
      });
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!response.ok) {
        failures.push(`${candidate.label}:${response.status}`);
        continue;
      }
      if (!contentType.startsWith("image/")) {
        failures.push(`${candidate.label}:type-${contentType || "inconnu"}`);
        continue;
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength < options.minBytes) {
        failures.push(`${candidate.label}:image-trop-petite`);
        continue;
      }
      const mimeType = contentType.includes("png") ? "image/png" : "image/jpeg";
      return {
        base64: Buffer.from(bytes).toString("base64"),
        mimeType,
        source: candidate.label,
      } as const;
    } catch (error) {
      failures.push(`${candidate.label}:${error instanceof Error ? error.name : "erreur"}`);
    }
  }
  console.error("[dp1] WMS candidates failed", failures);
  if (options.required) {
    throw new Error("DP1 bloquée : aucune vue aérienne officielle IGN n'a pu être obtenue. PilotPaper a essayé les flux IGN principal et de secours.");
  }
  return undefined;
}

async function fetchOfficialSituation(longitude: number, latitude: number) {
  return fetchImageCandidates(buildDp1IgnWmsCandidates(longitude, latitude), { required: true, minBytes: 10_000 });
}

async function fetchCadastralOverlay(longitude: number, latitude: number) {
  const overlay = await fetchImageCandidates(buildCadastralWmsCandidates(longitude, latitude), { required: false, minBytes: 1_000, expectedTransparent: true });
  if (!overlay || overlay.mimeType !== "image/png") return undefined;
  return overlay;
}

function isLonLatCoordinate(value: unknown): value is LonLat {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]))
    && Number(value[0]) >= -180
    && Number(value[0]) <= 180
    && Number(value[1]) >= -90
    && Number(value[1]) <= 90;
}

function parseParcelGeometry(value: unknown): ParcelGeometry {
  if (!value || typeof value !== "object") throw new Error("La géométrie cadastrale officielle est absente.");
  const geometry = value as { type?: unknown; coordinates?: unknown };
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    const rings = geometry.coordinates as unknown[];
    if (!rings.length || !rings.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isLonLatCoordinate))) {
      throw new Error("La géométrie cadastrale Polygon reçue est invalide.");
    }
    return { type: "Polygon", coordinates: rings as LonLat[][] };
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    const polygons = geometry.coordinates as unknown[];
    if (!polygons.length || !polygons.every((polygon) => Array.isArray(polygon)
      && polygon.length > 0
      && polygon.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isLonLatCoordinate)))) {
      throw new Error("La géométrie cadastrale MultiPolygon reçue est invalide.");
    }
    return { type: "MultiPolygon", coordinates: polygons as LonLat[][][] };
  }
  throw new Error(`Type de géométrie cadastrale non pris en charge : ${String(geometry.type ?? "inconnu")}.`);
}

async function fetchOfficialParcelGeometry(args: { cityCode: string; section: string; parcelNumber: string }) {
  const url = new URL("https://apicarto.ign.fr/api/cadastre/parcelle");
  url.searchParams.set("code_insee", args.cityCode);
  url.searchParams.set("section", args.section);
  url.searchParams.set("numero", args.parcelNumber);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`APICARTO Cadastre indisponible (${response.status}).`);
  const payload = await response.json() as {
    features?: Array<{
      geometry?: unknown;
      properties?: { contenance?: number; idu?: string; section?: string; numero?: string };
    }>;
  };
  const feature = payload.features?.[0];
  if (!feature?.geometry) throw new Error("APICARTO n'a retourné aucune géométrie pour la parcelle déterminée.");
  const geometry = parseParcelGeometry(feature.geometry);
  const area = Number(feature.properties?.contenance);
  if (!Number.isFinite(area) || area <= 0) throw new Error("APICARTO n'a retourné aucune superficie cadastrale fiable.");
  return { geometry, areaM2: area, idu: String(feature.properties?.idu ?? "").trim() };
}

async function resolveIgnDp1Context(address: string): Promise<IgnDp1Context> {
  const cleanAddress = address.trim();
  if (cleanAddress.length < 8) throw new Error("Adresse trop imprécise pour les sources IGN.");

  const search = new URL("https://data.geopf.fr/geocodage/search");
  search.searchParams.set("q", cleanAddress);
  search.searchParams.set("index", "address");
  search.searchParams.set("limit", "1");
  const response = await fetch(search, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Géocodage IGN indisponible (${response.status}).`);

  const payload = await response.json() as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: Record<string, unknown>;
    }>;
  };
  const feature = payload.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  if (!coordinates) throw new Error("Adresse non retrouvée par l'IGN.");
  const [longitude, latitude] = coordinates;
  const props = feature?.properties ?? {};
  const cityCode = String(props.citycode ?? "").trim();
  if (!cityCode) throw new Error("Le code INSEE de la commune n'a pas été déterminé par l'IGN.");

  const reverse = new URL("https://data.geopf.fr/geocodage/reverse");
  reverse.searchParams.set("lon", String(longitude));
  reverse.searchParams.set("lat", String(latitude));
  reverse.searchParams.set("index", "parcel");
  reverse.searchParams.set("limit", "1");
  const reverseResponse = await fetch(reverse, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!reverseResponse.ok) throw new Error(`Cadastre IGN indisponible (${reverseResponse.status}).`);

  const reversePayload = await reverseResponse.json() as {
    features?: Array<{ properties?: Record<string, unknown> }>;
  };
  const parcel = reversePayload.features?.[0]?.properties ?? {};
  const section = String(parcel.section ?? "").trim();
  const parcelNumber = String(parcel.number ?? parcel.numero ?? "").trim();
  const officialParcelId = String(parcel.idu ?? parcel.id ?? parcel.parcelle ?? "").trim();
  if (!section || !parcelNumber) throw new Error("La section ou le numéro cadastral n'a pas été déterminé avec certitude.");

  const [parcelVector, situation, cadastralOverlay] = await Promise.all([
    fetchOfficialParcelGeometry({ cityCode, section, parcelNumber }),
    fetchOfficialSituation(longitude, latitude),
    fetchCadastralOverlay(longitude, latitude),
  ]);
  if (!situation) throw new Error("DP1 bloquée : orthophoto IGN indisponible.");

  const parcelReference = [section, parcelNumber].filter(Boolean).join(" ") || parcelVector.idu || officialParcelId;
  return {
    normalizedAddress: String(props.label ?? props.name ?? cleanAddress),
    longitude,
    latitude,
    municipality: String(props.city ?? ""),
    cityCode,
    parcelReference,
    parcelAreaM2: parcelVector.areaM2,
    parcelGeometry: parcelVector.geometry,
    situationBase64: situation.base64,
    situationMimeType: situation.mimeType,
    imagerySource: situation.source,
    cadastralOverlayBase64: cadastralOverlay?.base64,
    cadastralOverlayMimeType: cadastralOverlay?.mimeType === "image/png" ? "image/png" : undefined,
    cadastralOverlaySource: cadastralOverlay?.source,
  };
}

function geometryRings(geometry: ParcelGeometry): LonLat[][] {
  if (geometry.type === "Polygon") return geometry.coordinates;
  return geometry.coordinates.flatMap((polygon) => polygon);
}

function projectParcelRings(context: IgnDp1Context): ProjectedRing[] {
  const bounds = situationBounds(context.longitude, context.latitude);
  const rings = geometryRings(context.parcelGeometry).map((ring) => ring.map(([longitude, latitude]) => {
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

function parcelLabelAnchor(context: IgnDp1Context) {
  const ring = projectParcelRings(context)[0]!;
  const points = ring.slice(0, Math.max(1, ring.length - 1));
  const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  return { x, y };
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
    ? `<image href="data:image/png;base64,${context.cadastralOverlayBase64}" x="${MAP_X}" y="${MAP_Y}" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" preserveAspectRatio="none" opacity=".62"/>`
    : "";
  const path = parcelPath(context);
  const anchor = parcelLabelAnchor(context);
  const labelY = Math.max(MAP_Y + 22, Math.min(MAP_Y + MAP_HEIGHT - 16, anchor.y - 16));
  const body = `<rect x="58" y="154" width="1084" height="620" rx="12" fill="#edf0f2"/>
    <clipPath id="dp1-map-clip"><rect x="${MAP_X}" y="${MAP_Y}" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" rx="8"/></clipPath>
    <g clip-path="url(#dp1-map-clip)">
      <image href="${image}" x="${MAP_X}" y="${MAP_Y}" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" preserveAspectRatio="none"/>
      ${cadastralOverlay}
      <path d="${path}" fill="#ff7a32" fill-opacity=".22" fill-rule="evenodd" stroke="#f15a24" stroke-width="7" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </g>
    <circle cx="${anchor.x.toFixed(1)}" cy="${anchor.y.toFixed(1)}" r="8" fill="#f15a24" stroke="#fff" stroke-width="3"/>
    <rect x="${Math.max(MAP_X + 8, Math.min(MAP_X + MAP_WIDTH - 220, anchor.x - 105)).toFixed(1)}" y="${labelY.toFixed(1)}" width="210" height="34" rx="8" fill="#fff" fill-opacity=".94" stroke="#f15a24" stroke-width="2"/>
    <text x="${anchor.x.toFixed(1)}" y="${(labelY + 22).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#a43f1b">PARCELLE ${escapeXml(context.parcelReference)}</text>
    <rect x="78" y="666" width="500" height="70" rx="10" fill="#fff" fill-opacity=".92"/>
    <text x="98" y="694" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#102a56">PARCELLE ${escapeXml(context.parcelReference)} · ${Math.round(context.parcelAreaM2)} m²</text>
    <text x="98" y="719" font-family="Arial,sans-serif" font-size="14" fill="#4b5563">Contour vectoriel officiel APICARTO Cadastre${context.cadastralOverlaySource ? " · limites cadastrales IGN" : ""}</text>
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
        "Adresse retrouvée par le géocodage IGN",
        `Parcelle ${context.parcelReference} retrouvée par géocodage inverse`,
        "Géométrie vectorielle officielle récupérée par APICARTO Cadastre",
        "Contour cadastral projeté mathématiquement dans la même emprise EPSG:3857 que l'orthophoto",
        `Superficie cadastrale officielle : ${Math.round(context.parcelAreaM2)} m²`,
        "Orthophoto officielle récupérée indépendamment de la couche cadastrale",
        "Nord et parcelle du projet représentés",
      ],
      issues: context.cadastralOverlaySource ? [] : ["La couche contextuelle des limites cadastrales voisines est indisponible ; le contour vectoriel officiel de la parcelle du projet reste présent."],
    },
  };
}
