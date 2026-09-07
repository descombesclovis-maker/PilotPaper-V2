import type { ImageEditor } from "./interfaces";
import type { GeneratedAsset } from "../types";
import { buildPanelIslandsMaskForPng } from "../utils/maskPng";
import { strictCompositePng } from "../utils/pngPixels";
import { allPanelPolygonsForRole } from "../geometry/panelProjection";

function base64ToBlob(base64: string, mime: string): Blob {
  return new Blob([Buffer.from(base64, "base64")], { type: mime });
}

export class OpenAIImageEditor implements ImageEditor {
  constructor(private apiKey: string, private model = "gpt-image-2") {}
  async edit({ dp, context, photos, prompt, previous }: Parameters<ImageEditor["edit"]>[0]): Promise<GeneratedAsset> {
    if (!photos.length) throw new Error("Image edit requires at least one photo");
    const data = new FormData();
    data.set("model", this.model);
    data.set("prompt", prompt);
    data.set("quality", "high");

    // The first image is ALWAYS the editable base. Other photos are references.
    const base = photos[0]!;
    photos.slice(0, 3).forEach((p, i) => data.append("image[]", base64ToBlob(p.base64, p.mimeType), p.filename ?? `reference-${i}.${p.mimeType.split("/")[1]}`));

    // Production invariant: the host normalizes the editable base to PNG. We require
    // an exact per-module mask; whole-roof fallback is intentionally forbidden.
    if (base.mimeType !== "image/png") throw new Error("Editable project photographs must be normalized to PNG before GPT Image editing.");
    const panelPolygons = allPanelPolygonsForRole(context, base.role);
    if (!panelPolygons || panelPolygons.length !== context.exactPanelCount) throw new Error(`Exact panel projection unavailable for ${base.role}: expected ${context.exactPanelCount} module islands.`);
    const mask = buildPanelIslandsMaskForPng(base.base64, panelPolygons);
    if (!mask) throw new Error("Unable to build exact GPT Image panel-island mask.");
    data.set("mask", base64ToBlob(mask, "image/png"), "exact-panel-islands-mask.png");

    if (previous?.base64) data.append("image[]", base64ToBlob(previous.base64, previous.mimeType), "previous-attempt.png");

    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST", headers: { Authorization: `Bearer ${this.apiKey}` }, body: data
    });
    if (!res.ok) throw new Error(`OpenAI image edit error ${res.status}: ${await res.text()}`);
    const json = await res.json() as { data?: Array<{ b64_json?: string }> };
    const candidate = json.data?.[0]?.b64_json;
    if (!candidate) throw new Error("OpenAI image edit returned no b64_json");
    const base64 = strictCompositePng(base.base64, candidate, panelPolygons);
    return { dp, kind: "image", mimeType: "image/png", base64, generationPrompt: prompt, attempt: (previous?.attempt ?? 0) + 1, sourceRole: base.role };
  }
}
