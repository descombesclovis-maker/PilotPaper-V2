import { generateDp1Piece } from "@/lib/dp1-engine";
import { Dp2RoofDesignerRequiredError, generateDp2Piece } from "@/lib/dp2-v1-engine";
import { generateDp3Piece } from "@/lib/dp3-architectural-section-engine";
import { decodeRoofFaceSelectionToken } from "@/lib/dp-ai-engine/site-model/googleSolarFaceSelection";
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

  // Transitional compatibility only. Site Twin renderers will eventually use
  // canonical physical face ids directly and this token layer can disappear.
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

export async function POST(request: Request) {
  try {
    const rawInput = await request.json() as DpPieceInput;
    // Every user image is decoded, EXIF-corrected and re-encoded as a known-valid
    // JPEG before it can reach OpenAI, LightGlue or any DP renderer.
    const evidenceSafeInput = await normalizeEvidence(rawInput);
    const input = normalizeRoofSelection(evidenceSafeInput);
    const generated = input.dp === 1
      ? await generateDp1Piece(input)
      : input.dp === 2
        ? await generateDp2Piece(input)
        : input.dp === 3
          ? await generateDp3Piece(input)
          : await generateDpPiece(input);
    const result = hideInternalRoofToken(generated, rawInput.roofFace);

    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-PilotPaper-Mode": "test_unverified",
        "X-PilotPaper-Piece": `DP${result.dp}`,
      },
    });
  } catch (error) {
    if (error instanceof Dp2RoofDesignerRequiredError) {
      return Response.json(
        {
          error: error.message,
          validationStatus: "test_unverified",
          recovery: {
            type: "roof_designer",
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
            "X-PilotPaper-Recovery": "roof_designer",
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
