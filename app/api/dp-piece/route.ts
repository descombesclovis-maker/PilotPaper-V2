import { decodeRoofFaceSelectionToken } from "@/lib/dp-ai-engine/site-model/googleSolarFaceSelection";
import { generateDirectChatGptDp } from "@/lib/dp-direct-chatgpt-image-engine";
import { generateDpPiece, type DpPieceInput, type DpPieceOutput } from "@/lib/dp-piece-engine";
import { normalizeServerPhotos, type ServerPhotoInput } from "@/lib/site-twin-v2/serverPhotoNormalizer";

export const dynamic = "force-dynamic";

const ROOF_FACE_SEPARATOR = ";;";

type PhysicalDpPieceInput = DpPieceInput & {
  roofSegmentIndex?: number;
  roofBuildingId?: string;
  roofFaceStableKey?: string;
};

function rawRoofSelections(value: unknown) {
  return String(value ?? "")
    .split(ROOF_FACE_SEPARATOR)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRoofSelection(raw: DpPieceInput): PhysicalDpPieceInput {
  const selections = rawRoofSelections(raw.roofFace);
  const decoded = selections
    .map((selection) => ({ selection, token: decodeRoofFaceSelectionToken(selection) }))
    .filter((entry): entry is { selection: string; token: NonNullable<ReturnType<typeof decodeRoofFaceSelectionToken>> } => Boolean(entry.token));

  if (!decoded.length) return raw;

  const first = decoded[0]!.token;
  return {
    ...raw,
    roofFace: decoded.map((entry) => entry.token.displayFaceId).join(", "),
    roofSegmentIndex: first.originalSegmentIndex,
    roofBuildingId: first.buildingId,
    roofFaceStableKey: decoded
      .map((entry) => `${entry.token.buildingId}:${entry.token.originalSegmentIndex}`)
      .join(";"),
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
  const decoded = rawRoofSelections(rawRoofFace)
    .map((selection) => ({ selection, token: decodeRoofFaceSelectionToken(selection) }))
    .filter((entry) => Boolean(entry.token));
  if (!decoded.length) return result;

  const clean = (value: string) => decoded.reduce((current, entry) => {
    const visible = entry.token?.displayFaceId ?? "pan sélectionné";
    return current
      .split(entry.selection).join(visible)
      .split(entry.selection.toUpperCase()).join(visible);
  }, value);

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
      return generateDirectChatGptDp({ ...input, dp: 1 });
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
    const evidenceSafeInput = await normalizeEvidence(rawInput);
    const input = normalizeRoofSelection(evidenceSafeInput);
    const generated = await generatePiece(input);
    const result = hideInternalRoofToken(generated, rawInput.roofFace);
    const directImagePath = input.dp >= 1 && input.dp <= 6;

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
