import { generateDp1Piece } from "@/lib/dp1-engine";
import { decodeRoofFaceSelectionToken } from "@/lib/dp-ai-engine/site-model/googleSolarFaceSelection";
import { generateDirectChatGptDp } from "@/lib/dp-direct-chatgpt-image-engine";
import { generateDpPiece, type DpPieceInput, type DpPieceOutput } from "@/lib/dp-piece-engine";
import { normalizeServerPhotos, type ServerPhotoInput } from "@/lib/site-twin-v2/serverPhotoNormalizer";

export const dynamic = "force-dynamic";

type PhysicalDpPieceInput = DpPieceInput & {
  roofSegmentIndex?: number;
  roofBuildingId?: string;
  roofFaceStableKey?: string;
};

function normalizeRoofSelection(raw: DpPieceInput): PhysicalDpPieceInput {
  const token = decodeRoofFaceSelectionToken(raw.roofFace);
  if (!token) return raw;

  const keepTokenAsRoofFace = raw.dp === 2 || raw.dp === 3;
  return {
    ...raw,
    roofFace: keepTokenAsRoofFace ? raw.roofFace : token.displayFaceId,
    roofSegmentIndex: token.originalSegmentIndex,
    roofBuildingId: token.buildingId,
    roofFaceStableKey: `${token.buildingId}:${token.originalSegmentIndex}`,
  };
}

async function normalizeEvidence(raw: DpPieceInput): Promise<DpPieceInput> {
  const normalized = await normalizeServerPhotos(raw.photos as ServerPhotoInput[] | undefined);
  if (!normalized.length) return raw;
  return {
    ...raw,
    photos: normalized.map((photo) => ({
      role: photo.role,
      mimeType: photo.mimeType,
      base64: photo.base64,
      filename: photo.filename,
    })),
  };
}

function hideInternalRoofToken(result: DpPieceOutput, rawRoofFace: string | undefined) {
  const token = decodeRoofFaceSelectionToken(rawRoofFace);
  if (!token || !rawRoofFace) return result;
  const visible = token.displayFaceId;
  const clean = (value: string) => value.split(rawRoofFace).join(visible).split(rawRoofFace.toUpperCase()).join(visible);
  return {
    ...result,
    text: result.text ? clean(result.text) : result.text,
    sourceSummary: result.sourceSummary.map(clean),
    inspector: {
      ...result.inspector,
      checks: result.inspector.checks.map(clean),
      issues: result.inspector.issues.map(clean),
    },
  };
}

async function generatePiece(input: PhysicalDpPieceInput): Promise<DpPieceOutput> {
  switch (input.dp) {
    case 1:
      return generateDp1Piece(input);
    case 2:
      return generateDirectChatGptDp({ ...input, dp: 2 });
    case 3:
      return generateDirectChatGptDp({ ...input, dp: 3 });
    case 4:
      return generateDirectChatGptDp({ ...input, dp: 4 });
    case 5:
      return generateDirectChatGptDp({ ...input, dp: 5 });
    case 6:
      return generateDirectChatGptDp({ ...input, dp: 6 });
    case 7:
    case 8:
      return generateDpPiece(input);
    default:
      throw new Error(`Numéro de pièce DP non pris en charge : ${String((input as { dp?: unknown }).dp)}.`);
  }
}

export async function POST(request: Request) {
  try {
    const rawInput = await request.json() as DpPieceInput;
    // Every user image is decoded, EXIF-corrected and re-encoded before any AI
    // call. This removes malformed JPEG/WebP containers from the image path.
    const evidenceSafeInput = await normalizeEvidence(rawInput);
    const input = normalizeRoofSelection(evidenceSafeInput);
    const generated = await generatePiece(input);
    const result = hideInternalRoofToken(generated, rawInput.roofFace);
    const directImagePath = input.dp >= 2 && input.dp <= 6;

    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-PilotPaper-Mode": "test_unverified",
        "X-PilotPaper-Piece": `DP${result.dp}`,
        "X-PilotPaper-Image-Path": directImagePath ? "chatgpt-direct" : "default",
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
