import { generateDpPiece } from "@/lib/dp-piece-engine";
import { generateOfficialDp1 } from "@/lib/pilotpaper-dp1-generator";
import { pilotPaperRunVisualJob } from "@/lib/pilotpaper-openai-resilience";
import { generateDiagnosticFallback } from "@/lib/pilotpaper-diagnostic-fallback";
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

async function generatePiece(input: DpPieceInput): Promise<DpPieceOutput> {
  if (input.dp === 1) return generateOfficialDp1(input as DpPieceInput & { dp: 1 });
  if (input.dp >= 2 && input.dp <= 6) {
    try {
      return await pilotPaperRunVisualJob(`DP${input.dp}`, () => generateVisualPiece(input));
    } catch (error) {
      // Diagnostic fallback is deliberately opt-in. Production generation must
      // never disguise a failed Site Twin/layout/projection as a valid-looking
      // raw source photo without photovoltaic modules.
      if (input.testMode === true) return generateDiagnosticFallback(input, error);
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
      { status: 422, headers: { "Cache-Control": "no-store", "X-PilotPaper-Mode": "test_unverified", "X-PilotPaper-Diagnostic": "0" } },
    );
  }
}
