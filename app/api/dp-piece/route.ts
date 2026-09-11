import { generateDpPiece, type DpPieceInput } from "@/lib/dp-piece-engine";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = await request.json() as DpPieceInput;
    const result = await generateDpPiece(input);
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-PilotPaper-Mode": "test_unverified",
        "X-PilotPaper-Piece": `DP${result.dp}`,
      },
    });
  } catch (error) {
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
