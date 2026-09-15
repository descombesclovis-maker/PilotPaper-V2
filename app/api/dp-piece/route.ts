import { generateDpPiece } from "@/lib/dp-piece-engine";
import { generateOfficialDp1 } from "@/lib/pilotpaper-dp1-generator";
import { generateSpecializedDp4 } from "@/lib/pilotpaper-dp4-generator";
import { generatePreventiveDp } from "@/lib/pilotpaper-vision-engine";
import { pilotPaperRunVisualJob } from "@/lib/pilotpaper-openai-resilience";
import { generateDiagnosticFallback } from "@/lib/pilotpaper-diagnostic-fallback";
import { generateDeterministicSiteTwinPiece } from "@/lib/site-twin-v2/dpPieceBridge";
import type { DpPieceInput, DpPieceOutput } from "@/lib/pilotpaper-image2-types";

export const dynamic = "force-dynamic";

async function generateVisualPiece(input: DpPieceInput): Promise<DpPieceOutput> {
  if (input.dp === 3) {
    // DP3 is geometry, not creative imagery. It is generated directly from the
    // canonical Site Twin so slope, ridge, section axis and dimensions cannot
    // drift between attempts or be invented by an image model.
    return generateDeterministicSiteTwinPiece(input as DpPieceInput & { dp: 3 });
  }
  if (input.dp === 4) return generateSpecializedDp4(input as DpPieceInput & { dp: 4 });
  if (input.dp >= 2 && input.dp <= 6) {
    return generatePreventiveDp(input as DpPieceInput & { dp: 2 | 4 | 5 | 6 });
  }
  throw new Error(`Pièce visuelle DP non prise en charge : ${String(input.dp)}.`);
}

async function generatePiece(input: DpPieceInput): Promise<DpPieceOutput> {
  if (input.dp === 1) return generateOfficialDp1(input as DpPieceInput & { dp: 1 });
  if (input.dp >= 2 && input.dp <= 6) {
    try {
      return await pilotPaperRunVisualJob(`DP${input.dp}`, () => generateVisualPiece(input));
    } catch (error) {
      // TEST / NON VALIDÉ: failed candidates remain visible as diagnostics,
      // but never count as a validated planning piece.
      if (input.testMode !== false) return generateDiagnosticFallback(input, error);
      throw error;
    }
  }
  if (input.dp === 7 || input.dp === 8) return generateDpPiece(input);
  throw new Error(`Numéro de pièce DP non pris en charge : ${String(input.dp)}.`);
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as DpPieceInput;
    const result = await generatePiece(input);
    const diagnostic = result.inspector.passed === false && result.sourceSummary.some((line) => /MODE DIAGNOSTIC/i.test(line));
    const visualPath = diagnostic
      ? "pilotpaper-diagnostic-fallback"
      : result.dp === 1
        ? "official-cadastre-deterministic"
        : result.dp === 3
          ? "site-twin-vector-section"
          : result.dp === 4
            ? "pilotpaper-dp4-specialized"
            : result.dp <= 6
              ? "pilotpaper-vision-preventive"
              : "original-photo";
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-PilotPaper-Mode": "test_unverified",
        "X-PilotPaper-Piece": `DP${result.dp}`,
        "X-PilotPaper-Visual-Path": visualPath,
        "X-PilotPaper-Diagnostic": diagnostic ? "1" : "0",
      },
    });
  } catch (error) {
    console.error("[PilotPaper Vision] generation failed", error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "La génération a échoué.",
        validationStatus: "test_unverified",
      },
      { status: 400, headers: { "Cache-Control": "no-store", "X-PilotPaper-Mode": "test_unverified" } },
    );
  }
}
