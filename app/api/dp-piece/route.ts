import { generateDpPiece } from "@/lib/dp-piece-engine";
import { generateOfficialDp1 } from "@/lib/pilotpaper-dp1-generator";
import { pilotPaperRunVisualJob } from "@/lib/pilotpaper-openai-resilience";
import { decodePng } from "@/lib/dp-ai-engine/utils/pngPixels";
import { generateDeterministicSiteTwinPiece } from "@/lib/site-twin-v2/dpPieceBridge";
import { generateDeterministicDp2 } from "@/lib/site-twin-v2/constrainedDp2";
import { generateGeometryLockedDp4 } from "@/lib/site-twin-v2/constrainedDp4";
import { generateGeometryLockedPhotographicDp } from "@/lib/site-twin-v2/constrainedPhotographicDp";
import type { DpPieceInput, DpPieceOutput } from "@/lib/pilotpaper-image2-types";

export const dynamic = "force-dynamic";

async function generateVisualPiece(input: DpPieceInput): Promise<DpPieceOutput> {
  if (input.dp === 2) return generateDeterministicDp2(input as DpPieceInput & { dp: 2 });
  if (input.dp === 3) return generateDeterministicSiteTwinPiece(input as DpPieceInput & { dp: 3 });
  if (input.dp === 4) return generateGeometryLockedDp4(input as DpPieceInput & { dp: 4 });
  if (input.dp === 5 || input.dp === 6) {
    return generateGeometryLockedPhotographicDp(input as DpPieceInput & { dp: 5 | 6 });
  }
  throw new Error(`Pièce visuelle DP non prise en charge : ${String(input.dp)}.`);
}

function assertPngArtifact(result: DpPieceOutput) {
  const image = decodePng(result.base64 ?? "");
  if (image.width < 320 || image.height < 240) {
    throw new Error(`DP${result.dp} refusée : image trop petite (${image.width}×${image.height}).`);
  }
  let samples = 0;
  let darkest = 255;
  let lightest = 0;
  for (let y = 0; y < image.height; y += 16) {
    for (let x = 0; x < image.width; x += 16) {
      const offset = (y * image.width + x) * 4;
      const luminance = 0.2126 * image.rgba[offset]!
        + 0.7152 * image.rgba[offset + 1]!
        + 0.0722 * image.rgba[offset + 2]!;
      darkest = Math.min(darkest, luminance);
      lightest = Math.max(lightest, luminance);
      samples += 1;
    }
  }
  if (!samples || lightest - darkest < 8) {
    throw new Error(`DP${result.dp} refusée : image visuellement vide ou uniforme.`);
  }
}

function assertSvgArtifact(result: DpPieceOutput) {
  const svg = Buffer.from(result.base64 ?? "", "base64").toString("utf8");
  if (svg.length < 500 || !/<svg\b/i.test(svg) || !/viewBox=/i.test(svg) || !/<\/svg>/i.test(svg)) {
    throw new Error(`DP${result.dp} refusée : SVG incomplet ou illisible.`);
  }
  if (/\b(?:NaN|Infinity|undefined)\b/.test(svg)) {
    throw new Error(`DP${result.dp} refusée : le rendu contient des coordonnées ou valeurs invalides.`);
  }
  if (result.dp === 3) {
    if (!/class="pv-section"/.test(svg) || !/Champ PV coupé/.test(svg)) {
      throw new Error("DP3 refusée : la coupe ne contient aucune représentation photovoltaïque démontrée.");
    }
  }
  if (result.dp === 4) {
    const imageCount = svg.match(/<image\s/g)?.length ?? 0;
    if (imageCount !== 2 || !svg.includes("ÉTAT INITIAL") || !svg.includes("ÉTAT PROJETÉ")) {
      throw new Error("DP4 refusée : composition avant/après incomplète ou incohérente.");
    }
  }
}

function assertGeneratedVisualPiece(result: DpPieceOutput) {
  if (result.dp < 2 || result.dp > 6) return result;
  if (!result.geometryReceipt) {
    throw new Error(`DP${result.dp} refusée : aucune empreinte géométrique vérifiable n'a été produite.`);
  }
  if (result.inspector?.passed !== true) {
    throw new Error(`DP${result.dp} refusée par PilotPaper Inspector : ${result.inspector?.issues?.join(" ") || "contrôle qualité non validé."}`);
  }
  if (!result.base64 || result.base64.length < 500) {
    throw new Error(`DP${result.dp} refusée : rendu vide ou incomplet.`);
  }
  if (result.sourceSummary.some((line) => /MODE DIAGNOSTIC|diagnostic fallback|photo source brute/i.test(line))) {
    throw new Error(`DP${result.dp} refusée : un diagnostic ne peut jamais être présenté comme une pièce générée.`);
  }
  if (result.mimeType === "image/png") assertPngArtifact(result);
  else if (result.mimeType === "image/svg+xml") assertSvgArtifact(result);
  else throw new Error(`DP${result.dp} refusée : format visuel inattendu (${result.mimeType}).`);
  return result;
}

async function generatePiece(input: DpPieceInput): Promise<DpPieceOutput> {
  if (input.dp === 1) return generateOfficialDp1(input as DpPieceInput & { dp: 1 });
  if (input.dp >= 2 && input.dp <= 6) {
    const result = await pilotPaperRunVisualJob(`DP${input.dp}`, () => generateVisualPiece(input));
    return assertGeneratedVisualPiece(result);
  }
  if (input.dp === 7 || input.dp === 8) return generateDpPiece(input);
  throw new Error(`Numéro de pièce DP non pris en charge : ${String(input.dp)}.`);
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as DpPieceInput;
    const result = await generatePiece(input);
    const visualPath = result.dp === 1
      ? "official-cadastre-deterministic"
      : result.dp === 2
        ? "site-twin-georeferenced-plan"
        : result.dp === 3
          ? "site-twin-vector-section"
          : result.dp === 4
            ? "site-twin-before-after-composition"
            : result.dp === 5 || result.dp === 6
              ? "site-twin-masked-photorealistic"
              : "original-photo";
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-PilotPaper-Mode": "test_unverified",
        "X-PilotPaper-Piece": `DP${result.dp}`,
        "X-PilotPaper-Visual-Path": visualPath,
        "X-PilotPaper-Diagnostic": "0",
      },
    });
  } catch (error) {
    console.error("[PilotPaper Vision] generation failed", error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "La génération a échoué.",
        validationStatus: "test_unverified",
      },
      { status: 422, headers: { "Cache-Control": "no-store", "X-PilotPaper-Mode": "test_unverified", "X-PilotPaper-Diagnostic": "0" } },
    );
  }
}
