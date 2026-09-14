import { generateDpPiece } from "@/lib/dp-piece-engine";
import { generatePreventiveDp } from "@/lib/pilotpaper-vision-engine";
import type { DpPieceInput, DpPieceOutput } from "@/lib/pilotpaper-image2-types";

export const dynamic = "force-dynamic";

async function generatePiece(input: DpPieceInput): Promise<DpPieceOutput> {
  if (input.dp >= 1 && input.dp <= 6) {
    return generatePreventiveDp(input as DpPieceInput & { dp: 1 | 2 | 3 | 4 | 5 | 6 });
  }
  if (input.dp === 7 || input.dp === 8) return generateDpPiece(input);
  throw new Error(`Numéro de pièce DP non pris en charge : ${String(input.dp)}.`);
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as DpPieceInput;
    const result = await generatePiece(input);
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-PilotPaper-Mode": "test_unverified",
        "X-PilotPaper-Piece": `DP${result.dp}`,
        "X-PilotPaper-Visual-Path": result.dp <= 6 ? "pilotpaper-vision-preventive" : "original-photo",
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
