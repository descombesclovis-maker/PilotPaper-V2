import { getDpPieceContract } from "@/lib/dp-piece-contract";
import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";
import { resolveAdvancedRoofTruth } from "@/lib/geometry/advanced-roof-truth";
import type {
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
const MAX_GENERATION_ATTEMPTS = 4;

type DirectDp = 1 | 2 | 3 | 4 | 5 | 6;

type IgnContext = {
  normalizedAddress: string;
  parcelReference: string;
  situation: PiecePhotoInput;
  close: PiecePhotoInput;
};

type ProjectLock = {
  panelCount: number;
  rows: number;
  columns: number;
  orientation: "portrait" | "landscape";
  placement: "centered" | "left" | "right" | "custom";
  gapMm: number;
  gutterClearanceMm: number;
  mountingSystem: string;
  moduleReference: string;
  manufacturer: string;
  moduleWidthMm: number;
  moduleHeightMm: number;
  orientedPanelWidthMm: number;
  orientedPanelHeightMm: number;
  panelLongShortRatio: number;
  fieldWidthMm: number;
  fieldHeightMm: number;
};

type JudgePayload = {
  passed: boolean;
  score: number;
  panelCountObserved: number | null;
  rowsObserved: number | null;
  columnsObserved: number | null;
  projectSpecCorrect: boolean | null;
  parcelHighlightCorrect: boolean | null;
  targetParcelCorrect: boolean | null;
  targetBuildingCorrect: boolean | null;
  moduleShapeCorrect: boolean | null;
  moduleScalePlausible: boolean | null;
  projectiveConsistency: boolean | null;
  documentRoleCorrect: boolean;
  sourcePreserved: boolean;
  buildingPreserved: boolean | null;
  placementCoherent: boolean | null;
  continuityWithReferences: boolean | null;
  sectionSideCorrect: boolean | null;
  inventedArchitecture: boolean | null;
  inventedNumericDimensions: boolean | null;
  photorealistic: boolean | null;
  issues: string[];
};

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} doit être un entier positif.`);
  return parsed;
}

function boundedPreference(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
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
  return { normalizedAddress, parcelReference, situation, close };
}

function buildProjectLock(input: DpPieceInput): ProjectLock {
  const module = requireVerifiedPvModule(input.moduleReference ?? "");
  const panelCount = positiveInteger(input.panelCount, "Le nombre de panneaux");
  const rows = positiveInteger(input.rows, "Le nombre de rangées");
  const columns = positiveInteger(input.columns, "Le nombre de colonnes");
  if (rows * columns !== panelCount) throw new Error(`${rows} × ${columns} ne correspond pas à ${panelCount} panneaux.`);

  const orientation = input.orientation === "landscape" ? "landscape" : "portrait";
  const placement = ["centered", "left", "right", "custom"].includes(String(input.placement))
    ? input.placement as ProjectLock["placement"]
    : "centered";
  const gapMm = boundedPreference(input.interPanelGapMm, 20, 0, 200);
  const gutterClearanceMm = boundedPreference(input.gutterClearanceMm, 300, 0, 2000);
  const mountingSystem = String(input.mountingSystem ?? "Surimposition parallèle au rampant").trim().slice(0, 160) || "Surimposition parallèle au rampant";
  const panelWidth = orientation === "portrait" ? module.widthMm : module.heightMm;
  const panelHeight = orientation === "portrait" ? module.heightMm : module.widthMm;
  return {
    panelCount,
    rows,
    columns,
    orientation,
    placement,
    gapMm,
    gutterClearanceMm,
    mountingSystem,
    moduleReference: module.canonicalReference,
    manufacturer: module.manufacturer,
    moduleWidthMm: module.widthMm,
    moduleHeightMm: module.heightMm,
    orientedPanelWidthMm: panelWidth,
    orientedPanelHeightMm: panelHeight,
    panelLongShortRatio: Math.max(panelWidth, panelHeight) / Math.min(panelWidth, panelHeight),
    fieldWidthMm: columns * panelWidth + Math.max(0, columns - 1) * gapMm,
    fieldHeightMm: rows * panelHeight + Math.max(0, rows - 1) * gapMm,
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

function photovoltaicSpecialistPrompt(spec: ProjectLock) {
  return [
    "PILOTPAPER PHOTOVOLTAIC INSERTION SPECIALIST PROTOCOL.",
    "Act as a specialist in physically credible photovoltaic insertion on real roofs, not as a generic image generator.",
    "Treat every project value below as a geometric constraint. Do not merely write the values as text and then draw a visually convenient array.",
    `Each real module measures ${spec.moduleWidthMm} × ${spec.moduleHeightMm} mm. In the requested ${spec.orientation} orientation, each module occupies ${spec.orientedPanelWidthMm} mm horizontally across the array and ${spec.orientedPanelHeightMm} mm vertically along the array before perspective projection.`,
    `The module long-side/short-side ratio is ${spec.panelLongShortRatio.toFixed(3)}. Modules are rectangular physical objects, not square tiles.`,
    `The complete ${spec.rows} × ${spec.columns} field occupies approximately ${spec.fieldWidthMm} × ${spec.fieldHeightMm} mm before projection, using ${spec.gapMm} mm inter-module gaps.`,
    `INSTALLER PREFERENCES: placement ${spec.placement}; preferred lower-edge/gutter clearance ${spec.gutterClearanceMm} mm; mounting system "${spec.mountingSystem}".`,
    "Apply those installer preferences whenever the real roof geometry and visible obstacles permit it. They are genuine project preferences, not decorative metadata.",
    "If a preferred placement or gutter clearance is physically impossible, preserve the exact panel count/matrix and real building instead of forcing an unsafe or impossible layout; move the whole field to the nearest credible clear zone and keep the selected mounting principle.",
    "Project that real rectangle onto the selected roof plane using one coherent perspective for the entire array. Foreshortening is allowed and expected, but all modules must share the same roof-plane projection and remain mutually consistent.",
    "Use visible roof scale cues conservatively so the field is neither arbitrarily oversized nor miniaturized. Do not invent numeric dimensions of the building to justify the result.",
    "Keep module frames, cell grids and gaps subordinate to the real physical rectangle. A module may only look close to square if the roof perspective genuinely produces that foreshortening.",
    "Never bend the array over a ridge, hip or roof-plane break. A matrix belongs to one continuous roof plane unless the project input explicitly requests several zones.",
  ].join("\n");
}

function projectLockPrompt(spec: ProjectLock) {
  return [
    photovoltaicSpecialistPrompt(spec),
    "NON-NEGOTIABLE PROJECT LOCK.",
    `The project contains EXACTLY ${spec.panelCount} photovoltaic modules: ${spec.rows} visible rows × ${spec.columns} visible columns.`,
    `Module: ${spec.manufacturer} ${spec.moduleReference}; verified physical module size ${spec.moduleWidthMm} × ${spec.moduleHeightMm} mm; orientation ${spec.orientation}.`,
    `Complete field size is approximately ${spec.fieldWidthMm} × ${spec.fieldHeightMm} mm including the selected ${spec.gapMm} mm inter-module gap.`,
    `Preferred installation: ${spec.placement} placement, ${spec.gutterClearanceMm} mm lower/gutter clearance, mounting system "${spec.mountingSystem}".`,
    `Before rendering, internally count the cells of the array row by row: ${spec.rows} × ${spec.columns} = ${spec.panelCount}.`,
    `After rendering, internally recount them. If there are not EXACTLY ${spec.panelCount} modules in EXACTLY ${spec.rows} rows and ${spec.columns} columns, correct the image before returning it.`,
    "Never add a partial, hidden, duplicate or decorative module. Never change the requested matrix to go around an obstacle.",
    "Instead, move the complete matrix to the closest physically plausible clear zone of the same roof plane.",
    "Automatically avoid chimneys, skylights/Velux, vents, ridges, hips, gutters and roof edges while keeping the full requested matrix intact.",
    "Preserve the architecture. Never create, delete, move or resize doors, windows, roof volumes, chimneys, skylights, annexes or permanent surroundings just to make the project fit.",
    "Do not draw masks, debug polygons, calibration marks, roof IDs or technical overlays.",
  ].join("\n");
}

function continuityPrompt(references: VisualReference[]) {
  if (!references.length) return "No previous project visual is available.";
  return [
    "PROJECT CONTINUITY LOCK.",
    "The additional reference images are already accepted views of this SAME project.",
    "Keep the same equipped roof plane, the same relative roof zone, the same module orientation, the same physical module dimensions and the same exact array.",
    "Do not copy their camera perspective when the current DP role requires another viewpoint; copy only the physical installation identity.",
  ].join("\n");
}

function promptForDp(dp: DirectDp, address: string, parcelReference: string | undefined, spec: ProjectLock | null, references: VisualReference[]) {
  if (dp === 1) {
    return [
      "DP1 — PLAN DE SITUATION.",
      `Address: ${address}. Target cadastral parcel: ${parcelReference}.`,
      "The supplied official IGN aerial/cadastral image is immutable geographic evidence.",
      "Do not regenerate, repaint, move, erase or invent any road, building, vegetation, parcel line, cadastral number or neighboring property.",
      "Use only cadastral boundaries already visible in the official source. Never fabricate a parcel contour to make the requested reference fit.",
      `Identify the target only from the official cadastral evidence corresponding to parcel ${parcelReference}. If that parcel cannot be identified with certainty in the supplied source, do not guess a different parcel.`,
      "Only annotate the existing image: outline the target cadastral parcel in clean navy blue with a subtle translucent navy fill; render the other visible parcel outlines in neutral grey while keeping their numbers legible.",
      "Add a discreet north arrow and the title 'DP1 — Plan de situation'. No photovoltaic modules on DP1.",
    ].join("\n");
  }

  const lock = projectLockPrompt(spec!);
  const continuity = continuityPrompt(references);

  if (dp === 2) {
    return [
      lock,
      continuity,
      "DP2 — PLAN DE MASSE / VUE DE TOITURE.",
      "The FIRST image is the official close IGN aerial/cadastral image and is an IMMUTABLE BASE.",
      `The target is the building belonging to cadastral parcel ${parcelReference} at ${address}. Do not equip a neighboring roof simply because it is larger, clearer or easier.`,
      "Use the existing cadastral lines and labels as location evidence. The photovoltaic field must remain on the target building roof inside the target parcel.",
      "Do not regenerate the property. Do not alter buildings, annexes, trees, driveways, roads, cadastral lines, garden or neighboring parcels.",
      "Your only physical modification is the photovoltaic array on the real target roof.",
      `Render exactly ${spec!.panelCount} modules in ${spec!.rows} × ${spec!.columns}. No extra module is allowed.`,
      `Respect the real module rectangle ${spec!.orientedPanelWidthMm} × ${spec!.orientedPanelHeightMm} mm and the complete field footprint ${spec!.fieldWidthMm} × ${spec!.fieldHeightMm} mm before roof-plane projection.`,
      `Actively apply the saved installer preferences: ${spec!.placement} placement, ${spec!.gapMm} mm between modules, approximately ${spec!.gutterClearanceMm} mm preferred clearance from the lower roof edge/gutter, and mounting system "${spec!.mountingSystem}".`,
      "The preferred gutter clearance may be reduced only when the full requested field otherwise cannot fit safely. Placement may shift only to avoid real obstacles or roof boundaries; do not silently ignore the preference for visual convenience.",
      "Use the real aerial roof perspective and choose the clearest physically plausible zone while preserving all visible roof obstacles.",
      "The chosen physical roof zone becomes the master placement reference for DP3 to DP6.",
      "Keep labels discreet. Never redraw the satellite surroundings.",
    ].join("\n\n");
  }

  if (dp === 3) {
    return [
      lock,
      continuity,
      "DP3 — PLAN EN COUPE LATÉRAL.",
      "Create a professional architectural SECTION, not a front elevation and not a façade view.",
      "The section plane must be PERPENDICULAR TO THE ROOF RIDGE so the drawing is seen from the gable/side and clearly shows ground, wall, roof slope, covering and the photovoltaic layer on the slope.",
      "Do not invent internal rooms, doors, windows, structural details or floor layouts that cannot be inferred from the source. Hidden construction may be represented only as neutral schematic lines needed to understand the section.",
      "Do not invent numeric dimensions of the house, roof, walls, terrain or heights. The only numeric dimensions allowed are verified photovoltaic module/field dimensions already supplied above.",
      `The project annotation must state exactly ${spec!.panelCount} modules — configuration ${spec!.rows} × ${spec!.columns}.`,
      "Because this is a side section, do not fake a frontal grid of all modules. Show the photovoltaic layer at the correct roof slope and use the verified module thickness/footprint concept only where visible; the total count remains project information rather than a requirement to expose every module in the cut.",
      "White technical background, crisp architectural linework, title 'DP3 — Plan en coupe'.",
    ].join("\n\n");
  }

  if (dp === 4) {
    return [
      lock,
      continuity,
      "DP4 — ÉTAT INITIAL / ÉTAT PROJETÉ.",
      "Use the real source photo as architectural truth. Produce a clean two-part comparison using the SAME camera and SAME house.",
      "LEFT: preserve the initial source faithfully. RIGHT: preserve that same house and add only the photovoltaic installation.",
      `The projected state must contain exactly ${spec!.panelCount} modules in ${spec!.rows} × ${spec!.columns}.`,
      `The projected modules must retain the verified ${spec!.moduleWidthMm} × ${spec!.moduleHeightMm} mm physical proportions and the ${spec!.fieldWidthMm} × ${spec!.fieldHeightMm} mm field footprint under the roof perspective.`,
      "Do not change façade openings, roof shape, chimneys, skylights, antennas, annexes, vegetation or surroundings.",
      "The projected roof zone must match the accepted DP2 physical placement.",
      "Photorealistic insertion only; no beautification and no architectural redesign.",
    ].join("\n\n");
  }

  if (dp === 5) {
    return [
      lock,
      continuity,
      "DP5 — ASPECT EXTÉRIEUR RAPPROCHÉ.",
      "Create a plausible closer and somewhat higher viewpoint of the SAME house so the photovoltaic modules are easier to distinguish.",
      "Changing the camera position is allowed here; changing the architecture is not.",
      "Preserve the true roof geometry, openings, chimneys, skylights, antenna, annexes, materials and recognizable surroundings.",
      `Show exactly ${spec!.panelCount} modules in ${spec!.rows} × ${spec!.columns}, in the same physical roof zone locked by DP2.`,
      `Every module must behave as the real ${spec!.moduleWidthMm} × ${spec!.moduleHeightMm} mm ${spec!.manufacturer} ${spec!.moduleReference}. The whole field must occupy a physically plausible ${spec!.fieldWidthMm} × ${spec!.fieldHeightMm} mm footprint before perspective.`,
      "Do not make the modules square or resize individual modules to fill the roof. Perspective may foreshorten all modules coherently, never independently.",
      "The result must look like a real photograph taken from a higher nearby camera, not CGI and not a redesigned property.",
    ].join("\n\n");
  }

  return [
    lock,
    continuity,
    "DP6 — INSERTION LOINTAINE.",
    "The FIRST image is already the required distant real photograph. It is an IMMUTABLE BASE.",
    "Do not invent a new entrance, door, window, roof, annex, tree, road, fence, garden, sky, neighbor or camera viewpoint.",
    "Do not crop or recompose the scene. The ONLY physical change allowed is the photovoltaic installation on the existing target roof plane.",
    `Insert exactly ${spec!.panelCount} modules in ${spec!.rows} × ${spec!.columns}, in the same physical roof zone locked by DP2.`,
    `The modules are real ${spec!.moduleWidthMm} × ${spec!.moduleHeightMm} mm rectangles. Preserve that physical shape under the existing camera perspective; do not turn them into square tiles.`,
    `The complete field represents approximately ${spec!.fieldWidthMm} × ${spec!.fieldHeightMm} mm before projection and must have a credible scale relative to the real roof.`,
    "At this distance modules may be small, but their count, matrix, physical proportions, placement and perspective must remain coherent with the accepted close views.",
    "The result must look like the untouched original distant photograph after the installation was added.",
  ].join("\n\n");
}

function chooseSource(dp: DirectDp, input: DpPieceInput, ign?: IgnContext) {
  if (dp === 1) return ign!.situation;
  if (dp === 2) return ign!.close;
  if (dp === 3) return requirePhoto(input, ["near", "roof"], "DP3 : ajoutez une photo réelle lisible de la maison et de la toiture.");
  if (dp === 4) return requirePhoto(input, ["near", "roof"], "DP4 : ajoutez une photo réelle de la maison et de la toiture concernée.");
  if (dp === 5) return requirePhoto(input, ["roof", "near"], "DP5 : ajoutez une vue oblique lisible de la maison et du pan à équiper.");
  return requirePhoto(input, ["far"], "DP6 : ajoutez une photo lointaine réelle montrant la maison dans son environnement.");
}

function orderedReferences(dp: DirectDp, references: VisualReference[] | undefined) {
  const allowed = (references ?? []).filter((ref) => ref.base64?.length > 1000);
  const preference: Record<DirectDp, number[]> = {
    1: [],
    2: [],
    3: [2],
    4: [2],
    5: [2, 4],
    6: [2, 4, 5],
  };
  return preference[dp]
    .map((wanted) => allowed.find((candidate) => candidate.dp === wanted))
    .filter((value): value is VisualReference => Boolean(value))
    .slice(0, 3);
}

function requireProjectAnchor(dp: DirectDp, references: VisualReference[]) {
  if (dp >= 3 && !references.some((reference) => reference.dp === 2)) {
    throw new Error(`DP${dp} : générez d'abord la DP2. Son implantation validée sert de référence commune au dossier.`);
  }
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
  if (!response.ok) throw new Error(`Moteur visuel DP${dp} indisponible (${response.status}).`);
  const json = await response.json() as { data?: Array<{ b64_json?: string }> };
  const base64 = json.data?.[0]?.b64_json;
  if (!base64) throw new Error(`DP${dp} : aucune image n'a été produite.`);
  return base64;
}

async function structured<T>(apiKey: string, prompt: string, images: string[], schema: Record<string, unknown>): Promise<T> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.DP_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL,
      store: false,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          ...images.map((image_url) => ({ type: "input_image", image_url, detail: "high" })),
        ],
      }],
      text: { format: { type: "json_schema", name: "pilotpaper_preventive_inspector", strict: true, schema } },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`Contrôle automatique indisponible (${response.status}).`);
  const json = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  let text = json.output_text;
  if (!text) {
    for (const item of json.output ?? []) for (const part of item.content ?? []) if (part.type === "output_text" && part.text) text = part.text;
  }
  if (!text) throw new Error("Contrôle automatique : réponse vide.");
  return JSON.parse(text) as T;
}

async function inspect(apiKey: string, dp: DirectDp, source: PiecePhotoInput, generatedBase64: string, spec: ProjectLock | null, parcelReference: string | undefined, references: VisualReference[]) {
  const exactArrayRequired = dp === 2 || dp === 4 || dp === 5 || dp === 6;
  const physicalModuleGeometryRequired = dp === 2 || dp === 4 || dp === 5 || dp === 6;
  const targetParcelRequired = dp === 2;
  const prompt = [
    `Inspect generated planning piece DP${dp}. Image 1 is the real source; image 2 is the candidate; later images are accepted project references.`,
    "Judge the pixels, geometry and source correspondence. Do not accept a candidate merely because a caption claims the correct panel count, module dimensions or parcel reference.",
    parcelReference ? `Target cadastral parcel: ${parcelReference}.` : "",
    spec ? `Locked project: EXACTLY ${spec.panelCount} modules, ${spec.rows} rows × ${spec.columns} columns, ${spec.orientation}; real module ${spec.moduleWidthMm} × ${spec.moduleHeightMm} mm; field ${spec.fieldWidthMm} × ${spec.fieldHeightMm} mm with ${spec.gapMm} mm gaps; preferred placement ${spec.placement}; preferred lower/gutter clearance ${spec.gutterClearanceMm} mm; mounting system ${spec.mountingSystem}.` : "",
    exactArrayRequired ? "Count every visible module in the photovoltaic array. If the exact count or exact matrix is uncertain, mark the candidate failed." : "",
    physicalModuleGeometryRequired ? `Check that modules behave as identical real rectangles with long/short ratio about ${spec!.panelLongShortRatio.toFixed(3)} before perspective, that the array scale is plausible for the roof, and that one coherent roof-plane projection is used. Obvious square tiles, individually stretched modules or arbitrary field scaling are failures.` : "",
    dp === 1 ? "DP1 must preserve cadastral geography and numbers and highlight only the target parcel using boundaries already present in the official source. A fabricated or guessed parcel contour is a failure." : "",
    dp === 2 ? `DP2 must preserve the aerial property and surroundings AND place the array on the actual target building inside parcel ${parcelReference}. Equipping a neighboring building, crossing a parcel boundary or choosing the wrong roof is a failure. The saved placement/gutter preferences should be visibly respected whenever physically compatible with the real roof and obstacles.` : "",
    dp === 3 ? "DP3 must be a genuine side architectural section perpendicular to the ridge, not a front elevation. Reject invented numeric building dimensions and invented architectural details. Do not fail DP3 merely because all project modules are not individually visible in the side cut; the total project count may be conveyed by annotation." : "",
    dp === 4 ? "DP4 must preserve the real source building in both initial/projected states; only the photovoltaic installation may differ. Count modules only on the projected state." : "",
    dp === 5 ? "DP5 may change camera viewpoint, but must preserve the same building identity, same DP2 project placement and physically credible module dimensions." : "",
    dp === 6 ? "DP6 must preserve the distant source scene and camera. Any invented entrance, opening, annex, tree, road, fence or environment is a failure. Reject square-looking modules unless the source perspective genuinely explains that foreshortening." : "",
    "Reject any panel over a chimney, skylight, ridge, edge or other visible obstacle, any altered architecture, or any mismatch with accepted project references.",
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
      projectSpecCorrect: nullableBoolean,
      parcelHighlightCorrect: nullableBoolean,
      targetParcelCorrect: nullableBoolean,
      targetBuildingCorrect: nullableBoolean,
      moduleShapeCorrect: nullableBoolean,
      moduleScalePlausible: nullableBoolean,
      projectiveConsistency: nullableBoolean,
      documentRoleCorrect: { type: "boolean" },
      sourcePreserved: { type: "boolean" },
      buildingPreserved: nullableBoolean,
      placementCoherent: nullableBoolean,
      continuityWithReferences: nullableBoolean,
      sectionSideCorrect: nullableBoolean,
      inventedArchitecture: nullableBoolean,
      inventedNumericDimensions: nullableBoolean,
      photorealistic: nullableBoolean,
      issues: { type: "array", items: { type: "string" } },
    },
    required: ["passed", "score", "panelCountObserved", "rowsObserved", "columnsObserved", "projectSpecCorrect", "parcelHighlightCorrect", "targetParcelCorrect", "targetBuildingCorrect", "moduleShapeCorrect", "moduleScalePlausible", "projectiveConsistency", "documentRoleCorrect", "sourcePreserved", "buildingPreserved", "placementCoherent", "continuityWithReferences", "sectionSideCorrect", "inventedArchitecture", "inventedNumericDimensions", "photorealistic", "issues"],
  } as Record<string, unknown>;

  const report = await structured<JudgePayload>(apiKey, prompt, [
    dataUrl(source.mimeType, source.base64),
    dataUrl("image/png", generatedBase64),
    ...references.map((reference) => dataUrl(reference.mimeType, reference.base64)),
  ], schema);

  const countOk = !exactArrayRequired || (
    report.panelCountObserved === spec!.panelCount &&
    report.rowsObserved === spec!.rows &&
    report.columnsObserved === spec!.columns
  );
  const roleOk = report.documentRoleCorrect === true;
  const sourceOk = report.sourcePreserved === true;
  const parcelOk = dp !== 1 || report.parcelHighlightCorrect === true;
  const targetOk = !targetParcelRequired || (report.targetParcelCorrect === true && report.targetBuildingCorrect === true);
  const moduleGeometryOk = !physicalModuleGeometryRequired || (
    report.moduleShapeCorrect === true &&
    report.moduleScalePlausible === true &&
    report.projectiveConsistency === true
  );
  const projectOk = dp === 1 || report.projectSpecCorrect === true;
  const buildingOk = dp === 1 || report.buildingPreserved !== false;
  const placementOk = dp === 1 || dp === 3 || report.placementCoherent === true;
  const continuityOk = references.length === 0 || report.continuityWithReferences === true;
  const sectionOk = dp !== 3 || (report.sectionSideCorrect === true && report.inventedArchitecture !== true && report.inventedNumericDimensions !== true);
  const realismOk = dp < 4 || report.photorealistic === true;
  const strictSourceOk = ![2, 4, 6].includes(dp) || sourceOk;
  const passed = Boolean(report.passed && report.score >= 0.86 && countOk && roleOk && parcelOk && targetOk && moduleGeometryOk && projectOk && buildingOk && placementOk && continuityOk && sectionOk && realismOk && strictSourceOk);

  const derivedIssues = [
    ...(!countOk && spec ? [`Le candidat ne montre pas avec certitude exactement ${spec.panelCount} panneaux en ${spec.rows} × ${spec.columns}.`] : []),
    ...(!targetOk ? [`La DP2 ne cible pas avec certitude le bon bâtiment de la parcelle cadastrale ${parcelReference}.`] : []),
    ...(!moduleGeometryOk && spec ? [`Les modules ne respectent pas suffisamment la géométrie réelle ${spec.moduleWidthMm} × ${spec.moduleHeightMm} mm, l'échelle du champ ou une projection cohérente sur le pan.`] : []),
    ...(!strictSourceOk ? ["La source réelle a été modifiée au-delà de l'insertion photovoltaïque autorisée."] : []),
    ...(!placementOk ? ["L'implantation photovoltaïque n'est pas cohérente avec le pan et la zone de toiture attendus."] : []),
    ...(!continuityOk ? ["L'installation n'est pas la même implantation physique que celle verrouillée par la DP2."] : []),
    ...(!sectionOk ? ["La DP3 n'est pas une coupe latérale fiable ou elle invente des informations architecturales/cotes."] : []),
    ...(!realismOk ? ["Le rendu photographique n'est pas suffisamment crédible pour cette pièce."] : []),
  ];
  const issues = [...new Set([...report.issues, ...derivedIssues])];

  const inspector: DpInspectorResult = {
    passed,
    score: report.score,
    checks: [
      `Rôle DP${dp} : ${roleOk ? "conforme" : "à corriger"}`,
      ...([2, 4, 6].includes(dp) ? [`Source réelle préservée : ${strictSourceOk ? "oui" : "non"}`] : []),
      ...(dp === 1 ? [`Parcelle cible : ${parcelOk ? "correcte" : "incorrecte"}`] : []),
      ...(dp === 2 ? [
        `Bâtiment/parcelle cible : ${targetOk ? "corrects" : "à corriger"}`,
        `Préférences pose : ${spec!.placement}, jeu ${spec!.gapMm} mm, recul bas préféré ${spec!.gutterClearanceMm} mm`,
      ] : []),
      ...(exactArrayRequired ? [
        `Panneaux : ${report.panelCountObserved ?? "?"}/${spec!.panelCount}`,
        `Matrice : ${report.rowsObserved ?? "?"} × ${report.columnsObserved ?? "?"} / ${spec!.rows} × ${spec!.columns}`,
      ] : []),
      ...(physicalModuleGeometryRequired ? [
        `Proportions réelles du module : ${report.moduleShapeCorrect === true ? "oui" : "non"}`,
        `Échelle physique du champ : ${report.moduleScalePlausible === true ? "cohérente" : "à corriger"}`,
        `Projection sur le pan : ${report.projectiveConsistency === true ? "cohérente" : "à corriger"}`,
      ] : []),
      ...(dp === 3 ? [`Coupe latérale perpendiculaire au faîtage : ${sectionOk ? "oui" : "non"}`] : []),
      ...(references.length ? [`Cohérence avec DP2 : ${continuityOk ? "oui" : "non"}`] : []),
    ],
    issues,
  };
  return { inspector, report };
}

function correctionPrompt(basePrompt: string, issues: string[], attempt: number) {
  return [
    basePrompt,
    `AUTOMATIC CORRECTION PASS ${attempt}.`,
    "A previous candidate violated the locked project. Correct the listed failures before returning the new image.",
    ...issues.slice(0, 10).map((issue) => `- ${issue}`),
    "Re-read every NON-NEGOTIABLE rule above. Recount the exact array, re-check the real module rectangle and field scale, confirm the correct roof/building, then preserve the source evidence before returning the image.",
  ].join("\n\n");
}

export async function generatePreventiveDp(input: DpPieceInput & { dp: DirectDp }): Promise<DpPieceOutput> {
  const contract = getDpPieceContract(input.dp);
  if (!contract) throw new Error(`Contrat DP${input.dp} introuvable.`);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Clé du moteur visuel absente du poste local.");
  if (!input.address?.trim()) throw new Error("L'adresse exacte du projet est requise.");

  let ign: IgnContext | undefined;
  if (input.dp === 1 || input.dp === 2) ign = await resolveIgn(input.address);
  const address = ign?.normalizedAddress ?? input.address.trim();
  const spec = input.dp === 1 ? null : buildProjectLock(input);
  const source = chooseSource(input.dp, input, ign);
  const references = orderedReferences(input.dp, input.references);
  requireProjectAnchor(input.dp, references);
  const roofTruth = input.dp >= 2 ? await resolveAdvancedRoofTruth(address) : null;
  const basePrompt = [
    promptForDp(input.dp, address, ign?.parcelReference, spec, references),
    roofTruth?.usable ? roofTruth.promptContext : "",
  ].filter(Boolean).join("\n\n");

  let lastInspector: DpInspectorResult | null = null;
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const prompt = attempt === 1 ? basePrompt : correctionPrompt(basePrompt, lastIssues, attempt);
    const generated = await generateImage(
      apiKey,
      input.dp,
      source,
      prompt,
      references,
      input.dp === 1 ? ign?.close : input.dp === 2 ? ign?.situation : undefined,
    );
    const { inspector } = await inspect(apiKey, input.dp, source, generated, spec, ign?.parcelReference, references);
    lastInspector = inspector;
    if (inspector.passed) {
      return {
        dp: input.dp,
        title: contract.title,
        validationStatus: "test_unverified",
        mimeType: "image/png",
        base64: generated,
        sourceSummary: [
          `DP${input.dp} générée par le moteur visuel PilotPaper`,
          input.dp <= 2 ? `Source IGN/cadastre officielle · parcelle ${ign?.parcelReference}` : "Source photographique réelle",
          input.dp >= 2 ? "Configuration photovoltaïque verrouillée avec dimensions fabricant réelles" : "DP1 sans insertion photovoltaïque",
          input.dp >= 2 && spec ? `Préférences pose appliquées : ${spec.placement} · jeu ${spec.gapMm} mm · recul bas préféré ${spec.gutterClearanceMm} mm · ${spec.mountingSystem}` : "",
          references.length ? `Références projet : ${references.map((reference) => `DP${reference.dp}`).join(", ")}` : "Aucune reconstruction géométrique préalable",
          `Contrôle automatique préventif validé en ${attempt} tentative${attempt > 1 ? "s" : ""}`,
        ].filter(Boolean),
        inspector,
      };
    }
    lastIssues = inspector.issues.length ? inspector.issues : inspector.checks.filter((check) => /non|incorrecte|corriger|\?/i.test(check));
  }

  throw new Error([
    `DP${input.dp} non produite : PilotPaper a détecté une incohérence avant sauvegarde après ${MAX_GENERATION_ATTEMPTS} tentatives.`,
    ...(lastIssues.length ? lastIssues.slice(0, 5) : lastInspector?.checks ?? []),
  ].join(" "));
}
