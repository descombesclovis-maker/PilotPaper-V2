import { getDpPieceContract } from "@/lib/dp-piece-contract";
import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";
import type {
  DPNumber,
  DpInspectorResult,
  DpPieceInput,
  DpPieceOutput,
  PiecePhotoInput,
  VisualReference,
} from "@/lib/pilotpaper-image2-types";

const IMAGE_MODEL = "gpt-image-2";
const DEFAULT_JUDGE_MODEL = "gpt-5.6-sol";
const IGN_WMS_ENDPOINT = "https://data.geopf.fr/wms-r/wms";
const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 1000;
const WEB_MERCATOR_LIMIT = 20_037_508.342789244;

type DirectDp = 1 | 2 | 3 | 4 | 5 | 6;

type IgnContext = {
  normalizedAddress: string;
  parcelReference: string;
  longitude: number;
  latitude: number;
  situation: PiecePhotoInput;
  close: PiecePhotoInput;
};

type ProjectSpec = {
  panelCount: number;
  rows: number;
  columns: number;
  orientation: "portrait" | "landscape";
  placement: "centered" | "left" | "right" | "custom";
  moduleReference: string;
  manufacturer: string;
  moduleWidthMm: number;
  moduleHeightMm: number;
  fieldWidthMm: number;
  fieldHeightMm: number;
  interPanelGapMm: number;
  gutterClearanceMm: number;
  instructions: string;
};

type JudgePayload = {
  passed: boolean;
  score: number;
  panelCountObserved: number | null;
  rowsObserved: number | null;
  columnsObserved: number | null;
  parcelHighlightCorrect: boolean | null;
  documentRoleCorrect: boolean;
  sourcePreserved: boolean;
  buildingPreserved: boolean | null;
  placementCoherent: boolean | null;
  continuityWithReferences: boolean | null;
  photorealistic: boolean | null;
  issues: string[];
};

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

async function fetchIgnPng(longitude: number, latitude: number, widthMeters: number, heightMeters: number, filename: string): Promise<PiecePhotoInput> {
  const response = await fetch(ignImageUrl(longitude, latitude, widthMeters, heightMeters), {
    headers: { Accept: "image/png" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`IGN : vue indisponible (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 10_000 || bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error("IGN : image reçue invalide.");
  return { role: "roof", mimeType: "image/png", base64: bytes.toString("base64"), filename };
}

async function resolveIgn(address: string): Promise<IgnContext> {
  const cleanAddress = address.trim();
  if (cleanAddress.length < 8) throw new Error("L'adresse exacte du projet est requise.");

  const search = new URL("https://data.geopf.fr/geocodage/search");
  search.searchParams.set("q", cleanAddress);
  search.searchParams.set("index", "address");
  search.searchParams.set("limit", "1");
  const searchResponse = await fetch(search, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!searchResponse.ok) throw new Error(`Géocodage IGN indisponible (${searchResponse.status}).`);
  const searchJson = await searchResponse.json() as {
    features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> }>;
  };
  const feature = searchJson.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  if (!coordinates) throw new Error("Adresse introuvable par l'IGN.");
  const [longitude, latitude] = coordinates;

  const reverse = new URL("https://data.geopf.fr/geocodage/reverse");
  reverse.searchParams.set("lon", String(longitude));
  reverse.searchParams.set("lat", String(latitude));
  reverse.searchParams.set("index", "parcel");
  reverse.searchParams.set("limit", "1");
  const reverseResponse = await fetch(reverse, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!reverseResponse.ok) throw new Error(`Cadastre IGN indisponible (${reverseResponse.status}).`);
  const reverseJson = await reverseResponse.json() as { features?: Array<{ properties?: Record<string, unknown> }> };
  const parcel = reverseJson.features?.[0]?.properties ?? {};
  const section = String(parcel.section ?? "").trim();
  const number = String(parcel.number ?? parcel.numero ?? "").trim();
  const parcelReference = [section, number].filter(Boolean).join(" ");
  if (!parcelReference) throw new Error("La parcelle cadastrale n'a pas pu être déterminée.");

  const normalizedAddress = String(feature?.properties?.label ?? feature?.properties?.name ?? cleanAddress);
  const [situation, close] = await Promise.all([
    fetchIgnPng(longitude, latitude, 650, 464, "ign-cadastre-situation.png"),
    fetchIgnPng(longitude, latitude, 110, 78.6, "ign-cadastre-close.png"),
  ]);
  return { normalizedAddress, parcelReference, longitude, latitude, situation, close };
}

function buildProjectSpec(input: DpPieceInput): ProjectSpec {
  const module = requireVerifiedPvModule(input.moduleReference ?? "");
  const panelCount = positiveInteger(input.panelCount, "Le nombre de panneaux");
  const rows = positiveInteger(input.rows, "Le nombre de rangées");
  const columns = positiveInteger(input.columns, "Le nombre de colonnes");
  if (rows * columns !== panelCount) throw new Error(`${rows} × ${columns} ne correspond pas à ${panelCount} panneaux.`);

  const orientation = input.orientation === "landscape" ? "landscape" : "portrait";
  const placement = input.placement ?? "centered";
  const gap = Math.max(0, finite(input.interPanelGapMm, 20));
  const panelWidth = orientation === "portrait" ? module.widthMm : module.heightMm;
  const panelHeight = orientation === "portrait" ? module.heightMm : module.widthMm;
  return {
    panelCount,
    rows,
    columns,
    orientation,
    placement,
    moduleReference: module.canonicalReference,
    manufacturer: module.manufacturer,
    moduleWidthMm: module.widthMm,
    moduleHeightMm: module.heightMm,
    fieldWidthMm: columns * panelWidth + Math.max(0, columns - 1) * gap,
    fieldHeightMm: rows * panelHeight + Math.max(0, rows - 1) * gap,
    interPanelGapMm: gap,
    gutterClearanceMm: Math.max(0, finite(input.gutterClearanceMm, 300)),
    instructions: input.instructions?.trim() || "",
  };
}

function photo(input: DpPieceInput, role: PiecePhotoInput["role"]) {
  return input.photos?.find((candidate) => candidate.role === role);
}

function requirePhoto(input: DpPieceInput, roles: PiecePhotoInput["role"][], label: string) {
  const found = roles.map((role) => photo(input, role)).find(Boolean);
  if (!found?.base64 || found.base64.length < 1000) throw new Error(label);
  return found;
}

function dataUrl(mimeType: string, base64: string) {
  return `data:${mimeType};base64,${base64}`;
}

function base64ToBlob(base64: string, mimeType: string) {
  return new Blob([Buffer.from(base64, "base64")], { type: mimeType });
}

function extension(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function commonProjectPrompt(spec: ProjectSpec) {
  return [
    "PROJECT VISUAL IDENTITY — keep this installation identical across DP2, DP3, DP4, DP5 and DP6.",
    `PV module: ${spec.manufacturer} ${spec.moduleReference}, physical size ${spec.moduleWidthMm} × ${spec.moduleHeightMm} mm.`,
    `Exact installation: ${spec.panelCount} panels arranged exactly ${spec.rows} visible rows × ${spec.columns} visible columns, ${spec.orientation}.`,
    `Computed PV field size: ${spec.fieldWidthMm} × ${spec.fieldHeightMm} mm, inter-panel gap ${spec.interPanelGapMm} mm.`,
    `Requested placement: ${spec.placement}. Preferred lower setback near gutter: ${spec.gutterClearanceMm} mm; reduce it only if necessary to fit the exact requested array naturally.`,
    "Use visual intelligence freely: understand the roof directly from the supplied real image, automatically avoid chimneys, skylights/Velux, vents, ridges, hips, roof edges and every visible obstacle.",
    "Do NOT use or draw masks, calibration marks, technical polygons, roof IDs or debug overlays in the final image.",
    "Never change the architecture merely to make the panels fit. Preserve openings, roof shape, chimneys, skylights, neighboring buildings and permanent objects unless the DP role explicitly asks for an architectural drawing.",
    spec.instructions ? `User instruction from the form: ${spec.instructions}` : "",
  ].filter(Boolean).join("\n");
}

function promptForDp(dp: DirectDp, address: string, parcelReference: string | undefined, spec: ProjectSpec | null, input: DpPieceInput) {
  const shared = spec ? commonProjectPrompt(spec) : "";
  const continuity = input.references?.length
    ? "REFERENCE IMAGES follow the source image. They are earlier PilotPaper DP results from THIS SAME PROJECT. Use them only to keep the SAME physical panel zone, same row/column logic and same house identity across the dossier."
    : "No earlier generated reference is available yet.";

  if (dp === 1) {
    return `Create a professional French planning-document DP1 from the supplied official IGN aerial/cadastral image.\nAddress: ${address}.\nTarget cadastral parcel: ${parcelReference}.\n\nSTRICT VISUAL RESULT:\n- Preserve the aerial photograph, cadastral geometry and every visible parcel number exactly; do not invent, move or erase boundaries or numbers.\n- Identify the parcel bearing the target cadastral reference and make ONLY that cadastral zone visually dominant with a clean navy-blue outline and subtle translucent navy fill.\n- Render all other visible cadastral parcel outlines in neutral medium grey.\n- Keep the target parcel number legible.\n- Add a small clean north arrow and a discreet title 'DP1 — Plan de situation'.\n- Do not add solar panels on DP1.\n- No fake map geometry, no decorative redesign, no satellite reconstruction.\nThe result must look like a professional planning office annotated the real official map.`;
  }

  if (dp === 2) {
    return `${shared}\n\n${continuity}\n\nDP2 — PLAN DE MASSE / ROOF PLAN FROM ABOVE.\nUse the supplied close official aerial/cadastral image as the real base. Keep parcel boundaries and building footprint faithful. Add the PV array on the actual target roof seen from above. ChatGPT Image may reason freely about the roof and obstacles, but the result must show the exact ${spec!.rows} × ${spec!.columns} matrix (${spec!.panelCount} panels) in the physical roof zone that will remain the same in DP3-DP6. Panels must follow roof perspective/top view, remain inside the roof, and automatically avoid all visible roof obstacles. Use a thin light outline around panels so they remain readable on the aerial image. Add discreet professional labels only, never debug overlays.`;
  }

  if (dp === 3) {
    const roofWidth = finite(input.roofWidthMm, 0);
    const slopeLength = finite(input.roofSlopeLengthMm, 0);
    const slopeDeg = finite(input.roofSlopeDeg, 0);
    const measured = [
      roofWidth > 0 ? `Measured roof width: ${roofWidth} mm.` : "",
      slopeLength > 0 ? `Measured roof slope length: ${slopeLength} mm.` : "",
      slopeDeg > 0 ? `Measured roof pitch: ${slopeDeg}°.` : "",
    ].filter(Boolean).join(" ");
    return `${shared}\n\n${continuity}\n\nDP3 — PROFESSIONAL ARCHITECTURAL SECTION.\nFrom the supplied real house photo, create a clean professional architectural section/cut drawing that is as faithful as possible to the real building volume, roof type, slope and terrain. Show the photovoltaic installation on the correct roof plane and keep its same physical zone as DP2. Use the real module/field dimensions above. ${measured || "No measured building dimensions were supplied: do not invent numeric building dimensions."}\nOnly write numeric dimensions that come from the form or from the verified PV module calculation. Do not invent house heights, wall lengths or terrain levels. The drawing may infer hidden construction only as a neutral schematic necessary to make a section understandable. White/very light technical background, crisp architectural lines, professional dimension arrows, title 'DP3 — Plan en coupe'.`;
  }

  if (dp === 4) {
    return `${shared}\n\n${continuity}\n\nDP4 — INITIAL / PROJECTED STATE.\nUse the supplied real photo as the truth. Produce one professional two-part presentation: LEFT 'ÉTAT INITIAL' showing the real house faithfully without panels; RIGHT 'ÉTAT PROJETÉ' showing the SAME house and same camera with the exact PV installation inserted. Preserve roof, façade, openings, chimneys, skylights and surroundings. The projected panel zone must agree with DP2 and the project references. Photorealistic insertion, realistic scale, perspective, lighting and contact with the roof.`;
  }

  if (dp === 5) {
    return `${shared}\n\n${continuity}\n\nDP5 — CLOSE EXTERIOR APPEARANCE.\nCreate a new realistic closer viewpoint of the SAME house, deliberately from a somewhat HIGHER camera position than the source photo so the photovoltaic modules are easier to see more front-on. This is the one DP where changing the camera viewpoint is explicitly allowed. Reconstruct only what is necessary for that plausible higher viewpoint while preserving the true architecture, roof geometry, openings, chimneys, skylights, materials and surroundings. The exact PV array must stay in the same physical roof zone as DP2/DP4 and contain exactly ${spec!.panelCount} panels in ${spec!.rows} × ${spec!.columns}. Make it look like a professional real photograph, not CGI, not a diagram.`;
  }

  return `${shared}\n\n${continuity}\n\nDP6 — DISTANT CONTEXTUAL INSERTION.\nThe supplied far photo is the immutable environmental base. Insert the SAME photovoltaic installation on the SAME house and physical roof zone used in DP2-DP5. Preserve every building, road, tree, fence, neighbor, horizon and camera perspective outside the minimal panel insertion. Panels must be small at this distance but still physically believable and consistent with the close views. Do not beautify or redesign the environment. The result must look like a real distant photograph after installation.`;
}

function chooseSource(dp: DirectDp, input: DpPieceInput, ign?: IgnContext) {
  if (dp === 1) return ign!.situation;
  if (dp === 2) return ign!.close;
  if (dp === 3) return requirePhoto(input, ["roof", "near"], "DP3 : ajoutez une photo réelle lisible de la maison et de sa toiture.");
  if (dp === 4) return requirePhoto(input, ["near", "roof"], "DP4 : ajoutez une photo réelle de la façade/toiture concernée.");
  if (dp === 5) return requirePhoto(input, ["roof", "near"], "DP5 : ajoutez une photo rapprochée lisible de la maison et du pan à équiper.");
  return requirePhoto(input, ["far"], "DP6 : ajoutez une photo lointaine réelle montrant la maison dans son environnement.");
}

function orderedReferences(dp: DirectDp, references: VisualReference[] | undefined) {
  const allowed = (references ?? []).filter((ref) => ref.base64?.length > 1000);
  const preference: Record<DirectDp, number[]> = {
    1: [],
    2: [],
    3: [2],
    4: [2, 3],
    5: [4, 2, 3],
    6: [5, 4, 2],
  };
  return preference[dp]
    .map((wanted) => allowed.find((candidate) => candidate.dp === wanted))
    .filter((value): value is VisualReference => Boolean(value))
    .slice(0, 3);
}

async function generateImage(apiKey: string, dp: DirectDp, source: PiecePhotoInput, prompt: string, references: VisualReference[], ignReference?: PiecePhotoInput) {
  const form = new FormData();
  form.set("model", IMAGE_MODEL);
  form.set("prompt", prompt);
  form.set("quality", "high");
  form.append("image[]", base64ToBlob(source.base64, source.mimeType), source.filename ?? `source.${extension(source.mimeType)}`);

  if (ignReference && ignReference.base64 !== source.base64) {
    form.append("image[]", base64ToBlob(ignReference.base64, ignReference.mimeType), ignReference.filename ?? "cadastre-reference.png");
  }
  for (const reference of references) {
    form.append("image[]", base64ToBlob(reference.base64, reference.mimeType), `pilotpaper-dp${reference.dp}-reference.${extension(reference.mimeType)}`);
  }

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) throw new Error(`OpenAI Image-2 DP${dp} : ${response.status} — ${await response.text()}`);
  const json = await response.json() as { data?: Array<{ b64_json?: string }> };
  const base64 = json.data?.[0]?.b64_json;
  if (!base64) throw new Error(`OpenAI Image-2 DP${dp} n'a renvoyé aucune image.`);
  return base64;
}

async function openaiStructured<T>(apiKey: string, model: string, prompt: string, images: string[], schema: Record<string, unknown>): Promise<T> {
  const content = [
    { type: "input_text", text: prompt },
    ...images.map((image_url) => ({ type: "input_image", image_url, detail: "high" })),
  ];
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      input: [{ role: "user", content }],
      text: { format: { type: "json_schema", name: "pilotpaper_dp_inspector", strict: true, schema } },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`Inspector OpenAI : ${response.status} — ${await response.text()}`);
  const json = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  let text = json.output_text;
  if (!text) {
    for (const item of json.output ?? []) for (const part of item.content ?? []) if (part.type === "output_text" && part.text) text = part.text;
  }
  if (!text) throw new Error("Inspector OpenAI : aucune réponse structurée.");
  return JSON.parse(text) as T;
}

async function inspect(apiKey: string, dp: DirectDp, source: PiecePhotoInput, generatedBase64: string, spec: ProjectSpec | null, parcelReference: string | undefined, references: VisualReference[]): Promise<DpInspectorResult> {
  const exactArrayRequired = dp === 2 || dp === 4 || dp === 5 || dp === 6;
  const prompt = [
    `You are PilotPaper Inspector. Evaluate a generated French planning visual DP${dp}.`,
    "Image 1 is the real source. Image 2 is the generated candidate. Remaining images, if any, are earlier project references.",
    parcelReference ? `Target cadastral parcel: ${parcelReference}.` : "",
    spec ? `Expected PV array: exactly ${spec.panelCount} panels, ${spec.rows} rows × ${spec.columns} columns, ${spec.orientation}, same physical roof zone across all project references.` : "",
    exactArrayRequired ? "You MUST count the visible panels. If exact count or grid cannot be verified, fail." : "",
    dp === 1 ? "DP1 must preserve real cadastral geometry/numbers and highlight only the target parcel in navy while other parcel lines are grey." : "",
    dp === 3 ? "DP3 is an architectural section. Do not require all individual panels to be visibly countable, but reject invented numeric building dimensions not evidenced by the form." : "",
    dp === 5 ? "DP5 is allowed to use a new higher camera viewpoint, but must preserve the same building identity and PV zone." : "",
    "Fail for wrong document role, altered house/site, panels over chimneys/skylights, impossible placement, wrong panel zone, fake-looking photomontage where photorealism is expected, or inconsistency with project references.",
  ].filter(Boolean).join("\n");

  const nullableBoolean = { anyOf: [{ type: "boolean" }, { type: "null" }] };
  const nullableInteger = { anyOf: [{ type: "integer" }, { type: "null" }] };
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      passed: { type: "boolean" },
      score: { type: "number", minimum: 0, maximum: 1 },
      panelCountObserved: nullableInteger,
      rowsObserved: nullableInteger,
      columnsObserved: nullableInteger,
      parcelHighlightCorrect: nullableBoolean,
      documentRoleCorrect: { type: "boolean" },
      sourcePreserved: { type: "boolean" },
      buildingPreserved: nullableBoolean,
      placementCoherent: nullableBoolean,
      continuityWithReferences: nullableBoolean,
      photorealistic: nullableBoolean,
      issues: { type: "array", items: { type: "string" } },
    },
    required: ["passed", "score", "panelCountObserved", "rowsObserved", "columnsObserved", "parcelHighlightCorrect", "documentRoleCorrect", "sourcePreserved", "buildingPreserved", "placementCoherent", "continuityWithReferences", "photorealistic", "issues"],
  } as Record<string, unknown>;

  const images = [dataUrl(source.mimeType, source.base64), dataUrl("image/png", generatedBase64), ...references.map((ref) => dataUrl(ref.mimeType, ref.base64))];
  const report = await openaiStructured<JudgePayload>(apiKey, process.env.DP_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL, prompt, images, schema);

  const countOk = !exactArrayRequired || (
    report.panelCountObserved === spec!.panelCount && report.rowsObserved === spec!.rows && report.columnsObserved === spec!.columns
  );
  const roleOk = report.documentRoleCorrect === true;
  const sourceOk = report.sourcePreserved === true;
  const parcelOk = dp !== 1 || report.parcelHighlightCorrect === true;
  const buildingOk = dp === 1 || dp === 2 || report.buildingPreserved !== false;
  const placementOk = dp === 1 || dp === 3 || report.placementCoherent === true;
  const continuityOk = references.length === 0 || report.continuityWithReferences !== false;
  const realismOk = dp === 1 || dp === 2 || dp === 3 || report.photorealistic === true;
  const passed = Boolean(report.passed && report.score >= 0.9 && countOk && roleOk && sourceOk && parcelOk && buildingOk && placementOk && continuityOk && realismOk);

  const checks = [
    `Rôle DP${dp} correct : ${roleOk ? "oui" : "non"}`,
    `Source réelle préservée : ${sourceOk ? "oui" : "non"}`,
    ...(dp === 1 ? [`Parcelle cible correctement mise en évidence : ${parcelOk ? "oui" : "non"}`] : []),
    ...(exactArrayRequired ? [`Panneaux observés : ${report.panelCountObserved ?? "indéterminé"}/${spec!.panelCount}`, `Matrice observée : ${report.rowsObserved ?? "?"} × ${report.columnsObserved ?? "?"} / ${spec!.rows} × ${spec!.columns}`] : []),
    ...(dp >= 4 ? [`Photorealisme : ${realismOk ? "oui" : "non"}`] : []),
    ...(references.length ? [`Cohérence avec les DP précédentes : ${continuityOk ? "oui" : "non"}`] : []),
  ];
  return { passed, score: report.score, checks, issues: report.issues };
}

export async function generateImage2Dp(input: DpPieceInput & { dp: DirectDp }): Promise<DpPieceOutput> {
  const contract = getDpPieceContract(input.dp);
  if (!contract) throw new Error(`Contrat DP${input.dp} introuvable.`);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY absente du poste local.");
  if (!input.address?.trim()) throw new Error("L'adresse exacte du projet est requise.");

  let ign: IgnContext | undefined;
  if (input.dp === 1 || input.dp === 2) ign = await resolveIgn(input.address);
  const address = ign?.normalizedAddress ?? input.address.trim();
  const spec = input.dp === 1 ? null : buildProjectSpec(input);
  const source = chooseSource(input.dp, input, ign);
  const references = orderedReferences(input.dp, input.references);
  const prompt = promptForDp(input.dp, address, ign?.parcelReference, spec, input);
  const generated = await generateImage(apiKey, input.dp, source, prompt, references, input.dp === 1 ? ign?.close : input.dp === 2 ? ign?.situation : undefined);
  const inspector = await inspect(apiKey, input.dp, source, generated, spec, ign?.parcelReference, references);

  return {
    dp: input.dp,
    title: contract.title,
    validationStatus: "test_unverified",
    mimeType: "image/png",
    base64: generated,
    sourceSummary: [
      `DP${input.dp} générée directement par ${IMAGE_MODEL}`,
      input.dp <= 2 ? `Source IGN + cadastre officiel · parcelle ${ign?.parcelReference}` : `Source photo réelle fournie par l'utilisateur`,
      input.dp >= 2 ? "Même identité visuelle PV réutilisée dans DP2 → DP6" : "DP1 : aucune insertion photovoltaïque",
      references.length ? `Références de cohérence utilisées : ${references.map((ref) => `DP${ref.dp}`).join(", ")}` : "Aucune ancienne reconstruction géométrique utilisée",
      "Aucun masque, Site Twin, recalage caméra ou Geometry Engine dans le chemin de génération",
    ],
    inspector,
  };
}
