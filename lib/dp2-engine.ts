import { configFromEnv } from "@/lib/dp-ai-engine/config";
import { allPanelPolygonsForRoleProjective } from "@/lib/dp-ai-engine/geometry/panelProjection";
import { OpenAIVisionAnalyzer } from "@/lib/dp-ai-engine/providers/openaiVision";
import type { InputPhoto, ProjectForm } from "@/lib/dp-ai-engine/types";
import type { DpPieceInput, DpPieceOutput } from "@/lib/dp-piece-engine";
import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";

const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 1000;
const WEB_MERCATOR_LIMIT = 20_037_508.342789244;

type IgnDp2Context = {
  normalizedAddress: string;
  municipality: string;
  parcelReference: string;
  longitude: number;
  latitude: number;
  situation: InputPhoto;
  mass: InputPhoto;
  cadastralOverlay: string;
  imagerySource: string;
  cadastreSource: string;
};

type RasterCandidate = {
  label: string;
  url: URL;
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

function number(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} doit être un entier positif.`);
  return parsed;
}

function toWebMercator(longitude: number, latitude: number) {
  const boundedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  return {
    x: (longitude * WEB_MERCATOR_LIMIT) / 180,
    y: (Math.log(Math.tan(((90 + boundedLatitude) * Math.PI) / 360)) * WEB_MERCATOR_LIMIT) / Math.PI,
  };
}

function wmsUrl(args: {
  endpoint: string;
  layer: string;
  style?: string;
  longitude: number;
  latitude: number;
  widthMeters: number;
  heightMeters: number;
  transparent?: boolean;
}) {
  const { x, y } = toWebMercator(args.longitude, args.latitude);
  const url = new URL(args.endpoint);
  const params: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: args.layer,
    STYLES: args.style ?? "",
    CRS: "EPSG:3857",
    BBOX: [
      x - args.widthMeters / 2,
      y - args.heightMeters / 2,
      x + args.widthMeters / 2,
      y + args.heightMeters / 2,
    ].join(","),
    WIDTH: String(IMAGE_WIDTH),
    HEIGHT: String(IMAGE_HEIGHT),
    FORMAT: "image/png",
    TRANSPARENT: args.transparent ? "true" : "false",
  };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

function orthophotoCandidates(longitude: number, latitude: number, widthMeters: number, heightMeters: number): RasterCandidate[] {
  return [
    {
      label: "IGN orthophoto standard",
      url: wmsUrl({ endpoint: "https://data.geopf.fr/wms-r/wms", layer: "ORTHOIMAGERY.ORTHOPHOTOS", longitude, latitude, widthMeters, heightMeters }),
    },
    {
      label: "IGN orthophoto haute résolution",
      url: wmsUrl({ endpoint: "https://data.geopf.fr/wms-r/wms", layer: "HR.ORTHOIMAGERY.ORTHOPHOTOS", style: "normal", longitude, latitude, widthMeters, heightMeters }),
    },
    {
      label: "IGN orthophoto standard secours",
      url: wmsUrl({ endpoint: "https://data.geopf.fr/wms-r", layer: "ORTHOIMAGERY.ORTHOPHOTOS", longitude, latitude, widthMeters, heightMeters }),
    },
  ];
}

function cadastralCandidates(longitude: number, latitude: number, widthMeters: number, heightMeters: number): RasterCandidate[] {
  return [
    {
      label: "IGN Parcellaire Express",
      url: wmsUrl({
        endpoint: "https://data.geopf.fr/wms-r/wms",
        layer: "CADASTRALPARCELS.PARCELLAIRE_EXPRESS",
        style: "normal",
        longitude,
        latitude,
        widthMeters,
        heightMeters,
        transparent: true,
      }),
    },
    {
      label: "IGN Parcellaire Express secours",
      url: wmsUrl({
        endpoint: "https://data.geopf.fr/wms-r",
        layer: "CADASTRALPARCELS.PARCELLAIRE_EXPRESS",
        style: "normal",
        longitude,
        latitude,
        widthMeters,
        heightMeters,
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
      if (!response.ok) {
        failures.push(`${candidate.label}:${response.status}`);
        continue;
      }
      if (!contentType.startsWith("image/")) {
        failures.push(`${candidate.label}:type-${contentType || "inconnu"}`);
        continue;
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength < 2_000) {
        failures.push(`${candidate.label}:image-trop-petite`);
        continue;
      }
      return {
        base64: Buffer.from(bytes).toString("base64"),
        source: candidate.label,
      };
    } catch (error) {
      failures.push(`${candidate.label}:${error instanceof Error ? error.name : "erreur"}`);
    }
  }
  console.error(`[dp2] ${purpose} failed`, failures);
  throw new Error(`DP2 bloquée : ${purpose} officielle indisponible après essai des flux IGN principal et de secours.`);
}

async function resolveIgnDp2Context(address: string): Promise<IgnDp2Context> {
  const cleanAddress = address.trim();
  if (cleanAddress.length < 8) throw new Error("Adresse trop imprécise pour les sources IGN.");

  const search = new URL("https://data.geopf.fr/geocodage/search");
  search.searchParams.set("q", cleanAddress);
  search.searchParams.set("index", "address");
  search.searchParams.set("limit", "1");
  const response = await fetch(search, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Géocodage IGN indisponible (${response.status}).`);
  const payload = await response.json() as {
    features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> }>;
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
  const reverseResponse = await fetch(reverse, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!reverseResponse.ok) throw new Error(`Cadastre IGN indisponible (${reverseResponse.status}).`);
  const reversePayload = await reverseResponse.json() as { features?: Array<{ properties?: Record<string, unknown> }> };
  const parcel = reversePayload.features?.[0]?.properties ?? {};
  const section = String(parcel.section ?? "").trim();
  const parcelNumber = String(parcel.number ?? parcel.numero ?? "").trim();
  const officialParcelId = String(parcel.idu ?? parcel.id ?? parcel.parcelle ?? "").trim();
  const parcelReference = [section, parcelNumber].filter(Boolean).join(" ") || officialParcelId;
  if (!parcelReference) throw new Error("La parcelle cadastrale n'a pas été déterminée avec certitude.");

  const situationWidthMeters = 900;
  const situationHeightMeters = 642.9;
  const massWidthMeters = 90;
  const massHeightMeters = 64.3;
  const [situationRaster, massRaster, cadastralRaster] = await Promise.all([
    fetchRaster(orthophotoCandidates(longitude, latitude, situationWidthMeters, situationHeightMeters), "la vue de contexte IGN"),
    fetchRaster(orthophotoCandidates(longitude, latitude, massWidthMeters, massHeightMeters), "la vue métrique rapprochée IGN"),
    fetchRaster(cadastralCandidates(longitude, latitude, massWidthMeters, massHeightMeters), "la couche cadastrale"),
  ]);

  return {
    normalizedAddress: String(props.label ?? props.name ?? cleanAddress),
    municipality: String(props.city ?? props.citycode ?? ""),
    parcelReference,
    longitude,
    latitude,
    situation: {
      role: "satellite",
      mimeType: "image/png",
      base64: situationRaster.base64,
      filename: "ign-dp2-contexte.png",
      widthPx: IMAGE_WIDTH,
      heightPx: IMAGE_HEIGHT,
      metersPerPixel: situationWidthMeters / IMAGE_WIDTH,
    },
    mass: {
      role: "satellite_mass",
      mimeType: "image/png",
      base64: massRaster.base64,
      filename: "ign-dp2-masse.png",
      widthPx: IMAGE_WIDTH,
      heightPx: IMAGE_HEIGHT,
      metersPerPixel: massWidthMeters / IMAGE_WIDTH,
    },
    cadastralOverlay: cadastralRaster.base64,
    imagerySource: massRaster.source,
    cadastreSource: cadastralRaster.source,
  };
}

function asRoofPhoto(input: DpPieceInput): InputPhoto {
  const photo = input.photos?.find((candidate) => candidate.role === "roof");
  if (!photo?.base64 || photo.base64.length < 1000) {
    throw new Error("DP2 : une seule vue oblique de toiture exploitable est requise pour relier le toit réel au plan de masse.");
  }
  return {
    role: "roof",
    mimeType: photo.mimeType,
    base64: photo.base64,
    filename: photo.filename,
  };
}

function buildForm(input: DpPieceInput): ProjectForm {
  const module = requireVerifiedPvModule(input.moduleReference ?? "");
  const panelCount = positiveInteger(input.panelCount, "Le nombre de panneaux");
  const rows = positiveInteger(input.rows, "Le nombre de rangées");
  const columns = positiveInteger(input.columns, "Le nombre de colonnes");
  if (rows * columns !== panelCount) {
    throw new Error(`DP2 : le calepinage ${rows} × ${columns} ne correspond pas aux ${panelCount} panneaux demandés.`);
  }
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
      roofFace: input.roofFace?.trim() || "A",
      placement: input.placement ?? "centered",
      layoutMode: "fixed",
      gutterClearanceMm: Math.max(0, number(input.gutterClearanceMm, 300)),
      interPanelGapMm: Math.max(0, number(input.interPanelGapMm, 20)),
    },
    support: { topology: "pitched", covering: "unknown", existingStructure: true },
  };
}

function panelSvg(polygons: Array<Array<{ x: number; y: number }>>, x: number, y: number, width: number, height: number) {
  return polygons.map((polygon, index) => {
    const points = polygon.map((point) => `${(x + point.x * width).toFixed(1)},${(y + point.y * height).toFixed(1)}`).join(" ");
    return `<polygon data-module="${index + 1}" points="${points}" fill="#142f52" fill-opacity=".94" stroke="#ffffff" stroke-width="2"/>`;
  }).join("");
}

function buildDp2Svg(context: IgnDp2Context, project: Awaited<ReturnType<OpenAIVisionAnalyzer["analyze"]>>) {
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
  const body = `<rect x="58" y="154" width="1084" height="620" rx="12" fill="#edf0f2"/>
    <image href="${orthophoto}" x="${x}" y="${y}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="none"/>
    <image href="${cadastre}" x="${x}" y="${y}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="none" opacity=".92"/>
    ${panelSvg(polygons, x, y, imageWidth, imageHeight)}
    <rect x="82" y="650" width="465" height="86" rx="10" fill="#fff" fill-opacity=".94"/>
    <text x="102" y="680" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#102a56">PARCELLE ${escapeXml(context.parcelReference)} · ${project.exactPanelCount} MODULES</text>
    <text x="102" y="706" font-family="Arial,sans-serif" font-size="14" fill="#4b5563">Calepinage ${project.array.rows} × ${project.array.columns} · ${escapeXml(project.array.orientation)}</text>
    <text x="102" y="728" font-family="Arial,sans-serif" font-size="12" fill="#68717d">Orthophoto + cadastre IGN · projection géométrique contrôlée</text>
    <text x="1082" y="204" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#102a56">N</text>
    <path d="M1082 217 L1070 251 L1082 242 L1094 251 Z" fill="#102a56"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#f7f7f4"/>
    <rect x="30" y="30" width="1140" height="840" rx="18" fill="#fff" stroke="#d9dde2" stroke-width="2"/>
    <rect x="58" y="58" width="76" height="44" rx="10" fill="#102a56"/>
    <text x="96" y="87" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#fff">DP2</text>
    <text x="158" y="87" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#17191d">Plan de masse — état projeté</text>
    <text x="58" y="126" font-family="Arial,sans-serif" font-size="16" fill="#656b75">${escapeXml(context.normalizedAddress)}</text>
    ${body}
    <line x1="58" y1="832" x2="1142" y2="832" stroke="#102a56" stroke-width="2"/>
    <text x="58" y="857" font-family="Arial,sans-serif" font-size="13" fill="#68717d">PilotPaper V1 · MODE TEST · NON VALIDÉ</text>
    <text x="1142" y="857" text-anchor="end" font-family="Arial,sans-serif" font-size="13" fill="#68717d">${escapeXml(context.municipality)} · ${escapeXml(context.parcelReference)}</text>
  </svg>`;
}

export async function generateDp2Piece(input: DpPieceInput): Promise<DpPieceOutput> {
  if (input.dp !== 2) throw new Error("Le moteur DP2 a reçu une autre pièce.");
  if (!input.address?.trim()) throw new Error("L'adresse du projet est requise.");

  const form = buildForm(input);
  const roofPhoto = asRoofPhoto(input);
  const ign = await resolveIgnDp2Context(input.address);
  const config = configFromEnv();
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY absente du poste local.");

  // DP2 has its own evidence policy: the official IGN views provide the metric
  // orthographic evidence and exactly one user roof photograph links that geometry
  // to the real building. The 3-photo rule belongs to the complete dossier/DP6,
  // not to the isolated DP2 workshop.
  const analyzer = new OpenAIVisionAnalyzer(config.openaiApiKey, config.analysisModel, 1);
  const project = await analyzer.analyze(form, [ign.situation, ign.mass, roofPhoto]);
  const svg = buildDp2Svg(ign, project);

  return {
    dp: 2,
    title: "Plan de masse",
    validationStatus: "test_unverified",
    mimeType: "image/svg+xml",
    text: svg,
    sourceSummary: [
      `IGN Géoplateforme — adresse : ${ign.normalizedAddress}`,
      `IGN Géoplateforme — parcelle : ${ign.parcelReference}`,
      `IGN Géoplateforme — orthophoto : ${ign.imagerySource}`,
      `IGN Géoplateforme — cadastre : ${ign.cadastreSource}`,
      `OpenAI ${config.analysisModel} — compréhension du pan à partir de la vue toiture`,
      "PV Layout Engine — dimensions fabricant et calepinage déterministe",
      "Projection Engine — homographie sur la vue métrique IGN",
    ],
    inspector: {
      passed: true,
      score: project.roof.confidence,
      checks: [
        "Politique DP2 : 1 vue toiture utilisateur + preuves officielles IGN",
        `Parcelle ${ign.parcelReference} identifiée`,
        "Couche cadastrale récupérée séparément de l'orthophoto",
        `Roof Understanding Engine exécuté avec OpenAI (${config.analysisModel})`,
        `${project.exactPanelCount} modules projetés par homographie`,
        "Nombre, matrice et dimensions module conservés",
      ],
      issues: project.roof.uncertainties,
    },
  };
}
