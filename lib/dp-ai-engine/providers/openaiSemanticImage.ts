import type { ImageEditor } from "./interfaces";
import type { GeneratedAsset, InputPhoto } from "../types";

function base64ToBlob(base64: string, mime: string): Blob {
  return new Blob([Buffer.from(base64, "base64")], { type: mime });
}

function extension(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function chooseBasePhoto(photos: InputPhoto[]) {
  const order: InputPhoto["role"][] = ["roof", "near", "front", "left_oblique", "right_oblique", "far"];
  for (const role of order) {
    const match = photos.find((photo) => photo.role === role);
    if (match) return match;
  }
  return photos[0];
}

/**
 * Direct semantic image editor: this is deliberately the same product behavior
 * expected from ChatGPT image editing. The real project photograph is supplied
 * intact and the image model is allowed to understand the roof and render the
 * requested installation from semantic constraints. No precomputed module mask
 * is required, so a bad upstream projection can no longer force a bad render.
 */
export class OpenAISemanticImageEditor implements ImageEditor {
  constructor(
    private apiKey: string,
    private model = "gpt-image-2",
  ) {}

  async edit({ dp, photos, prompt, previous }: Parameters<ImageEditor["edit"]>[0]): Promise<GeneratedAsset> {
    if (!photos.length) throw new Error("ChatGPT Image direct requires at least one project photograph.");
    const base = chooseBasePhoto(photos);
    if (!base) throw new Error("No editable project photograph was found.");

    const data = new FormData();
    data.set("model", this.model);
    data.set("prompt", prompt);
    data.set("quality", "high");

    // First image is the real scene to edit. Do not send a geometric mask here:
    // the model must be able to reason about the complete roof, roof windows,
    // chimneys, vents, ridges and usable free areas exactly as ChatGPT does.
    data.append(
      "image[]",
      base64ToBlob(base.base64, base.mimeType),
      base.filename ?? `project-${base.role}.${extension(base.mimeType)}`,
    );

    // Other real views are references only; they help disambiguate obstacles and
    // the building while keeping the first photograph as the editable scene.
    for (const photo of photos.filter((photo) => photo !== base).slice(0, 3)) {
      data.append(
        "image[]",
        base64ToBlob(photo.base64, photo.mimeType),
        photo.filename ?? `reference-${photo.role}.${extension(photo.mimeType)}`,
      );
    }

    // A failed candidate can be supplied as an additional visual reference when
    // QA asks for a correction, but it never replaces the original scene.
    if (previous?.base64) {
      data.append("image[]", base64ToBlob(previous.base64, previous.mimeType), "previous-candidate.png");
    }

    const startedAt = Date.now();
    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: data,
      signal: AbortSignal.timeout(240_000),
    });
    console.log(`[PilotPaper][OpenAI direct] DP${dp} HTTP ${response.status} after ${Date.now() - startedAt}ms`);

    if (!response.ok) {
      throw new Error(`OpenAI direct image edit error ${response.status}: ${await response.text()}`);
    }
    const json = await response.json() as { data?: Array<{ b64_json?: string }> };
    const base64 = json.data?.[0]?.b64_json;
    if (!base64) throw new Error("OpenAI direct image edit returned no image.");

    return {
      dp,
      kind: "image",
      mimeType: "image/png",
      base64,
      generationPrompt: prompt,
      attempt: (previous?.attempt ?? 0) + 1,
      sourceRole: base.role,
    };
  }
}
