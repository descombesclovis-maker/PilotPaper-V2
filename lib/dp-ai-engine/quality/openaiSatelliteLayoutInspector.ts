import { configFromEnv } from "../config";
import { openaiJson } from "../providers/openaiJson";
import type { Point2D } from "../types";
import { annotatePngWithPanelPolygons } from "../utils/pngPixels";

export type SatelliteLayoutInspection = {
  status: "passed" | "rejected" | "unavailable";
  confidence: number;
  targetBuildingCoherent: boolean;
  allHighlightedPanelsOnRoof: boolean;
  singleRoofPlane: boolean;
  issues: string[];
};

type JudgePayload = {
  pass: boolean;
  confidence: number;
  targetBuildingCoherent: boolean;
  allHighlightedPanelsOnRoof: boolean;
  singleRoofPlane: boolean;
  issues: string[];
};

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    pass: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    targetBuildingCoherent: { type: "boolean" },
    allHighlightedPanelsOnRoof: { type: "boolean" },
    singleRoofPlane: { type: "boolean" },
    issues: { type: "array", items: { type: "string" }, maxItems: 8 },
  },
  required: [
    "pass",
    "confidence",
    "targetBuildingCoherent",
    "allHighlightedPanelsOnRoof",
    "singleRoofPlane",
    "issues",
  ],
} as const;

/**
 * Independent second opinion only. It may reject an obviously incoherent
 * automatic layout, but it is never allowed to create, move or resize panels.
 */
export async function inspectAutomaticSatelliteLayout(args: {
  satellitePngBase64: string;
  panelPolygonsNormalized: Point2D[][];
  expectedPanelCount: number;
  address: string;
  segmentPitchDeg: number;
  segmentAzimuthDeg: number;
}): Promise<SatelliteLayoutInspection> {
  const config = configFromEnv();
  if (!config.openaiApiKey) {
    return {
      status: "unavailable",
      confidence: 0,
      targetBuildingCoherent: true,
      allHighlightedPanelsOnRoof: true,
      singleRoofPlane: true,
      issues: ["OpenAI visual QA non configuré."],
    };
  }

  try {
    const overlay = annotatePngWithPanelPolygons(args.satellitePngBase64, args.panelPolygonsNormalized);
    const result = await openaiJson<JudgePayload>({
      apiKey: config.openaiApiKey,
      model: config.judgeModel,
      schemaName: "pilotpaper_satellite_layout_inspection",
      schema,
      imageDataUrls: [`data:image/png;base64,${overlay}`],
      imageLabels: ["Orthophoto IGN. Les zones bleu foncé correspondent exactement aux modules photovoltaïques proposés par le moteur géométrique."],
      prompt: `Tu es l'inspecteur visuel indépendant de PilotPaper.\n\nProjet : ${args.address}\nNombre attendu de modules : ${args.expectedPanelCount}\nPente du segment fournisseur : ${args.segmentPitchDeg.toFixed(1)}°\nAzimut du segment fournisseur : ${args.segmentAzimuthDeg.toFixed(1)}°\n\nTu ne dois proposer AUCUNE nouvelle géométrie et tu ne dois jamais déplacer les modules. Juge uniquement la cohérence visuelle de la proposition déjà calculée.\n\nVérifie :\n1. les zones bleu foncé semblent toutes être sur une toiture réelle, pas au sol, sur la rue ou dans un jardin ;\n2. elles appartiennent visuellement au même bâtiment cible / ensemble de toiture cohérent ;\n3. elles restent sur un même pan physique cohérent et ne traversent pas clairement un faîtage, une cour ou un bâtiment voisin ;\n4. aucun défaut visuel évident ne contredit la proposition automatique.\n\nNe rejette pas pour une petite incertitude d'image satellite. Rejette seulement une incohérence visuelle claire. Le nombre exact et les dimensions ont déjà été contrôlés mathématiquement.`,
    });

    const confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0));
    const criticalVisualFailure = !result.targetBuildingCoherent || !result.allHighlightedPanelsOnRoof || !result.singleRoofPlane;
    if (confidence >= 0.75 && (!result.pass || criticalVisualFailure)) {
      return { ...result, confidence, status: "rejected" };
    }
    if (result.pass && !criticalVisualFailure && confidence >= 0.65) {
      return { ...result, confidence, status: "passed" };
    }
    return {
      ...result,
      confidence,
      status: "unavailable",
      issues: [...result.issues, "Contrôle visuel OpenAI non conclusif ; la géométrie spécialisée reste la source primaire."],
    };
  } catch (error) {
    return {
      status: "unavailable",
      confidence: 0,
      targetBuildingCoherent: true,
      allHighlightedPanelsOnRoof: true,
      singleRoofPlane: true,
      issues: [`OpenAI visual QA indisponible : ${error instanceof Error ? error.message : "erreur inconnue"}`],
    };
  }
}
