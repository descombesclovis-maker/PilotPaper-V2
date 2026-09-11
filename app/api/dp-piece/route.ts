import { generateDp1Piece } from "@/lib/dp1-engine";
import { Dp2AssistedRecoveryRequiredError, generateDp2Piece } from "@/lib/dp2-v1-engine";
import { generateDpPiece, type DpPieceInput } from "@/lib/dp-piece-engine";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = await request.json() as DpPieceInput;
    const result = input.dp === 1
      ? await generateDp1Piece(input)
      : input.dp === 2
        ? await generateDp2Piece(input)
        : await generateDpPiece(input);

    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-PilotPaper-Mode": "test_unverified",
        "X-PilotPaper-Piece": `DP${result.dp}`,
      },
    });
  } catch (error) {
    if (error instanceof Dp2AssistedRecoveryRequiredError) {
      return Response.json(
        {
          error: error.message,
          validationStatus: "test_unverified",
          recovery: {
            type: "roof_quad",
            reason: error.reason,
            imageMimeType: error.imageMimeType,
            imageBase64: error.imageBase64,
            widthPx: error.widthPx,
            heightPx: error.heightPx,
          },
        },
        {
          status: 409,
          headers: {
            "Cache-Control": "no-store",
            "X-PilotPaper-Mode": "test_unverified",
            "X-PilotPaper-Recovery": "roof_quad",
          },
        },
      );
    }
    console.error("[dp-piece] isolated generation failed", error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "La génération isolée a échoué.",
        validationStatus: "test_unverified",
      },
      { status: 400, headers: { "Cache-Control": "no-store", "X-PilotPaper-Mode": "test_unverified" } },
    );
  }
}
