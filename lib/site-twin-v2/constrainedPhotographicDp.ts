import "server-only";

import { getDpPieceContract } from "@/lib/dp-piece-contract";
import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";
import type { DpPieceInput, DpPieceOutput, PiecePhotoInput } from "@/lib/pilotpaper-image2-types";
import { renderGeometryLockedPhotoInsertion } from "./constrainedPhotoEdit";

const DEFAULT_JUDGE_MODEL = "gpt-5.6-sol";
const MAX_VISUAL_ATTEMPTS = 3;

type VisualJudge = {
  score: number;
  panelCountObserved: number | null;
  photovoltaicModulesClearlyRendered: boolean;
  moduleShapeConsistent: boolean;
  commonPerspective: boolean;
  lightingAndReflectionsNatural: boolean;
  roofContactNatural: boolean;
  cgiArtifactsAbsent: boolean;
  issues: string[];
};

function sourceFor(input: DpPieceInput & { dp: 5 | 6 }) {
  const preferred: PiecePhotoInput["role"][] = input.dp === 6 ? ["far"] : ["roof", "near"];
  for (const role of preferred) {
    const photo = input.photos?.find((candidate) => candidate.role === role);
    if (photo?.base64 && photo.base64.length > 1000) return photo;
  }
  throw new Error(input.dp === 6
    ? "DP6 : ajoutez une photo lointaine réelle montrant la maison dans son environnement."
    : "DP5 : ajoutez une vue réelle lisible de la toiture ou de la maison proche.");
}

function dataUrl(base64: string) {
  return `data:image/png;base64,${base64}`;
}

async function judgeInsertion(args: {
  apiKey: string;
  input: DpPieceInput & { dp: 5 | 6 };
  source: string;
  candidate: string;
}) {
  const module = requireVerifiedPvModule(args.input.moduleReference ?? "");
  const expected = Number(args.input.panelCount ?? 0);
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      score: { type: "number", minimum: 0, maximum: 1 },
      panelCountObserved: { anyOf: [{ type: "integer" }, { type: "null" }] },
      photovoltaicModulesClearlyRendered: { type: "boolean" },
      moduleShapeConsistent: { type: "boolean" },
      commonPerspective: { type: "boolean" },
      lightingAndReflectionsNatural: { type: "boolean" },
      roofContactNatural: { type: "boolean" },
      cgiArtifactsAbsent: { type: "boolean" },
      issues: { type: "array", items: { type: "string" } },
    },
    required: [
      "score",
      "panelCountObserved",
      "photovoltaicModulesClearlyRendered",
      "moduleShapeConsistent",
      "commonPerspective",
      "lightingAndReflectionsNatural",
      "roofContactNatural",
      "cgiArtifactsAbsent",
      "issues",
    ],
  };
  const prompt = [
    `Inspect PilotPaper DP${args.input.dp} photovoltaic insertion. Image 1 is the immutable source after normalization; image 2 is the candidate after strict geometric compositing.`,
    `Expected exactly ${expected} modules, model ${module.manufacturer} ${module.canonicalReference}, real dimensions ${module.widthMm} × ${module.heightMm} × ${module.thicknessMm} mm.`,
    "The geometry and locations are externally locked; judge only whether every projected island visibly contains a credible photovoltaic module and whether their material, common perspective, reflections, lighting, contact and local sharpness look photographic.",
    "Do not penalize unchanged pixels outside the photovoltaic islands: they are intentionally restored from the source pixel-for-pixel.",
    "If modules are blank, painted as featureless dark rectangles, visibly CGI, inconsistent with one another, floating above the roof or have incompatible reflections, fail the candidate.",
    "Count modules when they remain visually distinguishable. If distance makes an exact count genuinely impossible, use null rather than guessing.",
  ].join("\n");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.DP_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL,
      store: false,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: dataUrl(args.source), detail: "high" },
          { type: "input_image", image_url: dataUrl(args.candidate), detail: "high" },
        ],
      }],
      text: { format: { type: "json_schema", name: "pilotpaper_geometry_locked_visual_qa", strict: true, schema } },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`Contrôle visuel DP${args.input.dp} indisponible (${response.status}).`);
  const json = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  let text = json.output_text;
  if (!text) for (const item of json.output ?? []) for (const part of item.content ?? []) if (part.type === "output_text" && part.text) text = part.text;
  if (!text) throw new Error(`Contrôle visuel DP${args.input.dp} : réponse vide.`);
  return JSON.parse(text) as VisualJudge;
}

function visualPass(judge: VisualJudge, expectedPanelCount: number, distant: boolean) {
  const countPass = judge.panelCountObserved === expectedPanelCount || (distant && judge.panelCountObserved === null);
  return Boolean(
    judge.score >= 0.88
    && countPass
    && judge.photovoltaicModulesClearlyRendered
    && judge.moduleShapeConsistent
    && judge.commonPerspective
    && judge.lightingAndReflectionsNatural
    && judge.roofContactNatural
    && judge.cgiArtifactsAbsent
  );
}

export async function generateGeometryLockedPhotographicDp(input: DpPieceInput & { dp: 5 | 6 }): Promise<DpPieceOutput> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Clé du moteur visuel absente du poste local.");
  const contract = getDpPieceContract(input.dp);
  if (!contract) throw new Error(`Contrat DP${input.dp} introuvable.`);
  const source = sourceFor(input);
  const expectedPanelCount = Number(input.panelCount ?? 0);
  let correction: string | undefined;
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= MAX_VISUAL_ATTEMPTS; attempt += 1) {
    const rendered = await renderGeometryLockedPhotoInsertion({ input, photo: source, correction });
    const judge = await judgeInsertion({ apiKey, input, source: rendered.sourcePngBase64, candidate: rendered.base64 });
    if (visualPass(judge, expectedPanelCount, input.dp === 6)) {
      const face = rendered.context.siteTwin.roof.faces.find((candidate) => candidate.id === rendered.context.layout.selectedFaceIds[0]);
      return {
        dp: input.dp,
        title: contract.title,
        validationStatus: "test_unverified",
        mimeType: "image/png",
        base64: rendered.base64,
        sourceSummary: [
          `DP${input.dp} : insertion photoréaliste limitée aux coordonnées physiques calculées du champ photovoltaïque.`,
          `${rendered.context.layout.modules.length} modules · pan ${face?.displayLabel ?? "verrouillé"} · Site Twin ${rendered.context.siteTwin.id} rev. ${rendered.context.siteTwin.revision}.`,
          `Recalage photo : ${rendered.registration.reprojectionErrorPx.toFixed(2)} px · ${rendered.registration.inliers}/${rendered.registration.matches} correspondances cohérentes (${Math.round(rendered.registration.inlierRatio * 100)} %).`,
          `Pixels PV effectivement rendus : ${Math.round(rendered.changedIslandRatio * 100)} % · pixels hors masque restaurés depuis la photo réelle.`,
          `Contrôle de photoréalisme validé en ${attempt} tentative${attempt > 1 ? "s" : ""}.`,
        ],
        inspector: {
          passed: true,
          score: judge.score,
          checks: [
            `Panneaux projetés : ${rendered.panelPolygonsNormalized.length}/${expectedPanelCount}`,
            "Coordonnées décidées par le moteur métrique : oui",
            "Pixels hors insertion préservés : oui",
            `Perspective commune : ${judge.commonPerspective ? "oui" : "non"}`,
            `Contact toiture : ${judge.roofContactNatural ? "naturel" : "à corriger"}`,
            `Photoréalisme : ${judge.cgiArtifactsAbsent && judge.lightingAndReflectionsNatural ? "validé" : "à corriger"}`,
          ],
          issues: judge.issues,
        },
      };
    }
    lastIssues = judge.issues.length ? judge.issues : ["Le rendu des modules n'a pas atteint le niveau photoréaliste requis."];
    correction = [
      ...lastIssues,
      "Improve only panel material, reflections, local lighting, contact shadows and edge integration inside the same immutable islands.",
      "Do not alter geometry or module locations.",
    ].join("\n");
  }

  throw new Error(`DP${input.dp} rejetée après ${MAX_VISUAL_ATTEMPTS} rendus visuels sur la même géométrie : ${lastIssues.slice(0, 4).join(" ")}`);
}
