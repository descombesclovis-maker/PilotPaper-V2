import type { ImageEditor } from "./interfaces";
import type { GeneratedAsset } from "../types";

export class GeminiImageEditor implements ImageEditor {
  constructor(private apiKey: string, private model = "gemini-3.1-flash-image") {}
  async edit({ dp, photos, prompt, previous }: Parameters<ImageEditor["edit"]>[0]): Promise<GeneratedAsset> {
    const input: any[] = photos.slice(0, 3).map(p => ({ type: "image", mime_type: p.mimeType, data: p.base64 }));
    if (previous?.base64) input.push({ type: "image", mime_type: previous.mimeType, data: previous.base64 });
    input.push({ type: "text", text: prompt });
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input, response_format: { type: "image", mime_type: "image/png", image_size: "2K" } })
    });
    if (!res.ok) throw new Error(`Gemini image edit error ${res.status}: ${await res.text()}`);
    const json = await res.json() as any;
    let base64 = json.output_image?.data as string | undefined;
    if (!base64) {
      for (const step of json.steps ?? []) for (const c of step.content ?? []) if (c.type === "image" && c.data) base64 = c.data;
    }
    if (!base64) throw new Error("Gemini image edit returned no image data");
    return { dp, kind: "image", mimeType: "image/png", base64, generationPrompt: prompt, attempt: (previous?.attempt ?? 0) + 1 };
  }
}
