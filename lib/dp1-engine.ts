import type { DpPieceInput, DpPieceOutput } from "@/lib/dp-piece-engine";

const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 1000;
const WEB_MERCATOR_LIMIT = 20_037_508.342789244;

type IgnDp1Context = {
  normalizedAddress: string;
  longitude: number;
  latitude: number;
  municipality: string;
  parcelReference: string;
  situationBase64: string;
  situationMimeType: "image/jpeg" | "image/png";
  imagerySource: string;
};

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

function buildWmsUrl(
  endpoint: string,
  layer: "ORTHOIMAGERY.ORTHOPHOTOS" | "HR.ORTHOIMAGERY.ORTHOPHOTOS",
  style: "" | "normal",
  longitude: number,
  latitude: number,
  widthMeters: number,
  heightMeters: number,
) {
  const { x, y } = toWebMercator(longitude, latitude);
  const url = new URL(endpoint);
  const params: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: layer,
    STYLES: style,
    CRS: "EPSG:3857",
    BBOX: [x - widthMeters / 2, y - heightMeters / 2, x + widthMeters / 2, y + heightMeters / 2].join(","),
    WIDTH: String(IMAGE_WIDTH),
    HEIGHT: String(IMAGE_HEIGHT),
    FORMAT: "image/jpeg",
    TRANSPARENT: "false",
  };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

export function buildDp1IgnWmsCandidates(longitude: number, latitude: number) {
  const widthMeters = 2500;
  const heightMeters = 1786;
  return [
    {
      label: "IGN WMS standard",
      url: buildWmsUrl("https://data.geopf.fr/wms-r/wms", "ORTHOIMAGERY.ORTHOPHOTOS", "", longitude, latitude, widthMeters, heightMeters),
    },
    {
      label: "IGN WMS haute résolution",
      url: buildWmsUrl("https://data.geopf.fr/wms-r/wms", "HR.ORTHOIMAGERY.ORTHOPHOTOS", "normal", longitude, latitude, widthMeters, heightMeters),
    },
    {
      label: "IGN WMS standard secours",
      url: buildWmsUrl("https://data.geopf.fr/wms-r", "ORTHOIMAGERY.ORTHOPHOTOS", "", longitude, latitude, widthMeters, heightMeters),
    },
    {
      label: "IGN WMS haute résolution secours",
      url: buildWmsUrl("https://data.geopf.fr/wms-r", "HR.ORTHOIMAGERY.ORTHOPHOTOS", "normal", longitude, latitude, widthMeters, heightMeters),
    },
  ] as const;
}

async function fetchOfficialSituation(longitude: number, latitude: number) {
  const failures: string[] = [];
  for (const candidate of buildDp1IgnWmsCandidates(longitude, latitude)) {
    try {
      const response = await fetch(candidate.url, {
        headers: { Accept: "image/jpeg,image/png;q=0.9,*/*;q=0.1" },
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
      if (bytes.byteLength < 10_000) {
        failures.push(`${candidate.label}:image-trop-petite`);
        continue;
      }
      const mimeType: "image/jpeg" | "image/png" = contentType.includes("png") ? "image/png" : "image/jpeg";
      return {
        base64: Buffer.from(bytes).toString("base64"),
        mimeType,
        source: candidate.label,
      };
    } catch (error) {
      failures.push(`${candidate.label}:${error instanceof Error ? error.name : "erreur"}`);
    }
  }
  console.error("[dp1] all IGN WMS candidates failed", failures);
  throw new Error("DP1 bloquée : aucune vue aérienne officielle IGN n'a pu être obtenue. PilotPaper a essayé les flux IGN principal et de secours.");
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
  const parcelReference = [section, parcelNumber].filter(Boolean).join(" ") || officialParcelId;
  if (!parcelReference) throw new Error("La parcelle cadastrale n'a pas été déterminée avec certitude.");

  const situation = await fetchOfficialSituation(longitude, latitude);
  return {
    normalizedAddress: String(props.label ?? props.name ?? cleanAddress),
    longitude,
    latitude,
    municipality: String(props.city ?? props.citycode ?? ""),
    parcelReference,
    situationBase64: situation.base64,
    situationMimeType: situation.mimeType,
    imagerySource: situation.source,
  };
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
  const body = `<rect x="58" y="154" width="1084" height="620" rx="12" fill="#edf0f2"/>
    <image href="${image}" x="70" y="166" width="1060" height="590" preserveAspectRatio="xMidYMid slice"/>
    <circle cx="600" cy="461" r="25" fill="none" stroke="#c2643b" stroke-width="7"/>
    <circle cx="600" cy="461" r="7" fill="#c2643b"/>
    <rect x="78" y="666" width="430" height="70" rx="10" fill="#fff" fill-opacity=".92"/>
    <text x="98" y="694" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#102a56">PARCELLE ${escapeXml(context.parcelReference)}</text>
    <text x="98" y="719" font-family="Arial,sans-serif" font-size="14" fill="#4b5563">Orthophoto IGN · cadastre vérifié séparément</text>
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
  return {
    dp: 1,
    title: "Plan de situation",
    validationStatus: "test_unverified",
    mimeType: "image/svg+xml",
    text: buildDp1Svg(context),
    sourceSummary: [
      `IGN Géoplateforme — géocodage officiel : ${context.normalizedAddress}`,
      `IGN Géoplateforme — parcelle cadastrale : ${context.parcelReference}`,
      `IGN Géoplateforme — orthophoto : ${context.imagerySource}`,
    ],
    inspector: {
      passed: true,
      score: 1,
      checks: [
        "Adresse retrouvée par le géocodage IGN",
        `Parcelle ${context.parcelReference} retrouvée séparément du raster`,
        "Orthophoto officielle récupérée sans composition WMS multi-couches",
        "Nord et localisation représentés",
      ],
      issues: [],
    },
  };
}
