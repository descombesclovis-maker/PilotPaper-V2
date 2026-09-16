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
  if (result.dp === 1) {
    if (!/<image\s/.test(svg) || !/<polygon\s/.test(svg) || !svg.includes("DP1")) {
      throw new Error("DP1 refusée : fond officiel ou contour cadastral absent de la composition.");
    }
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

function jpegDimensions(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1]!;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 4 > bytes.length) break;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if (sofMarkers.has(marker) && length >= 7) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function assertOriginalPhotoArtifact(result: DpPieceOutput) {
  const bytes = Buffer.from(result.base64 ?? "", "base64");
  if (bytes.length < 10_000) throw new Error(`DP${result.dp} refusée : photographie source vide ou trop légère.`);
  if (result.mimeType === "image/jpeg") {
    const dimensions = jpegDimensions(bytes);
    if (!dimensions) throw new Error(`DP${result.dp} refusée : JPEG source corrompu.`);
    if (dimensions.width < 320 || dimensions.height < 240) {
      throw new Error(`DP${result.dp} refusée : photographie source trop petite (${dimensions.width}×${dimensions.height}).`);
    }
    return;
  }
  if (result.mimeType === "image/webp") {
    const signature = bytes.length >= 12
      && bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (!signature) throw new Error(`DP${result.dp} refusée : WebP source corrompu.`);
    return;
  }
  throw new Error(`DP${result.dp} refusée : format photographique inattendu (${result.mimeType}).`);
}

function assertGeneratedVisualPiece(result: DpPieceOutput) {
  if (!result.base64 || result.base64.length < 500) {
    throw new Error(`DP${result.dp} refusée : rendu vide ou incomplet.`);
  }
  if (result.inspector?.passed !== true) {
    throw new Error(`DP${result.dp} refusée par PilotPaper Inspector : ${result.inspector?.issues?.join(" ") || "contrôle qualité non validé."}`);
  }
  if (result.sourceSummary.some((line) => /MODE DIAGNOSTIC|diagnostic fallback|photo source brute/i.test(line))) {
    throw new Error(`DP${result.dp} refusée : un diagnostic ne peut jamais être présenté comme une pièce générée.`);
  }

  if (result.mimeType === "image/png") assertPngArtifact(result);
  else if (result.mimeType === "image/svg+xml") assertSvgArtifact(result);
  else if (result.dp === 7 || result.dp === 8) assertOriginalPhotoArtifact(result);
  else throw new Error(`DP${result.dp} refusée : format visuel inattendu (${result.mimeType}).`);

  if (result.dp >= 2 && result.dp <= 6 && !result.geometryReceipt) {
    throw new Error(`DP${result.dp} refusée : aucune empreinte géométrique vérifiable n'a été produite.`);
  }
  return result;
}

async function generatePiece(input: DpPieceInput): Promise<DpPieceOutput> {
  if (input.dp === 1) return assertGeneratedVisualPiece(await generateOfficialDp1(input as DpPieceInput & { dp: 1 }));
  if (input.dp >= 2 && input.dp <= 6) {
    const result = await pilotPaperRunVisualJob(`DP${input.dp}`, () => generateVisualPiece(input));
    return assertGeneratedVisualPiece(result);
  }
  if (input.dp === 7 || input.dp === 8) return assertGeneratedVisualPiece(await generateDpPiece(input));
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
