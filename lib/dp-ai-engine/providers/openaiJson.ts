export async function openaiJson<T>(params: {
  apiKey: string;
  model: string;
  prompt: string;
  imageDataUrls: string[];
  schemaName: string;
  schema: Record<string, unknown>;
}): Promise<T> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${params.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: params.model,
      store: false,
      input: [{ role: "user", content: [
        { type: "input_text", text: params.prompt },
        ...params.imageDataUrls.map(image_url => ({ type: "input_image", image_url, detail: "high" }))
      ] }],
      text: { format: { type: "json_schema", name: params.schemaName, strict: true, schema: params.schema } }
    })
  });
  if (!res.ok) throw new Error(`OpenAI Responses error ${res.status}: ${await res.text()}`);
  const json = await res.json() as { output_text?: string; output?: Array<any> };
  let text = json.output_text;
  if (!text) {
    for (const item of json.output ?? []) for (const c of item.content ?? []) if (c.type === "output_text") text = c.text;
  }
  if (!text) throw new Error("OpenAI returned no structured output text");
  return JSON.parse(text) as T;
}
