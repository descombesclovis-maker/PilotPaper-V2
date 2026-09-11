import type { ImageEditor } from "./interfaces";
import type { GeneratedAsset, InputPhoto } from "../types";
import { buildPanelIslandsMaskForPng } from "../utils/maskPng";
import { strictCompositePng } from "../utils/pngPixels";
import {
  allPanelPolygonsForRoleLegacy,
  allPanelPolygonsForRoleProjective,
} from "../geometry/panelProjection";

export type ImageProjectionMode = "legacy-bilinear" | "projective";

function base64ToBlob(base64: string, mime: string): Blob {
  return new Blob([Buffer.from(base64, "base64")], { type: mime });
}

function projectedPolygons(
  photos: InputPhoto[],
  context: Parameters<ImageEditor["edit"]>[0]["context"],
  mode: ImageProjectionMode,
) {
  for (const photo of photos) {
    if (photo.mimeType !== "image/png") continue;
    const polygons = mode === "projective"
      ? allPanelPolygonsForRoleProjective(context, photo.role)
      : allPanelPolygonsForRoleLegacy(context, photo.role);
    if (polygons && polygons.length === context.exactPanelCount) {
      return { photo, polygons };
    }
  }
  return undefined;
}

export class OpenAIImageEditor implements ImageEditor {
  constructor(
    private apiKey: string,
    private model = "gpt-image-2",
    private projectionMode: ImageProjectionMode = "projective",
  ) {}

  async edit({ dp, context, photos, prompt, previous }: Parameters<ImageEditor["edit"]>[0]): Promise<GeneratedAsset> {
    if (!photos.length) throw new Error("Image edit requires at least one photo");

    // Never fail just because the first ranked photograph has no complete
    // projection. Try every supplied project photograph and use the first one
    // that can actually host all requested module islands.
    const candidate = projectedPolygons(photos, context, this.projectionMode);
    if (!candidate) {
      throw new Error(`No supplied PNG photograph has a complete ${context.exactPanelCount}-module projection.`);
    }
    const base = candidate.photo;
    const panelPolygons = candidate.polygons;

    const data = new FormData();
    data.set("model", this.model);
    data.set("prompt", prompt);
    data.set("quality", "high");

    // The editable base MUST be first for the mask. Append the other photographs
    // only as references, without duplicating the base several times.
    data.append("image[]", base64ToBlob(base.base64, base.mimeType), base.filename ?? "editable-base.png");
    for (const photo of photos.filter((photo) => photo !== base).slice(0, 2)) {
      data.append("image[]", base64ToBlob(photo.base64, photo.mimeType), photo.filename ?? `reference-${photo.role}.${photo.mimeType.split("/")[1]}`);
    }

    const mask = buildPanelIslandsMaskForPng(base.base64, panelPolygons);
    if (!mask) throw new Error("Unable to build GPT Image panel-island mask.");
    data.set("mask", base64ToBlob(mask, "image/png"), "panel-islands-mask.png");

    if (previous?.base64) {
      data.append("image[]", base64ToBlob(previous.base64, previous.mimeType), "previous-attempt.png");
    }

    console.log(
      `[PilotPaper][OpenAI] DP${dp} image edit start; base=${base.role}; panels=${panelPolygons.length}; projection=${this.projectionMode}`,
    );
    const startedAt = Date.now();
    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: data,
      signal: AbortSignal.timeout(240_000),
    });
    console.log(`[PilotPaper][OpenAI] DP${dp} image edit HTTP ${res.status} after ${Date.now() - startedAt}ms`);

    if (!res.ok) throw new Error(`OpenAI image edit error ${res.status}: ${await res.text()}`);
    const json = await res.json() as { data?: Array<{ b64_json?: string }> };
    const openAiCandidate = json.data?.[0]?.b64_json;
    if (!openAiCandidate) throw new Error("OpenAI image edit returned no b64_json");

    const base64 = strictCompositePng(base.base64, openAiCandidate, panelPolygons);
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
