export async function openaiJson<T>(params: {
  apiKey: string;
  model: string;
  prompt: string;
  imageDataUrls: string[];
  imageLabels?: string[];
  schemaName: string;
  schema: Record<string, unknown>;
}): Promise<T> {
  const startedAt = Date.now();
  console.log(`[PilotPaper][OpenAI] ${params.schemaName} start; model=${params.model}; images=${params.imageDataUrls.length}`);

  const imageContent = params.imageDataUrls.flatMap((image_url, index) => {
    const label = params.imageLabels?.[index]?.trim();
    return [
      ...(label ? [{ type: "input_text", text: label }] : []),
      { type: "input_image", image_url, detail: "high" },
    ];
  });

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${params.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: params.model,
      store: false,
      input: [{ role: "user", content: [
        { type: "input_text", text: params.prompt },
        ...imageContent,
      ] }],
      text: { format: { type: "json_schema", name: params.schemaName, strict: true, schema: params.schema } }
    }),
    signal: AbortSignal.timeout(180_000),
  });

  console.log(`[PilotPaper][OpenAI] ${params.schemaName} HTTP ${res.status} after ${Date.now() - startedAt}ms`);
  if (!res.ok) throw new Error(`OpenAI Responses error ${res.status}: ${await res.text()}`);

  const json = await res.json() as { output_text?: string; output?: Array<any> };
  let text = json.output_text;
  if (!text) {
    for (const item of json.output ?? []) for (const c of item.content ?? []) if (c.type === "output_text") text = c.text;
  }
  if (!text) throw new Error("OpenAI returned no structured output text");
  return JSON.parse(text) as T;
}
