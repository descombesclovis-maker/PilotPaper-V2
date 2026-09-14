import { AIVisualGenerator } from "@/lib/dp-ai-engine/generators/aiVisualGenerator";
import { configFromEnv } from "@/lib/dp-ai-engine/config";
import { OpenAIQualityJudge } from "@/lib/dp-ai-engine/providers/openaiJudge";
import { OpenAISemanticImageEditor } from "@/lib/dp-ai-engine/providers/openaiSemanticImage";
import type { InputPhoto, ProjectContext, ProjectForm, QualityReport } from "@/lib/dp-ai-engine/types";
import type { DpPieceInput, DpPieceOutput } from "@/lib/dp-piece-engine";
import { getDpPieceContract } from "@/lib/dp-piece-contract";
import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";
import { lockSiteTwinProperty } from "@/lib/site-twin-v2/propertyLock";

const IGN_WMS_ENDPOINT = "https://data.geopf.fr/wms-r/wms";
const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 1000;
const WEB_MERCATOR_LIMIT = 20_037_508.342789244;
const PHOTO_IMAGE_MODEL = "gpt-image-2";

type DirectDpNumber = 2 | 3 | 4 | 5 | 6;

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} doit être un entier positif.`);
  return parsed;
}

function finite(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toWebMercator(longitude: number, latitude: number) {
  const boundedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  return {
    x: (longitude * WEB_MERCATOR_LIMIT) / 180,
    y: (Math.log(Math.tan(((90 + boundedLatitude) * Math.PI) / 360)) * WEB_MERCATOR_LIMIT) / Math.PI,
  };
}

function ignImageUrl(longitude: number, latitude: number, widthMeters: number, heightMeters: number) {
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
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function fetchIgnImage(role: "satellite" | "satellite_mass", longitude: number, latitude: number) {
  const close = role === "satellite_mass";
  const response = await fetch(
    ignImageUrl(longitude, latitude, close ? 90 : 1800, close ? 64.3 : 1286),
    { headers: { Accept: "image/png" }, signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw new Error(`IGN : vue ${role} indisponible (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 10_000 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
    throw new Error(`IGN : vue ${role} invalide.`);
  }
  return {
    role,
    mimeType: "image/png" as const,
    base64: bytes.toString("base64"),
    filename: role === "satellite_mass" ? "ign-masse.png" : "ign-situation.png",
    widthPx: IMAGE_WIDTH,
    heightPx: IMAGE_HEIGHT,
    metersPerPixel: (close ? 90 : 1800) / IMAGE_WIDTH,
  } satisfies InputPhoto;
}

function buildFormAndContext(input: DpPieceInput, normalizedAddress: string, parcelReference: string) {
  const pvModule = requireVerifiedPvModule(input.moduleReference ?? "");
  const panelCount = positiveInteger(input.panelCount, "Le nombre de panneaux");
  const rows = positiveInteger(input.rows, "Le nombre de rangées");
  const columns = positiveInteger(input.columns, "Le nombre de colonnes");
  if (rows * columns !== panelCount) {
    throw new Error(`${rows} × ${columns} ne correspond pas à ${panelCount} panneaux.`);
  }
  const orientation = input.orientation === "landscape" ? "landscape" : "portrait";
  const gap = Math.max(0, finite(input.interPanelGapMm, 20));
  const panelWidth = orientation === "portrait" ? pvModule.widthMm : pvModule.heightMm;
  const panelHeight = orientation === "portrait" ? pvModule.heightMm : pvModule.widthMm;
  const fieldWidthMm = columns * panelWidth + Math.max(0, columns - 1) * gap;
  const fieldHeightMm = rows * panelHeight + Math.max(0, rows - 1) * gap;
  const roofFace = input.dp === 2
    ? input.roofFace?.trim() || "zone de toiture sélectionnée sur la vue aérienne"
    : "pan de toiture à identifier directement sur la photographie réelle fournie";
  const gutter = Math.max(0, finite(input.gutterClearanceMm, 300));
  const roofWidthMm = finite(input.roofWidthMm, 0);
  const roofSlopeLengthMm = finite(input.roofSlopeLengthMm, 0);
  const roofSlopeDeg = finite(input.roofSlopeDeg, 0);

  const form: ProjectForm = {
    projectId: `direct-dp${input.dp}-${crypto.randomUUID()}`,
    address: normalizedAddress,
    parcelReference,
    panel: {
      manufacturer: pvModule.manufacturer,
      model: pvModule.canonicalReference,
      widthMm: pvModule.widthMm,
      heightMm: pvModule.heightMm,
      frameColor: "black",
      powerWp: pvModule.powerWp,
    },
    requestedPanelCount: panelCount,
    array: {
      rows,
      columns,
      orientation,
      roofFace,
      placement: input.placement ?? "centered",
      layoutMode: "fixed",
      gutterClearanceMm: gutter,
      interPanelGapMm: gap,
    },
    roofGeometry: roofWidthMm > 0 && roofSlopeLengthMm > 0 ? {
      widthMm: roofWidthMm,
      slopeLengthMm: roofSlopeLengthMm,
      slopeDeg: roofSlopeDeg > 0 ? roofSlopeDeg : undefined,
      source: "form",
    } : undefined,
    support: { topology: "pitched", covering: "unknown", existingStructure: true },
  };

  const facts = [
    `Adresse verrouillée : ${normalizedAddress}.`,
    `Parcelle cadastrale : ${parcelReference}.`,
    `Module : ${pvModule.canonicalReference} — ${pvModule.widthMm} × ${pvModule.heightMm} mm.`,
    `Quantité exacte : ${panelCount} modules.`,
    `Matrice demandée : ${rows} × ${columns}.`,
    `Orientation : ${orientation}.`,
    `Champ théorique : ${fieldWidthMm} × ${fieldHeightMm} mm, jeu ${gap} mm.`,
    `Recul bas préféré : ${gutter} mm ; il ne doit pas forcer un panneau sur un obstacle.`,
    input.dp === 2
      ? `Zone/pan demandé depuis la vue aérienne : ${roofFace}.`
      : "Le pan cible et les obstacles doivent être compris directement depuis la photographie réelle ; aucune sélection de pan satellite ne fait autorité pour cette pièce.",
  ];
  if (roofWidthMm > 0) facts.push(`Largeur métrique fournie du pan : ${roofWidthMm} mm.`);
  if (roofSlopeLengthMm > 0) facts.push(`Rampant métrique fourni : ${roofSlopeLengthMm} mm.`);
  if (roofSlopeDeg > 0) facts.push(`Pente métrique fournie : ${roofSlopeDeg}°.`);

  const context: ProjectContext = {
    projectId: form.projectId,
    address: normalizedAddress,
    array: form.array,
    panel: form.panel,
    exactPanelCount: panelCount,
    fieldWidthMm,
    fieldHeightMm,
    roof: {
      selectedFaceDescription: roofFace,
      confidence: input.dp === 2 ? 0.8 : 0.95,
      obstacles: [],
      perspectiveNotes: [],
      uncertainties: [],
    },
    roofGeometry: form.roofGeometry,
    support: form.support,
    immutableFacts: facts,
  };
  return { form, context };
}

function validatePhotoEvidence(dp: DirectDpNumber, userPhotos: InputPhoto[]) {
  const has = (...roles: InputPhoto["role"][]) => userPhotos.some((photo) => roles.includes(photo.role));
  if (dp === 2) return;
  if (dp === 3 && !has("roof", "near")) {
    throw new Error("DP3 ChatGPT Image : ajoutez une vraie photo lisible de la maison et de sa toiture.");
  }
  if (dp === 4 && !has("roof", "near", "front", "left_oblique", "right_oblique")) {
    throw new Error("DP4 ChatGPT Image : une vraie photo lisible de la maison et de sa toiture est requise.");
  }
  if (dp === 5 && !has("roof", "near")) {
    throw new Error("DP5 ChatGPT Image : une vraie photo lisible de la maison et de sa toiture est requise.");
  }
  if (dp === 6 && !has("far")) {
    throw new Error("DP6 ChatGPT Image : une vraie vue contextualisée est requise pour l'insertion dans l'environnement.");
  }
}

function inspector(quality: QualityReport) {
  return {
    passed: quality.passed,
    score: quality.score,
    checks: [
      `Bâtiment/site préservé : ${quality.buildingPreserved ? "oui" : "non"}`,
      `Échelle cohérente : ${quality.scaleCoherent ? "oui" : "non"}`,
      `Placement cohérent : ${quality.placementCoherent ? "oui" : "non"}`,
      `Pan/support correct : ${quality.roofFaceCorrect ? "oui" : "non"}`,
      `Obstacle / limite franchi : ${quality.crossesRidge ? "oui" : "non"}`,
    ],
    issues: quality.issues.map((issue) => `${issue.code} — ${issue.message}`),
  };
}

export async function generateDirectChatGptDp(input: DpPieceInput & { dp: DirectDpNumber }): Promise<DpPieceOutput> {
  const contract = getDpPieceContract(input.dp);
  if (!contract) throw new Error(`Contrat DP${input.dp} introuvable.`);
  if (!input.address?.trim()) throw new Error("L'adresse exacte du projet est requise.");

  const property = await lockSiteTwinProperty(input.address);
  const [longitude, latitude] = property.addressPoint;
  const parcelReference = property.parcel.reference;
  const { form, context } = buildFormAndContext(input, property.normalizedAddress, parcelReference);

  const userPhotos: InputPhoto[] = (input.photos ?? []).map((photo) => ({ ...photo }));
  validatePhotoEvidence(input.dp, userPhotos);

  let photos: InputPhoto[];
  if (input.dp === 2) {
    const [situation, mass] = await Promise.all([
      fetchIgnImage("satellite", longitude, latitude),
      fetchIgnImage("satellite_mass", longitude, latitude),
    ]);
    photos = [mass, situation, ...userPhotos];
  } else {
    photos = [...userPhotos];
  }

  const config = configFromEnv();
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY absente du poste local.");
  const imageModel = input.dp >= 3 && input.dp <= 6 ? PHOTO_IMAGE_MODEL : config.imageModel;
  const editor = new OpenAISemanticImageEditor(config.openaiApiKey, imageModel);
  const judge = new OpenAIQualityJudge(config.openaiApiKey, config.judgeModel, config.qaPassScore, config.realismPassScore);

  // Exact chat-like flow for photographic pieces:
  // 1 real image + form choices -> one GPT Image edit -> one independent QA pass.
  // No satellite roof selection, no precomputed mask and no autonomous retry loop.
  const maxRetries = input.dp === 2 ? Math.min(1, Math.max(0, config.maxRetries)) : 0;
  const generator = new AIVisualGenerator(editor, judge, maxRetries, config.testFast === true);
  const result = await generator.generate(input.dp, form, context, photos);

  const sourceSummary = [
    `Property Lock : ${property.normalizedAddress} · parcelle ${parcelReference}`,
    input.dp === 2
      ? "DP2 : vue IGN orthophoto/cadastre + sélection de zone toiture satellite"
      : `DP${input.dp} : une photo réelle + configuration formulaire -> ${PHOTO_IMAGE_MODEL} -> Inspector indépendant`,
    "ChatGPT Image direct — image complète, aucun masque de panneaux imposé en amont",
    input.dp === 2 ? "Maximum 2 rendus pour DP2" : "Un seul rendu image avant contrôle de conformité",
    "PilotPaper Inspector — contrôle indépendant après génération",
  ];

  return {
    dp: input.dp,
    title: contract.title,
    validationStatus: "test_unverified",
    mimeType: result.asset.mimeType,
    base64: result.asset.base64,
    text: result.asset.text,
    sourceSummary,
    inspector: inspector(result.quality),
  };
}
