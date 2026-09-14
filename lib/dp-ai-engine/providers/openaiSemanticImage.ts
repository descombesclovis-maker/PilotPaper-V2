import type { ImageEditor } from "./interfaces";
import type { DPNumber, GeneratedAsset, InputPhoto } from "../types";

function base64ToBlob(base64: string, mime: string): Blob {
  return new Blob([Buffer.from(base64, "base64")], { type: mime });
}

function extension(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function sourceOrder(dp: DPNumber): InputPhoto["role"][] {
  if (dp === 2) return ["satellite_mass", "satellite", "roof", "near", "front", "left_oblique", "right_oblique", "far"];
  if (dp === 3) return ["roof", "near", "front", "left_oblique", "right_oblique", "far", "satellite_mass", "satellite"];
  if (dp === 6) return ["far", "near", "roof", "front", "left_oblique", "right_oblique", "satellite_mass", "satellite"];
  if (dp === 4 || dp === 5) return ["roof", "near", "front", "left_oblique", "right_oblique", "far", "satellite_mass", "satellite"];
  return ["near", "roof", "front", "left_oblique", "right_oblique", "far", "satellite_mass", "satellite"];
}

function chooseBasePhoto(dp: DPNumber, photos: InputPhoto[]) {
  for (const role of sourceOrder(dp)) {
    const match = photos.find((photo) => photo.role === role);
    if (match) return match;
  }
  return photos[0];
}

function referencePhotos(dp: DPNumber, photos: InputPhoto[], base: InputPhoto) {
  // DP3-DP6 intentionally use one real source image. This mirrors the direct
  // ChatGPT image-edit workflow: understand this photograph, preserve it and
  // apply the requested project. Extra satellite/roof images can introduce a
  // second geometry and make the model drift to another roof plane.
  if (dp >= 3 && dp <= 6) return [];

  const remaining = photos.filter((photo) => photo !== base);
  const ordered: InputPhoto[] = [];
  for (const role of sourceOrder(dp)) {
    for (const photo of remaining) {
      if (photo.role === role && !ordered.includes(photo)) ordered.push(photo);
    }
  }
  for (const photo of remaining) if (!ordered.includes(photo)) ordered.push(photo);
  return ordered.slice(0, 2);
}

/**
 * Direct semantic image editor: same product behavior expected from ChatGPT
 * image editing. The complete real source image is supplied intact and GPT
 * Image is allowed to understand the site before rendering the requested DP
 * visual. No precomputed mask can force a wrong placement.
 */
export class OpenAISemanticImageEditor implements ImageEditor {
  readonly mode = "semantic-direct" as const;

  constructor(
    private apiKey: string,
    private model = "gpt-image-2",
  ) {}

  async edit({ dp, photos, prompt, previous }: Parameters<ImageEditor["edit"]>[0]): Promise<GeneratedAsset> {
    if (!photos.length) throw new Error("ChatGPT Image direct requires at least one project image.");
    const base = chooseBasePhoto(dp, photos);
    if (!base) throw new Error("No editable project image was found.");

    const data = new FormData();
    data.set("model", this.model);
    data.set("prompt", prompt);
    data.set("quality", "high");

    data.append(
      "image[]",
      base64ToBlob(base.base64, base.mimeType),
      base.filename ?? `project-${base.role}.${extension(base.mimeType)}`,
    );

    for (const photo of referencePhotos(dp, photos, base)) {
      data.append(
        "image[]",
        base64ToBlob(photo.base64, photo.mimeType),
        photo.filename ?? `reference-${photo.role}.${extension(photo.mimeType)}`,
      );
    }

    // Only DP2 may perform one corrective aerial retry. Photo insertions never
    // feed a generated candidate back as a new source because that compounds
    // reconstruction errors and can alter the original house.
    if (dp === 2 && previous?.base64) {
      data.append("image[]", base64ToBlob(previous.base64, previous.mimeType), "previous-candidate.png");
    }

    const startedAt = Date.now();
    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: data,
      signal: AbortSignal.timeout(180_000),
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
