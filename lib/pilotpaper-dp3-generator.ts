import { getDpPieceContract } from "@/lib/dp-piece-contract";
import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";
import { analyzeDp3SectionSource } from "@/lib/pilotpaper-dp3-section-engine";
import type { DpPieceInput, DpPieceOutput, PiecePhotoInput, VisualReference } from "@/lib/pilotpaper-image2-types";

const IMAGE_MODEL = "gpt-image-2";
const DEFAULT_JUDGE_MODEL = "gpt-5.6-sol";
const MAX_DP3_ATTEMPTS = 4;

type Dp3Judge = {
  passed: boolean;
  score: number;
  orthographicSectionPresent: boolean;
  sectionPerpendicularToRidge: boolean;
  axonometricInsetPresent: boolean;
  sameBuildingIdentity: boolean;
  sameEquippedRoofPlane: boolean;
  projectFactsVisible: boolean;
  pvGeometryCredible: boolean;
  inventedNumericBuildingDimensions: boolean;
  inventedArchitecture: boolean;
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
  if (!source?.base64 || source.base64.length < 1000) throw new Error("DP3 : ajoutez une photo réelle lisible de la maison et de la toiture.");
  return source;
}

function requireDp2Reference(input: DpPieceInput) {
  const reference = input.references?.find((candidate) => candidate.dp === 2);
  if (!reference?.base64 || reference.base64.length < 1000) throw new Error("DP3 : générez d'abord la DP2. Son implantation validée sert de référence commune au dossier.");
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
  form.append("image[]", base64ToBlob(source.base64, source.mimeType), source.filename ?? `dp3-source.${extension(source.mimeType)}`);
  form.append("image[]", base64ToBlob(reference.base64, reference.mimeType), `dp2-accepted-reference.${extension(reference.mimeType)}`);

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) throw new Error(`Moteur visuel DP3 indisponible (${response.status}).`);
  const json = await response.json() as { data?: Array<{ b64_json?: string }> };
  const base64 = json.data?.[0]?.b64_json;
  if (!base64) throw new Error("DP3 : aucune image n'a été produite.");
  return base64;
}

async function inspectDp3(apiKey: string, source: PiecePhotoInput, reference: VisualReference, candidate: string, expectedFacts: string) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      passed: { type: "boolean" },
      score: { type: "number", minimum: 0, maximum: 1 },
      orthographicSectionPresent: { type: "boolean" },
      sectionPerpendicularToRidge: { type: "boolean" },
      axonometricInsetPresent: { type: "boolean" },
      sameBuildingIdentity: { type: "boolean" },
      sameEquippedRoofPlane: { type: "boolean" },
      projectFactsVisible: { type: "boolean" },
      pvGeometryCredible: { type: "boolean" },
      inventedNumericBuildingDimensions: { type: "boolean" },
      inventedArchitecture: { type: "boolean" },
      professionalReadable: { type: "boolean" },
      issues: { type: "array", items: { type: "string" } },
    },
    required: ["passed", "score", "orthographicSectionPresent", "sectionPerpendicularToRidge", "axonometricInsetPresent", "sameBuildingIdentity", "sameEquippedRoofPlane", "projectFactsVisible", "pvGeometryCredible", "inventedNumericBuildingDimensions", "inventedArchitecture", "professionalReadable", "issues"],
  };

  const prompt = [
    "Inspect PilotPaper DP3. Image 1 is the real house source, image 2 is the accepted DP2 project reference, image 3 is the candidate DP3.",
    expectedFacts,
    "The candidate must contain a genuine lateral architectural section perpendicular to the ridge. A front elevation alone fails.",
    "A small 3D axonometric cutaway/inset is required to make the roof and photovoltaic installation understandable, but it must not replace the true section.",
    "The building identity and equipped roof plane must agree with the real source and DP2. Do not require all modules to be individually visible in the orthographic cut; the project facts must be stated correctly and the 3D inset must remain coherent.",
    "Reject any invented numeric dimensions of the building, roof, walls, terrain or heights. Verified photovoltaic dimensions are allowed and expected.",
    "Reject invented rooms, openings or structural systems presented as factual. Neutral schematic cut lines are allowed.",
    "Judge PV module proportions, orientation and field scale as physical objects, not decorative squares.",
    "The sheet must be professionally readable and useful in a French declaration-préalable dossier.",
  ].join("\n");

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
          { type: "input_image", image_url: dataUrl(source.mimeType, source.base64), detail: "high" },
          { type: "input_image", image_url: dataUrl(reference.mimeType, reference.base64), detail: "high" },
          { type: "input_image", image_url: dataUrl("image/png", candidate), detail: "high" },
        ],
      }],
      text: { format: { type: "json_schema", name: "pilotpaper_dp3_inspector", strict: true, schema } },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`Contrôle DP3 indisponible (${response.status}).`);
  const json = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  let text = json.output_text;
  if (!text) {
    for (const item of json.output ?? []) for (const part of item.content ?? []) if (part.type === "output_text" && part.text) text = part.text;
  }
  if (!text) throw new Error("Contrôle DP3 : réponse vide.");
  return JSON.parse(text) as Dp3Judge;
}

function correctionPrompt(basePrompt: string, issues: string[], attempt: number) {
  return [
    basePrompt,
    `DP3 AUTOMATIC CORRECTION PASS ${attempt}.`,
    "The previous drawing was rejected. Correct the concrete failures below while preserving the real building identity and accepted DP2 project.",
    ...issues.slice(0, 10).map((issue) => `- ${issue}`),
    "Return the complete corrected DP3 sheet, not an explanation.",
  ].join("\n\n");
}

export async function generateSpecializedDp3(input: DpPieceInput & { dp: 3 }): Promise<DpPieceOutput> {
  const contract = getDpPieceContract(3);
  if (!contract) throw new Error("Contrat DP3 introuvable.");
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Clé du moteur visuel absente du poste local.");

  const source = requireSource(input);
  const dp2 = requireDp2Reference(input);
  const module = requireVerifiedPvModule(input.moduleReference ?? "");
  const panelCount = positiveInteger(input.panelCount, "Le nombre de panneaux");
  const rows = positiveInteger(input.rows, "Le nombre de rangées");
  const columns = positiveInteger(input.columns, "Le nombre de colonnes");
  if (rows * columns !== panelCount) throw new Error(`${rows} × ${columns} ne correspond pas à ${panelCount} panneaux.`);
  const orientation = input.orientation === "landscape" ? "landscape" : "portrait";
  const orientedWidthMm = orientation === "portrait" ? module.widthMm : module.heightMm;
  const orientedHeightMm = orientation === "portrait" ? module.heightMm : module.widthMm;
  const fieldWidthMm = columns * orientedWidthMm + Math.max(0, columns - 1) * 20;
  const fieldHeightMm = rows * orientedHeightMm + Math.max(0, rows - 1) * 20;

  const sectionAnalysis = await analyzeDp3SectionSource({
    apiKey,
    judgeModel: process.env.DP_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL,
    source,
    references: [dp2],
  });

  const expectedFacts = [
    `Project address: ${input.address}.`,
    `Photovoltaic module: ${module.manufacturer} ${module.canonicalReference}.`,
    `Verified module dimensions: ${module.widthMm} × ${module.heightMm} × ${module.thicknessMm} mm.`,
    `Requested installation: exactly ${panelCount} modules, ${rows} rows × ${columns} columns, ${orientation} orientation.`,
    `Oriented module footprint in the array: ${orientedWidthMm} × ${orientedHeightMm} mm.`,
    `Calculated field footprint: ${fieldWidthMm} × ${fieldHeightMm} mm with 20 mm inter-module visual gaps.`,
  ].join("\n");

  const basePrompt = [
    "PILOTPAPER DP3 — SPECIALIZED ARCHITECTURAL + PHOTOVOLTAIC SECTION.",
    "You are not a generic image generator. Reason as an experienced photovoltaic installer working with an architectural drafter.",
    "Image 1 is the real building source. Image 2 is the already accepted DP2 and defines the physical equipped roof plane and installation identity.",
    expectedFacts,
    sectionAnalysis ?? "Automatic source pre-analysis was unavailable. Infer only the non-numeric visible roof/building structure directly from the supplied images and continue; do not block generation.",
    "OUTPUT LAYOUT: create one clean professional DP3 sheet on a white background.",
    "MAIN VIEW: a genuine orthographic LATERAL architectural section through the building, with the section plane perpendicular to the roof ridge. It must show natural ground, exterior walls, eaves/gutter, roof slopes, ridge, roof covering and the photovoltaic layer fixed above the relevant roof plane.",
    "SECONDARY VIEW: add a smaller 3D axonometric cutaway/inset of the SAME building and SAME roof to make the relationship between roof plane, ridge, modules and section direction immediately understandable.",
    "Do not turn the main view into a front elevation. Do not invent a new house.",
    "Do not invent rooms, doors, windows, framing systems or hidden structural details as factual information. Use neutral schematic cut surfaces where hidden construction is unknown.",
    "NUMERIC DIMENSION RULE: never invent building/roof/terrain numeric dimensions. If a building dimension is not supplied from a verified source, omit the number rather than estimating it.",
    `The following photovoltaic dimensions ARE verified and should be dimensioned clearly: one module ${module.widthMm} × ${module.heightMm} × ${module.thicknessMm} mm; complete field ${fieldWidthMm} × ${fieldHeightMm} mm; ${panelCount} modules; matrix ${rows} × ${columns}; orientation ${orientation}.`,
    "Use dimension lines and a small technical legend for these verified PV values. Also label: terrain naturel, mur existant, égout/gouttière, couverture existante, faîtage, modules photovoltaïques.",
    "The side section does not need to visually expose every module because modules overlap in the viewing direction. Do not fake a frontal 2×6 grid in the cut. The full 2×6 identity must instead remain explicit in the legend and coherent in the 3D inset.",
    "The 3D inset must use rectangular modules with the real physical proportions and the same DP2 roof plane. Never use square decorative panels.",
    "Keep the drawing sober, architectural, legible and suitable for a French déclaration préalable. Title: 'DP3 — Plan en coupe'.",
  ].join("\n\n");

  let lastIssues: string[] = [];
  let lastJudge: Dp3Judge | null = null;

  for (let attempt = 1; attempt <= MAX_DP3_ATTEMPTS; attempt += 1) {
    const prompt = attempt === 1 ? basePrompt : correctionPrompt(basePrompt, lastIssues, attempt);
    const candidate = await generateImage(apiKey, prompt, source, dp2);
    const judge = await inspectDp3(apiKey, source, dp2, candidate, expectedFacts);
    lastJudge = judge;

    const strictPass = Boolean(
      judge.passed &&
      judge.score >= 0.82 &&
      judge.orthographicSectionPresent &&
      judge.sectionPerpendicularToRidge &&
      judge.axonometricInsetPresent &&
      judge.sameBuildingIdentity &&
      judge.sameEquippedRoofPlane &&
      judge.projectFactsVisible &&
      judge.pvGeometryCredible &&
      !judge.inventedNumericBuildingDimensions &&
      !judge.inventedArchitecture &&
      judge.professionalReadable
    );

    if (strictPass) {
      return {
        dp: 3,
        title: contract.title,
        validationStatus: "test_unverified",
        mimeType: "image/png",
        base64: candidate,
        sourceSummary: [
          "DP3 produite par la voie spécialisée coupe architecturale + photovoltaïque",
          "Analyse visuelle préalable non bloquante de la maison réelle",
          "DP2 utilisée comme verrou de pan et d'identité de l'installation",
          `Cotes PV vérifiées : module ${module.widthMm} × ${module.heightMm} × ${module.thicknessMm} mm · champ ${fieldWidthMm} × ${fieldHeightMm} mm`,
          "Aucune cote numérique de bâtiment inventée",
          `Inspector DP3 validé en ${attempt} tentative${attempt > 1 ? "s" : ""}`,
        ],
        inspector: {
          passed: true,
          score: judge.score,
          checks: [
            "Coupe latérale orthographique : conforme",
            "Coupe perpendiculaire au faîtage : conforme",
            "Lecture 3D axonométrique : présente",
            "Même bâtiment et même pan que DP2 : oui",
            "Cotes photovoltaïques vérifiées : reportées",
            "Cotes bâtiment inventées : aucune",
          ],
          issues: judge.issues,
        },
      };
    }

    lastIssues = [
      ...judge.issues,
      ...(!judge.orthographicSectionPresent ? ["La vraie coupe orthographique manque."] : []),
      ...(!judge.sectionPerpendicularToRidge ? ["La coupe n'est pas perpendiculaire au faîtage."] : []),
      ...(!judge.axonometricInsetPresent ? ["La lecture 3D axonométrique manque."] : []),
      ...(!judge.sameBuildingIdentity ? ["Le bâtiment ne correspond pas assez à la source."] : []),
      ...(!judge.sameEquippedRoofPlane ? ["Le pan équipé ne correspond pas à la DP2."] : []),
      ...(!judge.projectFactsVisible ? ["Les données du formulaire ne sont pas toutes reportées dans la pièce."] : []),
      ...(!judge.pvGeometryCredible ? ["Les modules ou le champ photovoltaïque n'ont pas une géométrie physique crédible."] : []),
      ...(judge.inventedNumericBuildingDimensions ? ["Des cotes numériques de bâtiment ont été inventées."] : []),
      ...(judge.inventedArchitecture ? ["Des éléments architecturaux non vérifiés ont été inventés."] : []),
      ...(!judge.professionalReadable ? ["La planche n'est pas suffisamment lisible/professionnelle."] : []),
    ];
  }

  throw new Error([
    `DP3 non produite : la coupe n'a pas atteint le niveau de conformité après ${MAX_DP3_ATTEMPTS} tentatives.`,
    ...(lastIssues.length ? lastIssues.slice(0, 6) : lastJudge?.issues ?? []),
  ].join(" "));
}
