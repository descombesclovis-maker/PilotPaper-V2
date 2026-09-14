import { getDpPieceContract } from "@/lib/dp-piece-contract";
import type { DPNumber, DpPieceInput, DpPieceOutput, PiecePhotoInput } from "@/lib/pilotpaper-image2-types";

export type { DPNumber, DpPieceInput, DpPieceOutput, PiecePhotoInput } from "@/lib/pilotpaper-image2-types";

function requireOriginalPhoto(input: DpPieceInput, role: PiecePhotoInput["role"], label: string) {
  const photo = input.photos?.find((candidate) => candidate.role === role);
  if (!photo?.base64 || photo.base64.length < 1000) throw new Error(label);
  return photo;
}

/**
 * DP7 and DP8 are evidence photographs. They are never sent to an image model.
 * DP1-DP6 are handled by pilotpaper-image2-engine.ts.
 */
export async function generateDpPiece(input: DpPieceInput): Promise<DpPieceOutput> {
  if (input.dp !== 7 && input.dp !== 8) {
    throw new Error(`DP${input.dp} doit passer par le moteur direct ChatGPT Image-2.`);
  }
  const contract = getDpPieceContract(input.dp);
  if (!contract) throw new Error(`Contrat DP${input.dp} introuvable.`);
  const photo = input.dp === 7
    ? requireOriginalPhoto(input, "near", "DP7 : ajoutez la photographie réelle de l'environnement proche.")
    : requireOriginalPhoto(input, "far", "DP8 : ajoutez la photographie réelle du paysage lointain.");

  return {
    dp: input.dp as DPNumber,
    title: contract.title,
    validationStatus: "test_unverified",
    mimeType: photo.mimeType,
    base64: photo.base64,
    sourceSummary: [
      `DP${input.dp} : photographie originale conservée sans génération`,
      photo.filename ? `Fichier source : ${photo.filename}` : "Photo source fournie par l'utilisateur",
    ],
    inspector: {
      passed: true,
      score: 1,
      checks: ["Photo originale conservée : oui", "Aucune retouche générative : oui"],
      issues: [],
    },
  };
}
