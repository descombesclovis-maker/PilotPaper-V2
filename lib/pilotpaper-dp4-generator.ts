import { getDpPieceContract } from "@/lib/dp-piece-contract";
import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";
import { resolveAdvancedRoofTruth } from "@/lib/geometry/advanced-roof-truth";
import type { DpPieceInput, DpPieceOutput, PiecePhotoInput, VisualReference } from "@/lib/pilotpaper-image2-types";

const IMAGE_MODEL = "gpt-image-2";
const DEFAULT_JUDGE_MODEL = "gpt-5.6-sol";
const MAX_DP4_ATTEMPTS = 4;

type Dp4Judge = {
  score: number;
  sameCamera: boolean;
  sameBuilding: boolean;
  sourceScenePreserved: boolean;
  pvOnlyChange: boolean;
  exactPanelCount: number | null;
  rowsObserved: number | null;
  columnsObserved: number | null;
  sameDp2RoofPlane: boolean;
  moduleShapeCorrect: boolean;
  moduleScalePlausible: boolean;
  projectiveConsistency: boolean;
  projectFactsVisible: boolean;
  professionalReadable: boolean;
  issues: string[];
};

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} doit être un entier positif.`);
  return parsed;
}

function requireSource(input: DpPieceInput) {
  const source = input.photos?.find((photo) => photo.role === "near") ?? input.photos?.find((photo) => photo.role === "roof");
  if (!source?.base64 || source.base64.length < 1000) throw new Error("DP4 : ajoutez une photo réelle de la maison et de la toiture concernée.");
  return source;
}

function requireDp2Reference(input: DpPieceInput) {
  const reference = input.references?.find((candidate) => candidate.dp === 2);
  if (!reference?.base64 || reference.base64.length < 1000) throw new Error("DP4 : générez d'abord la DP2. Son implantation validée sert de référence commune au dossier.");
  return reference;
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

async function generateImage(apiKey: string, prompt: string, source: PiecePhotoInput, reference: VisualReference) {
  const form = new FormData();
  form.set("model", IMAGE_MODEL);
  form.set("prompt", prompt);
  form.set("quality", "high");
  form.append("image[]", base64ToBlob(source.base64, source.mimeType), source.filename ?? `dp4-source.${extension(source.mimeType)}`);
  form.append("image[]", base64ToBlob(reference.base64, reference.mimeType), `dp2-accepted-reference.${extension(reference.mimeType)}`);
  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) throw new Error(`Moteur visuel DP4 indisponible (${response.status}).`);
  const json = await response.json() as { data?: Array<{ b64_json?: string }> };
  const base64 = json.data?.[0]?.b64_json;
  if (!base64) throw new Error("DP4 : aucune image n'a été produite.");
  return base64;
}

async function inspect(apiKey: string, source: PiecePhotoInput, dp2: VisualReference, candidate: string, facts: string) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      score: { type: "number", minimum: 0, maximum: 1 },
      sameCamera: { type: "boolean" },
      sameBuilding: { type: "boolean" },
      sourceScenePreserved: { type: "boolean" },
      pvOnlyChange: { type: "boolean" },
      exactPanelCount: { anyOf: [{ type: "integer" }, { type: "null" }] },
      rowsObserved: { anyOf: [{ type: "integer" }, { type: "null" }] },
      columnsObserved: { anyOf: [{ type: "integer" }, { type: "null" }] },
      sameDp2RoofPlane: { type: "boolean" },
      moduleShapeCorrect: { type: "boolean" },
      moduleScalePlausible: { type: "boolean" },
      projectiveConsistency: { type: "boolean" },
      projectFactsVisible: { type: "boolean" },
      professionalReadable: { type: "boolean" },
      issues: { type: "array", items: { type: "string" } },
    },
    required: ["score", "sameCamera", "sameBuilding", "sourceScenePreserved", "pvOnlyChange", "exactPanelCount", "rowsObserved", "columnsObserved", "sameDp2RoofPlane", "moduleShapeCorrect", "moduleScalePlausible", "projectiveConsistency", "projectFactsVisible", "professionalReadable", "issues"],
  };
  const prompt = [
    "Inspect PilotPaper DP4. Image 1 is the real source photo, image 2 is accepted DP2, image 3 is the candidate before/after sheet.",
    facts,
    "The candidate must preserve the established successful PilotPaper DP4 composition: a clear title, ÉTAT INITIAL on the left, ÉTAT PROJETÉ on the right, two matching photo frames, and the technical legend below. Do not reward redesigns that change this composition.",
    "The candidate must show initial and projected states of the SAME source photo with the SAME camera. The projected state may change only by adding the photovoltaic installation.",
    "Count panels only in the projected state. Count from pixels, never from captions. The visible count and rows × columns matrix must exactly match the project facts.",
    "The equipped roof plane and zone must match DP2. Modules must have credible real rectangular proportions, field scale and one coherent roof-plane perspective.",
    "MODULE SHAPE HARD GATE: compare the visible panel geometry with the verified real module dimensions contained in the project facts. If the modules look square or near-square in a way the camera perspective does not physically justify, moduleShapeCorrect MUST be false. All modules must share the same physical rectangle and the same roof-plane projection; do not accept individually stretched or compressed tiles.",
    "Doors, windows, façade, roof, annexes, vegetation and surroundings must remain unchanged between source/initial/projected states apart from the PV installation.",
    "A discreet technical legend must accurately report the project facts.",
  ].join("\n");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.DP_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL,
      store: false,
      input: [{ role: "user", content: [
        { type: "input_text", text: prompt },
        { type: "input_image", image_url: dataUrl(source.mimeType, source.base64), detail: "high" },
        { type: "input_image", image_url: dataUrl(dp2.mimeType, dp2.base64), detail: "high" },
        { type: "input_image", image_url: dataUrl("image/png", candidate), detail: "high" },
      ] }],
      text: { format: { type: "json_schema", name: "pilotpaper_dp4_inspector", strict: true, schema } },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`Contrôle DP4 indisponible (${response.status}).`);
  const json = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  let text = json.output_text;
  if (!text) for (const item of json.output ?? []) for (const part of item.content ?? []) if (part.type === "output_text" && part.text) text = part.text;
  if (!text) throw new Error("Contrôle DP4 : réponse vide.");
  return JSON.parse(text) as Dp4Judge;
}

function correctionPrompt(base: string, issues: string[], attempt: number) {
  return [
    base,
    `DP4 AUTOMATIC CORRECTION PASS ${attempt}.`,
    ...issues.slice(0, 10).map((issue) => `- ${issue}`),
    "Keep the successful DP4 layout unchanged: initial photo left, projected photo right, same camera and crop, legend below. Correct only the rejected photovoltaic details and return the complete corrected DP4 sheet.",
  ].join("\n\n");
}

export async function generateSpecializedDp4(input: DpPieceInput & { dp: 4 }): Promise<DpPieceOutput> {
  const contract = getDpPieceContract(4);
  if (!contract) throw new Error("Contrat DP4 introuvable.");
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Clé du moteur visuel absente du poste local.");
  const source = requireSource(input);
  const dp2 = requireDp2Reference(input);
  const roofTruth = await resolveAdvancedRoofTruth(input.address);
  const module = requireVerifiedPvModule(input.moduleReference ?? "");
  const panelCount = positiveInteger(input.panelCount, "Le nombre de panneaux");
  const rows = positiveInteger(input.rows, "Le nombre de rangées");
  const columns = positiveInteger(input.columns, "Le nombre de colonnes");
  if (rows * columns !== panelCount) throw new Error(`${rows} × ${columns} ne correspond pas à ${panelCount} panneaux.`);
  const orientation = input.orientation === "landscape" ? "landscape" : "portrait";
  const orientedWidth = orientation === "portrait" ? module.widthMm : module.heightMm;
  const orientedHeight = orientation === "portrait" ? module.heightMm : module.widthMm;
  const fieldWidth = columns * orientedWidth + Math.max(0, columns - 1) * 20;
  const fieldHeight = rows * orientedHeight + Math.max(0, rows - 1) * 20;
  const moduleAspectRatio = Math.max(module.widthMm, module.heightMm) / Math.min(module.widthMm, module.heightMm);
  const facts = `Project: ${module.manufacturer} ${module.canonicalReference}; real module ${module.widthMm} × ${module.heightMm} × ${module.thicknessMm} mm; long-side/short-side ratio ${moduleAspectRatio.toFixed(3)}; exactly ${panelCount} modules; ${rows} × ${columns}; ${orientation}; complete field ${fieldWidth} × ${fieldHeight} mm before perspective.`;

  const basePrompt = [
    "PILOTPAPER DP4 — PHOTOVOLTAIC INSTALLER MODE.",
    roofTruth.usable ? roofTruth.promptContext : "Advanced roof truth unavailable: preserve the real source and accepted DP2 as the physical anchors.",
    "Reason as a photovoltaic installer performing a photographic insertion, not as a generic image generator.",
    "Image 1 is the immutable real source. Image 2 is the accepted DP2 and identifies the equipped roof plane and installation zone.",
    facts,
    "TEMPLATE LOCK — KEEP THE SUCCESSFUL PILOTPAPER DP4 DESIGN: one title line; two equal side-by-side photo frames; left labeled 'ÉTAT INITIAL'; right labeled 'ÉTAT PROJETÉ'; technical legend beneath the photos. Do not replace this with a collage, a new camera, a different page structure or another visual style.",
    "The LEFT side must remain visually faithful to Image 1. The RIGHT side must be the same photo with only the photovoltaic array added.",
    `On the projected side insert exactly ${panelCount} modules in ${rows} visible rows × ${columns} visible columns. Count the visible modules before returning the image.`,
    `Each module is a real ${module.widthMm} × ${module.heightMm} mm rectangle, ${module.thicknessMm} mm thick, with long-side/short-side ratio ${moduleAspectRatio.toFixed(3)}. In ${orientation}, its array footprint is ${orientedWidth} × ${orientedHeight} mm. The complete field is ${fieldWidth} × ${fieldHeight} mm before projection.`,
    "Use those dimensions as physical geometry: do not make square or near-square tiles, do not stretch individual modules and do not arbitrarily enlarge/shrink the field to fill the roof. The complete array must be formed from identical physical rectangles under one single projective transform on the roof plane.",
    "Use one coherent perspective on one continuous roof plane. Respect ridge, eaves, edges, chimneys, skylights and visible obstacles.",
    "Do not change any door, window, façade, roof tile pattern, annex, tree, fence, driveway, ground or sky. No beautification.",
    "Add a discreet technical legend outside the important architecture with module reference, exact quantity, matrix, orientation, real module dimensions and calculated field dimensions.",
    "Title: 'DP4 — État initial / état projeté'.",
  ].join("\n\n");

  let issues: string[] = [];
  for (let attempt = 1; attempt <= MAX_DP4_ATTEMPTS; attempt += 1) {
    const candidate = await generateImage(apiKey, attempt === 1 ? basePrompt : correctionPrompt(basePrompt, issues, attempt), source, dp2);
    const judge = await inspect(apiKey, source, dp2, candidate, facts);
    const exact = judge.exactPanelCount === panelCount && judge.rowsObserved === rows && judge.columnsObserved === columns;
    const criticalPass = Boolean(
      judge.score >= 0.82 && judge.sameCamera && judge.sameBuilding && judge.sourceScenePreserved && judge.pvOnlyChange && exact && judge.sameDp2RoofPlane && judge.moduleShapeCorrect && judge.moduleScalePlausible && judge.projectiveConsistency && judge.projectFactsVisible && judge.professionalReadable
    );
    if (criticalPass) {
      return {
        dp: 4,
        title: contract.title,
        validationStatus: "test_unverified",
        mimeType: "image/png",
        base64: candidate,
        sourceSummary: [
          "DP4 générée en mode retouche photovoltaïque spécialisée",
          "Composition DP4 validée verrouillée : état initial / état projeté / légende",
          "Photo initiale et caméra verrouillées",
          "DP2 utilisée comme verrou du pan et de la zone physique",
          `Dimensions fabricant : ${module.widthMm} × ${module.heightMm} × ${module.thicknessMm} mm`,
          `Champ calculé : ${fieldWidth} × ${fieldHeight} mm`,
          `Inspector DP4 validé en ${attempt} tentative${attempt > 1 ? "s" : ""}`,
        ],
        inspector: { passed: true, score: judge.score, checks: [
          "Même photo / même caméra : oui",
          "Seule modification physique : photovoltaïque",
          `Panneaux : ${panelCount}/${panelCount}`,
          `Matrice : ${rows} × ${columns}`,
          "Même pan que DP2 : oui",
          "Proportions et échelle des modules : cohérentes",
        ], issues: judge.issues },
      };
    }
    issues = [
      ...judge.issues,
      ...(!judge.sameCamera ? ["La caméra ou le cadrage diffère entre les états."] : []),
      ...(!judge.sameBuilding || !judge.sourceScenePreserved ? ["La maison ou la scène source a été modifiée."] : []),
      ...(!judge.pvOnlyChange ? ["Des éléments autres que les panneaux ont changé."] : []),
      ...(!exact ? [`La matrice visible n'est pas exactement ${rows} × ${columns} = ${panelCount}.`] : []),
      ...(!judge.sameDp2RoofPlane ? ["Le pan/zone équipé ne correspond pas à DP2."] : []),
      ...(!judge.moduleShapeCorrect || !judge.moduleScalePlausible || !judge.projectiveConsistency ? [`Les panneaux doivent conserver la géométrie réelle ${module.widthMm} × ${module.heightMm} mm (ratio ${moduleAspectRatio.toFixed(3)}) et une projection cohérente ; les formes carrées sont rejetées.`] : []),
      ...(!judge.projectFactsVisible ? ["La légende ne reporte pas correctement les informations du formulaire."] : []),
    ];
  }
  throw new Error(`DP4 non produite après ${MAX_DP4_ATTEMPTS} corrections automatiques. ${issues.slice(0, 6).join(" ")}`);
}