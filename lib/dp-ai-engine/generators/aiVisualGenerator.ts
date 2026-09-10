import type { ImageEditor, QualityJudge } from "../providers/interfaces";
import type { DPNumber, GeneratedAsset, InputPhoto, ProjectContext, ProjectForm, QualityReport } from "../types";
import { dpImagePrompt } from "../prompts/dpImage";
import { prioritizePhotos } from "../geometry/photoSelection";
import { inspectGeneratedVisualDeterministically } from "../quality/visualInspector";

function unverifiedTestQuality(dp: DPNumber): QualityReport {
  return {
    passed: false,
    score: 0,
    panelCountObserved: undefined,
    rowsObserved: undefined,
    columnsObserved: undefined,
    buildingPreserved: false,
    perspectiveCoherent: false,
    scaleCoherent: false,
    placementCoherent: false,
    roofFaceCorrect: false,
    insideSelectedRoofFace: false,
    singleRoofPlane: false,
    crossesRidge: false,
    arrayGeometryConsistent: false,
    issues: [{
      code: "TEST_QA_SKIPPED",
      severity: "warning",
      message: `DP${dp} conservée dès le premier rendu OpenAI, sans rejet qualité en mode test.`,
      correction: "Contrôle qualité à réactiver avant passage en production.",
    }],
    correctionPrompt: "",
  };
}

function deterministicFailureQuality(
  dp: DPNumber,
  inspection: ReturnType<typeof inspectGeneratedVisualDeterministically>,
): QualityReport {
  return {
    passed: false,
    score: 0,
    panelCountObserved: inspection.audit?.panelCountProjected,
    rowsObserved: undefined,
    columnsObserved: undefined,
    buildingPreserved: inspection.audit?.exactOutsideMaskPreservation ?? false,
    perspectiveCoherent: false,
    scaleCoherent: false,
    placementCoherent: false,
    roofFaceCorrect: false,
    insideSelectedRoofFace: inspection.audit?.allPanelsInsideImage ?? false,
    singleRoofPlane: false,
    crossesRidge: false,
    arrayGeometryConsistent: false,
    issues: inspection.issues,
    correctionPrompt: inspection.issues.map((issue) => `${issue.code}: ${issue.correction}`).join("\n"),
  };
}

export class AIVisualGenerator {
  constructor(
    private editor: ImageEditor,
    private judge: QualityJudge,
    private maxRetries = 3,
    private acceptFirstResult = false,
  ) {}

  async generate(dp: DPNumber, form: ProjectForm, context: ProjectContext, photos: InputPhoto[], initialCorrection?: string): Promise<{asset:GeneratedAsset; quality:QualityReport}> {
    let previous: GeneratedAsset | undefined;
    let correction: string | undefined = initialCorrection;
    let lastReport: QualityReport | undefined;
    let bestAsset: GeneratedAsset | undefined;
    let bestReport: QualityReport | undefined;
    const orderedPhotos = prioritizePhotos(dp, photos, context);

    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      const prompt = dpImagePrompt(dp, context, correction);
      const asset = await this.editor.edit({ dp, context, photos: orderedPhotos, prompt, previous });

      // Local test contract: once OpenAI has actually returned an image, never
      // discard that paid result because of a downstream QA judgement. The file
      // remains explicitly unverified and production keeps the strict path.
      if (this.acceptFirstResult) {
        return { asset, quality: unverifiedTestQuality(dp) };
      }

      // Independent deterministic inspector runs before any model judgement.
      // A structural/pixel-preservation failure is not something another AI
      // rendering attempt can safely repair, so fail closed without wasting calls.
      const deterministic = inspectGeneratedVisualDeterministically({
        context,
        originalPhotos: orderedPhotos,
        generated: asset,
      });
      if (!deterministic.passed) {
        return { asset, quality: deterministicFailureQuality(dp, deterministic) };
      }

      let report: QualityReport;
      try {
        report = await this.judge.judge({ dp, form, context, originalPhotos: orderedPhotos, generated: asset });
      } catch (error) {
        // A judge outage must never destroy an image that was successfully
        // generated. Production can still reject the failed quality report at
        // the API gate, while the real image remains available for test export.
        return {
          asset,
          quality: {
            ...unverifiedTestQuality(dp),
            issues: [{
              code: "QA_PROVIDER_ERROR",
              severity: "error",
              message: error instanceof Error ? error.message : "Le contrôle qualité IA a échoué.",
              correction: "Relancer uniquement le contrôle qualité ; ne pas jeter l'image générée.",
            }],
          },
        };
      }

      if (!bestReport || report.score > bestReport.score) {
        bestAsset = asset;
        bestReport = report;
      }
      if (report.passed) return { asset, quality: report };
      previous = asset;
      lastReport = report;
      correction = report.correctionPrompt || report.issues.map(i => `${i.code}: ${i.correction}`).join("\n");
    }

    if (bestAsset && bestReport) return { asset: bestAsset, quality: bestReport };
    throw new Error(`DP${dp} failed autonomous QA after ${this.maxRetries + 1} attempts: ${lastReport?.issues.map(i=>i.code).join(", ") ?? "unknown"}`);
  }
}
