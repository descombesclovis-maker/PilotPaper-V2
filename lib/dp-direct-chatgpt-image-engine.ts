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
  const roofFace = input.roofFace?.trim() || "pan sélectionné";
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
    `Pan/support demandé : ${roofFace}.`,
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
      confidence: 0.8,
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
    throw new Error("DP3 ChatGPT Image : ajoutez au minimum une vue toiture ou une vue proche du bâtiment.");
  }
  if (dp === 4 && !has("roof", "near", "front", "left_oblique", "right_oblique")) {
    throw new Error("DP4 ChatGPT Image : une vue réelle lisible de la façade/toiture est requise.");
  }
  if (dp === 5 && !has("roof", "near")) {
    throw new Error("DP5 ChatGPT Image : une vue toiture ou une vue proche est requise pour représenter l'aspect extérieur.");
  }
  if (dp === 6 && !has("far")) {
    throw new Error("DP6 ChatGPT Image : une vue lointaine réelle est requise pour l'insertion dans l'environnement.");
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

  // Property identity remains deterministic even though the visual rendering is
  // deliberately delegated to ChatGPT Image.
  const property = await lockSiteTwinProperty(input.address);
  const [longitude, latitude] = property.addressPoint;
  const parcelReference = property.parcel.reference;
  const { form, context } = buildFormAndContext(input, property.normalizedAddress, parcelReference);

  // The API route is the single normalization gate. At this point every user
  // image is already a decoded/re-encoded canonical JPEG.
  const userPhotos: InputPhoto[] = (input.photos ?? []).map((photo) => ({ ...photo }));
  validatePhotoEvidence(input.dp, userPhotos);

  const [situation, mass] = await Promise.all([
    fetchIgnImage("satellite", longitude, latitude),
    fetchIgnImage("satellite_mass", longitude, latitude),
  ]);
  const photos: InputPhoto[] = [situation, mass, ...userPhotos];

  const config = configFromEnv();
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY absente du poste local.");
  const editor = new OpenAISemanticImageEditor(config.openaiApiKey, config.imageModel);
  const judge = new OpenAIQualityJudge(config.openaiApiKey, config.judgeModel, config.qaPassScore, config.realismPassScore);
  const generator = new AIVisualGenerator(editor, judge, Math.max(0, config.maxRetries), config.testFast === true);
  const result = await generator.generate(input.dp, form, context, photos);

  return {
    dp: input.dp,
    title: contract.title,
    validationStatus: "test_unverified",
    mimeType: result.asset.mimeType,
    base64: result.asset.base64,
    text: result.asset.text,
    sourceSummary: [
      `Property Lock : ${property.normalizedAddress} · parcelle ${parcelReference}`,
      "IGN orthophoto/cadastre utilisé comme référence de site",
      "ChatGPT Image direct — image complète, aucun masque de panneaux imposé en amont",
      "PilotPaper Inspector — contrôle indépendant après génération",
    ],
    inspector: inspector(result.quality),
  };
}
