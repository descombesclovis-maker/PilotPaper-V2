import type { ImageEditor, QualityJudge } from "../providers/interfaces";
import type { DPNumber, GeneratedAsset, InputPhoto, ProjectContext, ProjectForm, QualityReport } from "../types";
import { dpImagePrompt } from "../prompts/dpImage";
import { prioritizePhotos } from "../geometry/photoSelection";

export class AIVisualGenerator {
  constructor(private editor: ImageEditor, private judge: QualityJudge, private maxRetries = 3) {}

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
      const report = await this.judge.judge({ dp, form, context, originalPhotos: orderedPhotos, generated: asset });
      if (!bestReport || report.score > bestReport.score) {
        bestAsset = asset;
        bestReport = report;
      }
      if (report.passed) return { asset, quality: report };
      previous = asset;
      lastReport = report;
      correction = report.correctionPrompt || report.issues.map(i => `${i.code}: ${i.correction}`).join("\n");
    }

    // Keep the best real generation instead of destroying it after QA exhaustion.
    // The API route remains authoritative: production rejects a failed quality
    // report, while local/test mode may export it as TEST / NON VALIDE for review.
    if (bestAsset && bestReport) return { asset: bestAsset, quality: bestReport };
    throw new Error(`DP${dp} failed autonomous QA after ${this.maxRetries + 1} attempts: ${lastReport?.issues.map(i=>i.code).join(", ") ?? "unknown"}`);
  }
}
