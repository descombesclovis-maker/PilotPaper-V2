import { AIVisualGenerator } from "@/lib/dp-ai-engine/generators/aiVisualGenerator";
import { buildDP5RoofPlan } from "@/lib/dp-ai-engine/generators/dp5RoofPlan";
import { allPanelPolygonsForRoleProjective } from "@/lib/dp-ai-engine/geometry/panelProjection";
import { resolveProjectLayout } from "@/lib/dp-ai-engine/geometry/projectLayout";
import { configFromEnv } from "@/lib/dp-ai-engine/config";
import { OpenAIImageEditor } from "@/lib/dp-ai-engine/providers/openaiImage";
import { OpenAIQualityJudge } from "@/lib/dp-ai-engine/providers/openaiJudge";
import { OpenAIVisionAnalyzer } from "@/lib/dp-ai-engine/providers/openaiVision";
import type { DPNumber, InputPhoto, ProjectContext, ProjectForm, QualityReport } from "@/lib/dp-ai-engine/types";
import { getDpPieceContract } from "@/lib/dp-piece-contract";
import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";

const IGN_WMS_ENDPOINT = "https://data.geopf.fr/wms-r/wms";
const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 1000;
const WEB_MERCATOR_LIMIT = 20_037_508.342789244;

type PiecePhotoInput = {
  role: "near" | "roof" | "far";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
  filename?: string;
};

export type DpPieceInput = {
  dp: DPNumber;
  address: string;
  parcelReference?: string;
  moduleReference?: string;
  panelCount?: number;
  rows?: number;
  columns?: number;
  orientation?: "portrait" | "landscape";
  placement?: "centered" | "left" | "right" | "custom";
  roofFace?: string;
  roofWidthMm?: number;
  roofSlopeLengthMm?: number;
  roofSlopeDeg?: number;
  gutterClearanceMm?: number;
  interPanelGapMm?: number;
  photos?: PiecePhotoInput[];
};

export type DpPieceOutput = {
  dp: DPNumber;
  title: string;
  validationStatus: "test_unverified";
  mimeType: string;
  base64?: string;
  text?: string;
  sourceSummary: string[];
  inspector: {
    passed: boolean;
    score: number;
    checks: string[];
    issues: string[];
  };
};

type IgnContext = {
  normalizedAddress: string;
  longitude: number;
  latitude: number;
  municipality: string;
  parcelReference: string;
  situation: InputPhoto;
  mass: InputPhoto;
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

function assertPositiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} doit être un entier positif.`);
  return parsed;
}

function bytesToBase64(bytes: ArrayBuffer) {
  return Buffer.from(bytes).toString("base64");
}

function toWebMercator(longitude: number, latitude: number) {
  const boundedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  return {
    x: (longitude * WEB_MERCATOR_LIMIT) / 180,
    y: (Math.log(Math.tan(((90 + boundedLatitude) * Math.PI) / 360)) * WEB_MERCATOR_LIMIT) / Math.PI,
  };
}

function buildIgnImageUrl(longitude: number, latitude: number, widthMeters: number, heightMeters: number) {
  const { x, y } = toWebMercator(longitude, latitude);
  const url = new URL(IGN_WMS_ENDPOINT);
  const params: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: "HR.ORTHOIMAGERY.ORTHOPHOTOS,CADASTRALPARCELS.PARCELLAIRE_EXPRESS",
    STYLES: "normal,normal",
    CRS: "EPSG:3857",
    BBOX: [x - widthMeters / 2, y - heightMeters / 2, x + widthMeters / 2, y + heightMeters / 2].join(","),
    WIDTH: String(IMAGE_WIDTH),
    HEIGHT: String(IMAGE_HEIGHT),
    FORMAT: "image/png",
    TRANSPARENT: "false",
  };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

async function fetchPng(url: URL) {
  const response = await fetch(url, { headers: { Accept: "image/png" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`La Géoplateforme IGN a refusé la vue (${response.status}).`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 10_000) throw new Error("La vue IGN reçue n'est pas exploitable.");
  return bytes;
}

async function resolveIgnContext(address: string): Promise<IgnContext> {
  const cleanAddress = address.trim();
  if (cleanAddress.length < 8) throw new Error("Adresse trop imprécise pour les sources IGN.");
  const search = new URL("https://data.geopf.fr/geocodage/search");
  search.searchParams.set("q", cleanAddress);
  search.searchParams.set("index", "address");
  search.searchParams.set("limit", "1");
  const response = await fetch(search, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Géocodage IGN indisponible (${response.status}).`);
  const payload = await response.json() as { features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> }> };
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
  const parcelReference = [section, parcelNumber].filter(Boolean).join(" ");
  if (!parcelReference) throw new Error("La parcelle cadastrale n'a pas été déterminée avec certitude.");

  const situationUrl = buildIgnImageUrl(longitude, latitude, 2500, 1786);
  const massUrl = buildIgnImageUrl(longitude, latitude, 90, 64.3);
  const [situationBytes, massBytes] = await Promise.all([fetchPng(situationUrl), fetchPng(massUrl)]);
  return {
    normalizedAddress: String(props.label ?? props.name ?? cleanAddress),
    longitude,
    latitude,
    municipality: String(props.city ?? ""),
    parcelReference,
    situation: {
      role: "satellite",
      mimeType: "image/png",
      base64: bytesToBase64(situationBytes),
      filename: "ign-situation.png",
      widthPx: IMAGE_WIDTH,
      heightPx: IMAGE_HEIGHT,
      metersPerPixel: 2500 / IMAGE_WIDTH,
    },
    mass: {
      role: "satellite_mass",
      mimeType: "image/png",
      base64: bytesToBase64(massBytes),
      filename: "ign-masse.png",
      widthPx: IMAGE_WIDTH,
      heightPx: IMAGE_HEIGHT,
      metersPerPixel: 90 / IMAGE_WIDTH,
    },
  };
}

function buildProjectForm(input: DpPieceInput): ProjectForm {
  const module = requireVerifiedPvModule(input.moduleReference ?? "");
  const panelCount = assertPositiveInteger(input.panelCount, "Le nombre de panneaux");
  const rows = assertPositiveInteger(input.rows, "Le nombre de rangées");
  const columns = assertPositiveInteger(input.columns, "Le nombre de colonnes");
  if (rows * columns !== panelCount) {
    throw new Error(`Le calepinage ${rows} × ${columns} ne correspond pas aux ${panelCount} panneaux demandés.`);
  }
  const roofWidthMm = number(input.roofWidthMm, 0);
  const roofSlopeLengthMm = number(input.roofSlopeLengthMm, 0);
  const roofSlopeDeg = number(input.roofSlopeDeg, 0);
  return {
    projectId: `v1-dp${input.dp}-${crypto.randomUUID()}`,
    address: input.address.trim(),
    parcelReference: input.parcelReference?.trim() || undefined,
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
    roofGeometry: roofWidthMm > 0 && roofSlopeLengthMm > 0 ? {
      widthMm: roofWidthMm,
      slopeLengthMm: roofSlopeLengthMm,
      slopeDeg: roofSlopeDeg > 0 ? roofSlopeDeg : undefined,
      source: "form",
    } : undefined,
    support: { topology: "pitched", covering: "unknown", existingStructure: true },
  };
}

function photoByRole(input: DpPieceInput, role: PiecePhotoInput["role"]) {
  return input.photos?.find((photo) => photo.role === role);
}

function asInputPhoto(photo: PiecePhotoInput): InputPhoto {
  if (!photo.base64 || photo.base64.length < 1000) throw new Error(`La photo ${photo.role} est absente ou illisible.`);
  return { ...photo };
}

function documentFrame(args: { code: string; title: string; address: string; body: string; footer?: string; width?: number; height?: number }) {
  const width = args.width ?? 1200;
  const height = args.height ?? 900;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#f7f7f4"/>
    <rect x="30" y="30" width="${width - 60}" height="${height - 60}" rx="18" fill="#fff" stroke="#d9dde2" stroke-width="2"/>
    <rect x="58" y="58" width="76" height="44" rx="10" fill="#102a56"/>
    <text x="96" y="87" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#fff">${escapeXml(args.code)}</text>
    <text x="158" y="87" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#17191d">${escapeXml(args.title)}</text>
    <text x="58" y="126" font-family="Arial,sans-serif" font-size="16" fill="#656b75">${escapeXml(args.address)}</text>
    ${args.body}
    <line x1="58" y1="${height - 68}" x2="${width - 58}" y2="${height - 68}" stroke="#102a56" stroke-width="2"/>
    <text x="58" y="${height - 43}" font-family="Arial,sans-serif" font-size="13" fill="#68717d">PilotPaper V1 · MODE TEST · NON VALIDÉ</text>
    <text x="${width - 58}" y="${height - 43}" text-anchor="end" font-family="Arial,sans-serif" font-size="13" fill="#68717d">${escapeXml(args.footer ?? "Validation K-par-K")}</text>
  </svg>`;
}

function dp1Svg(ign: IgnContext) {
  const image = `data:image/png;base64,${ign.situation.base64}`;
  const body = `<rect x="58" y="154" width="1084" height="620" rx="12" fill="#edf0f2"/>
    <image href="${image}" x="70" y="166" width="1060" height="590" preserveAspectRatio="xMidYMid slice"/>
    <circle cx="600" cy="461" r="25" fill="none" stroke="#c2643b" stroke-width="7"/>
    <circle cx="600" cy="461" r="7" fill="#c2643b"/>
    <rect x="78" y="666" width="390" height="70" rx="10" fill="#fff" fill-opacity=".92"/>
    <text x="98" y="694" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#102a56">PARCELLE ${escapeXml(ign.parcelReference)}</text>
    <text x="98" y="719" font-family="Arial,sans-serif" font-size="14" fill="#4b5563">Source officielle : IGN Géoplateforme</text>
    <text x="1080" y="205" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#102a56">N</text>
    <path d="M1080 218 L1068 252 L1080 243 L1092 252 Z" fill="#102a56"/>`;
  return documentFrame({ code: "DP1", title: "Plan de situation", address: ign.normalizedAddress, body, footer: `${ign.municipality} · ${ign.parcelReference}` });
}

function panelSvg(polygons: Array<Array<{ x: number; y: number }>>, x: number, y: number, w: number, h: number) {
  return polygons.map((polygon, index) => {
    const points = polygon.map((point) => `${(x + point.x * w).toFixed(1)},${(y + point.y * h).toFixed(1)}`).join(" ");
    return `<polygon data-module="${index + 1}" points="${points}" fill="#152d4d" fill-opacity=".92" stroke="#e8f1fb" stroke-width="2"/>`;
  }).join("");
}

async function analyzeRoof(form: ProjectForm, ign: IgnContext, userPhotos: InputPhoto[]) {
  const config = configFromEnv();
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY absente du poste local.");
  const analyzer = new OpenAIVisionAnalyzer(config.openaiApiKey, config.analysisModel);
  return analyzer.analyze(form, [ign.situation, ign.mass, ...userPhotos]);
}

function dp2Svg(ign: IgnContext, context: ProjectContext) {
  const polygons = allPanelPolygonsForRoleProjective(context, "satellite_mass");
  if (!polygons || polygons.length !== context.exactPanelCount) {
    throw new Error("DP2 bloquée : la projection aérienne ne démontre pas exactement tous les modules.");
  }
  const x = 70, y = 166, w = 1060, h = 590;
  const body = `<rect x="58" y="154" width="1084" height="620" rx="12" fill="#edf0f2"/>
    <image href="data:image/png;base64,${ign.mass.base64}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/>
    ${panelSvg(polygons, x, y, w, h)}
    <rect x="78" y="660" width="430" height="78" rx="10" fill="#fff" fill-opacity=".94"/>
    <text x="98" y="688" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#102a56">${context.exactPanelCount} MODULES · ${context.array.rows} × ${context.array.columns}</text>
    <text x="98" y="715" font-family="Arial,sans-serif" font-size="14" fill="#4b5563">Projection homographique · parcelle ${escapeXml(ign.parcelReference)}</text>`;
  return documentFrame({ code: "DP2", title: "Plan de masse — état projeté", address: ign.normalizedAddress, body, footer: "Projection déterministe contrôlée" });
}

function dp3Svg(input: DpPieceInput, form: ProjectForm) {
  const slopeDeg = number(input.roofSlopeDeg, 0);
  const slopeLength = number(input.roofSlopeLengthMm, 0);
  if (!(slopeDeg > 0 && slopeDeg < 70)) throw new Error("DP3 : renseignez une pente de toiture fiable comprise entre 0 et 70°.");
  if (slopeLength <= 0) throw new Error("DP3 : la longueur réelle du rampant est nécessaire pour publier une coupe cotée.");
  const layout = resolveProjectLayout(form);
  const angle = slopeDeg * Math.PI / 180;
  const start = { x: 180, y: 615 };
  const length = 700;
  const end = { x: start.x + Math.cos(angle) * length, y: start.y - Math.sin(angle) * length };
  const panelW = 500;
  const panelStartX = start.x + Math.cos(angle) * 120;
  const panelStartY = start.y - Math.sin(angle) * 120 - 18;
  const body = `<rect x="70" y="170" width="1060" height="590" rx="12" fill="#fbfbfa" stroke="#e0e3e6"/>
    <line x1="110" y1="650" x2="1090" y2="650" stroke="#9ca3af" stroke-width="2" stroke-dasharray="8 8"/>
    <line x1="${start.x}" y1="${start.y}" x2="${end.x.toFixed(1)}" y2="${end.y.toFixed(1)}" stroke="#8b5b3e" stroke-width="16" stroke-linecap="round"/>
    <line x1="${panelStartX.toFixed(1)}" y1="${panelStartY.toFixed(1)}" x2="${(panelStartX + Math.cos(angle) * panelW).toFixed(1)}" y2="${(panelStartY - Math.sin(angle) * panelW).toFixed(1)}" stroke="#152d4d" stroke-width="20" stroke-linecap="round"/>
    <text x="110" y="210" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#102a56">Pente vérifiée : ${slopeDeg.toFixed(1)}°</text>
    <text x="110" y="244" font-family="Arial,sans-serif" font-size="17" fill="#4b5563">Rampant : ${(slopeLength / 1000).toFixed(2)} m · recul bas ${Math.round(form.array.gutterClearanceMm ?? 300)} mm</text>
    <text x="110" y="278" font-family="Arial,sans-serif" font-size="17" fill="#4b5563">Champ : ${(layout.primaryFieldWidthMm / 1000).toFixed(3)} × ${(layout.primaryFieldHeightMm / 1000).toFixed(3)} m</text>
    <text x="110" y="312" font-family="Arial,sans-serif" font-size="17" fill="#4b5563">${layout.count} modules ${escapeXml(form.panel.model)} · ${form.array.orientation}</text>
    <text x="110" y="706" font-family="Arial,sans-serif" font-size="14" fill="#68717d">Terrain / niveau de référence</text>`;
  return documentFrame({ code: "DP3", title: "Plan en coupe", address: input.address, body, footer: "Cotes issues du formulaire de test" });
}

function contextForMetricPlan(form: ProjectForm): ProjectContext {
  const layout = resolveProjectLayout(form);
  const primary = layout.placements[0];
  return {
    projectId: form.projectId,
    address: form.address,
    array: form.array,
    panel: form.panel,
    exactPanelCount: layout.count,
    fieldWidthMm: layout.primaryFieldWidthMm,
    fieldHeightMm: layout.primaryFieldHeightMm,
    roof: {
      selectedFaceDescription: form.array.roofFace,
      confidence: 1,
      obstacles: [],
      perspectiveNotes: [],
      uncertainties: [],
    },
    roofGeometry: form.roofGeometry,
    facePlacements: layout.placements,
    resolvedPlacement: primary ? {
      leftMm: primary.resolvedLeftMm ?? 0,
      rightMm: primary.resolvedRightMm ?? 0,
      gutterMm: primary.resolvedGutterMm,
      ridgeMm: primary.resolvedRidgeMm ?? 0,
    } : undefined,
    support: form.support,
    immutableFacts: ["V1 isolated DP5 metric test"],
  };
}

function photoEvidenceSvg(dp: 7 | 8, input: DpPieceInput, photo: InputPhoto) {
  const title = dp === 7 ? "Photographie de l'environnement proche" : "Photographie du paysage lointain";
  const body = `<rect x="58" y="154" width="1084" height="620" rx="12" fill="#edf0f2"/>
    <image href="data:${photo.mimeType};base64,${photo.base64}" x="70" y="166" width="1060" height="590" preserveAspectRatio="xMidYMid meet"/>
    <rect x="78" y="690" width="430" height="46" rx="8" fill="#fff" fill-opacity=".9"/>
    <text x="96" y="718" font-family="Arial,sans-serif" font-size="14" fill="#334155">Photographie source conservée sans modification générative.</text>`;
  return documentFrame({ code: `DP${dp}`, title, address: input.address, body, footer: photo.filename ?? "Source utilisateur" });
}

function qualityInspector(quality: QualityReport | undefined, extraChecks: string[] = []) {
  if (!quality) return { passed: true, score: 1, checks: extraChecks, issues: [] as string[] };
  return {
    passed: quality.passed,
    score: quality.score,
    checks: [
      ...extraChecks,
      `Nombre de modules attendu : ${quality.panelCountObserved ?? "contrôlé par projection"}`,
      `Bâtiment préservé : ${quality.buildingPreserved ? "oui" : "non"}`,
      `Perspective cohérente : ${quality.perspectiveCoherent ? "oui" : "non"}`,
      `Placement cohérent : ${quality.placementCoherent ? "oui" : "non"}`,
    ],
    issues: quality.issues.map((issue) => `${issue.code} — ${issue.message}`),
  };
}

export async function generateDpPiece(input: DpPieceInput): Promise<DpPieceOutput> {
  const contract = getDpPieceContract(input.dp);
  if (!contract) throw new Error("Pièce DP inconnue.");
  if (!input.address?.trim()) throw new Error("L'adresse du projet est requise.");
  const sources: string[] = [];

  if (input.dp === 1) {
    const ign = await resolveIgnContext(input.address);
    sources.push("IGN Géoplateforme — géocodage, orthophoto et cadastre");
    return { dp: 1, title: contract.title, validationStatus: "test_unverified", mimeType: "image/svg+xml", text: dp1Svg(ign), sourceSummary: sources, inspector: { passed: true, score: 1, checks: ["Adresse retrouvée par l'IGN", `Parcelle ${ign.parcelReference} retrouvée`, "Nord et localisation représentés"], issues: [] } };
  }

  if (input.dp === 7 || input.dp === 8) {
    const role = input.dp === 7 ? "near" : "far";
    const photo = photoByRole(input, role);
    if (!photo) throw new Error(`DP${input.dp} : la photographie ${role === "near" ? "proche" : "lointaine"} est requise.`);
    const normalized = asInputPhoto(photo);
    sources.push(`Photographie utilisateur ${normalized.filename ?? role}`);
    return { dp: input.dp, title: contract.title, validationStatus: "test_unverified", mimeType: "image/svg+xml", text: photoEvidenceSvg(input.dp, input, normalized), sourceSummary: sources, inspector: { passed: true, score: 1, checks: ["Source réelle conservée", "Aucune génération de pixels", "Adresse affichée"], issues: [] } };
  }

  const form = buildProjectForm(input);
  sources.push(`Module fabricant vérifié : ${form.panel.model}`);

  if (input.dp === 3) {
    const svg = dp3Svg(input, form);
    return { dp: 3, title: contract.title, validationStatus: "test_unverified", mimeType: "image/svg+xml", text: svg, sourceSummary: sources, inspector: { passed: true, score: 1, checks: ["Calepinage déterministe", "Pente fournie par le testeur", "Dimensions module fabricant"], issues: [] } };
  }

  if (input.dp === 5) {
    if (!form.roofGeometry?.widthMm || !form.roofGeometry?.slopeLengthMm) throw new Error("DP5 : largeur et longueur du rampant sont nécessaires pour ce test métrique isolé.");
    const result = buildDP5RoofPlan(form, contextForMetricPlan(form));
    return { dp: 5, title: contract.title, validationStatus: "test_unverified", mimeType: result.asset.mimeType, text: result.asset.text, base64: result.asset.base64, sourceSummary: sources, inspector: qualityInspector(result.quality, ["Géométrie physique déterministe", "Aucun rendu génératif"])};
  }

  const ign = await resolveIgnContext(input.address);
  sources.push(`IGN : ${ign.normalizedAddress} · parcelle ${ign.parcelReference}`);
  const roofPhoto = photoByRole(input, "roof");
  if (!roofPhoto) throw new Error(`DP${input.dp} : une vue oblique de toiture est requise.`);
  const userPhotos: InputPhoto[] = [asInputPhoto(roofPhoto)];
  const near = photoByRole(input, "near");
  const far = photoByRole(input, "far");
  if (near) userPhotos.push(asInputPhoto(near));
  if (far) userPhotos.push(asInputPhoto(far));
  const context = await analyzeRoof(form, ign, userPhotos);
  sources.push("Roof Understanding Engine — analyse multimodale");

  if (input.dp === 2) {
    const svg = dp2Svg(ign, context);
    return { dp: 2, title: contract.title, validationStatus: "test_unverified", mimeType: "image/svg+xml", text: svg, sourceSummary: sources, inspector: { passed: true, score: context.roof.confidence, checks: [`${context.exactPanelCount} modules projetés`, "Homographie projective", "Parcelle et vue IGN liées à l'adresse"], issues: context.roof.uncertainties } };
  }

  if (input.dp === 4 || input.dp === 6) {
    if (!near) throw new Error(`DP${input.dp} : une vue proche est requise pour l'insertion.`);
    if (input.dp === 6 && !far) throw new Error("DP6 : une vue lointaine est requise pour contrôler le contexte paysager.");
    const config = configFromEnv();
    if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY absente du poste local.");
    const editor = new OpenAIImageEditor(config.openaiApiKey, config.imageModel);
    const judge = new OpenAIQualityJudge(config.openaiApiKey, config.judgeModel, config.qaPassScore, config.realismPassScore);
    const visual = new AIVisualGenerator(editor, judge, Math.max(1, config.maxRetries), false);
    const result = await visual.generate(input.dp, form, context, [ign.situation, ign.mass, ...userPhotos]);
    sources.push("Projection Engine — homographie", "Photorealistic Render Engine — GPT Image", "PilotPaper Inspector — contrôle déterministe + QA");
    return { dp: input.dp, title: contract.title, validationStatus: "test_unverified", mimeType: result.asset.mimeType, base64: result.asset.base64, text: result.asset.text, sourceSummary: sources, inspector: qualityInspector(result.quality, [`Confiance toiture ${(context.roof.confidence * 100).toFixed(1)} %`, `${context.exactPanelCount} modules attendus`]) };
  }

  throw new Error(`DP${input.dp} n'est pas encore câblée dans le moteur isolé.`);
}
