import type { PiecePhotoInput, VisualReference } from "@/lib/pilotpaper-image2-types";

type Dp3SectionFacts = {
  roofForm: string;
  ridgeDirection: string;
  sectionViewpoint: string;
  terrainRelation: string;
  visibleStoreys: string;
  roofPlaneDescription: string;
  visibleObstacles: string[];
  buildingIdentityCues: string[];
  confidence: number;
  warnings: string[];
};

function dataUrl(mimeType: string, base64: string) {
  return `data:${mimeType};base64,${base64}`;
}

export async function analyzeDp3SectionSource(args: {
  apiKey: string;
  judgeModel: string;
  source: PiecePhotoInput;
  references: VisualReference[];
}) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      roofForm: { type: "string" },
      ridgeDirection: { type: "string" },
      sectionViewpoint: { type: "string" },
      terrainRelation: { type: "string" },
      visibleStoreys: { type: "string" },
      roofPlaneDescription: { type: "string" },
      visibleObstacles: { type: "array", items: { type: "string" } },
      buildingIdentityCues: { type: "array", items: { type: "string" } },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: [
      "roofForm",
      "ridgeDirection",
      "sectionViewpoint",
      "terrainRelation",
      "visibleStoreys",
      "roofPlaneDescription",
      "visibleObstacles",
      "buildingIdentityCues",
      "confidence",
      "warnings",
    ],
  };

  const prompt = [
    "You are the pre-analysis stage of PilotPaper DP3.",
    "Analyze the real house photograph so another model can draw a reliable architectural side section and a small 3D axonometric cutaway of the SAME building.",
    "Reason like a building surveyor and photovoltaic installer: identify the roof form, ridge direction, the correct side/gable viewpoint for a section perpendicular to the ridge, terrain relation, visible storeys, roof plane and obstacles.",
    "Do NOT invent measurements. Do NOT estimate numeric building height, roof width, roof pitch or wall dimensions from appearance alone.",
    "Do NOT invent hidden rooms or structural systems. Describe only what is visible or strongly supported by the accepted project references.",
    "The accepted reference images, when present, represent the same project and can be used to preserve building identity and equipped roof plane.",
    "Return concise factual descriptions that can directly guide the renderer.",
  ].join("\n");

  const images = [
    dataUrl(args.source.mimeType, args.source.base64),
    ...args.references.map((reference) => dataUrl(reference.mimeType, reference.base64)),
  ];

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: args.judgeModel,
        store: false,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            ...images.map((image_url) => ({ type: "input_image", image_url, detail: "high" })),
          ],
        }],
        text: { format: { type: "json_schema", name: "pilotpaper_dp3_section_facts", strict: true, schema } },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) return null;
    const json = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    let text = json.output_text;
    if (!text) {
      for (const item of json.output ?? []) {
        for (const part of item.content ?? []) {
          if (part.type === "output_text" && part.text) text = part.text;
        }
      }
    }
    if (!text) return null;
    const facts = JSON.parse(text) as Dp3SectionFacts;
    return [
      "DP3 SOURCE ANALYSIS — NON-NUMERIC, NON-BLOCKING.",
      `Roof form: ${facts.roofForm}`,
      `Observed ridge direction: ${facts.ridgeDirection}`,
      `Recommended section viewpoint: ${facts.sectionViewpoint}`,
      `Terrain relation: ${facts.terrainRelation}`,
      `Visible storeys: ${facts.visibleStoreys}`,
      `Roof plane: ${facts.roofPlaneDescription}`,
      facts.visibleObstacles.length ? `Visible obstacles: ${facts.visibleObstacles.join(", ")}` : "Visible obstacles: none confidently identified.",
      facts.buildingIdentityCues.length ? `Identity cues to preserve: ${facts.buildingIdentityCues.join(", ")}` : "Identity cues: preserve the source building silhouette and roof form.",
      `Analysis confidence: ${Math.round(facts.confidence * 100)}%.`,
      facts.warnings.length ? `Warnings: ${facts.warnings.join(" | ")}` : "Warnings: none.",
      "This analysis never authorizes invented numeric building dimensions.",
    ].join("\n");
  } catch {
    return null;
  }
}
