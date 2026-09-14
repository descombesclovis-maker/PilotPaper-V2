import type { DPNumber } from "@/lib/pilotpaper-image2-types";

export type DpPieceField =
  | "address"
  | "moduleReference"
  | "panelCount"
  | "rows"
  | "columns"
  | "orientation"
  | "placement"
  | "instructions"
  | "roofWidthMm"
  | "roofSlopeLengthMm"
  | "roofSlopeDeg"
  | "gutterClearanceMm"
  | "interPanelGapMm"
  | "nearPhoto"
  | "roofPhoto"
  | "farPhoto";

export type DpPieceContract = {
  dp: DPNumber;
  title: string;
  shortTitle: string;
  purpose: string;
  fields: DpPieceField[];
  generatedByImage2: boolean;
  preservesOriginalPhoto: boolean;
  usesInspector: boolean;
};

const commonPvFields: DpPieceField[] = [
  "address",
  "moduleReference",
  "panelCount",
  "rows",
  "columns",
  "orientation",
  "placement",
  "gutterClearanceMm",
  "interPanelGapMm",
  "instructions",
];

export const DP_PIECE_CONTRACTS: readonly DpPieceContract[] = [
  {
    dp: 1,
    title: "Plan de situation du terrain",
    shortTitle: "Situation",
    purpose: "Vue aérienne/cadastrale officielle : la parcelle concernée est mise en évidence en bleu nuit, les autres parcelles restent en gris et leurs numéros sont préservés.",
    fields: ["address"],
    generatedByImage2: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
  },
  {
    dp: 2,
    title: "Plan de masse — implantation photovoltaïque",
    shortTitle: "Masse",
    purpose: "Vue aérienne rapprochée réelle dans laquelle ChatGPT Image place librement mais exactement le champ photovoltaïque. Cette implantation devient la référence visuelle commune aux DP3 à DP6.",
    fields: commonPvFields,
    generatedByImage2: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
  },
  {
    dp: 3,
    title: "Plan en coupe de la construction",
    shortTitle: "Coupe",
    purpose: "ChatGPT Image transforme la photo réelle en plan architectural de coupe professionnel, fidèle au volume de la maison et utilisant uniquement les vraies cotes connues.",
    fields: [...commonPvFields, "nearPhoto", "roofWidthMm", "roofSlopeLengthMm", "roofSlopeDeg"],
    generatedByImage2: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
  },
  {
    dp: 4,
    title: "État initial / état projeté",
    shortTitle: "Avant / après",
    purpose: "ChatGPT Image crée une planche avant/après à partir de la vraie maison et insère le même champ photovoltaïque que sur la DP2.",
    fields: [...commonPvFields, "nearPhoto"],
    generatedByImage2: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
  },
  {
    dp: 5,
    title: "Aspect extérieur rapproché",
    shortTitle: "Vue rapprochée",
    purpose: "ChatGPT Image invente une vue réaliste plus haute et plus rapprochée de la même maison afin de montrer les panneaux plus frontalement, sans changer leur emplacement physique.",
    fields: [...commonPvFields, "roofPhoto"],
    generatedByImage2: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
  },
  {
    dp: 6,
    title: "Insertion du projet dans son environnement",
    shortTitle: "Insertion lointaine",
    purpose: "À partir d'une vraie photo lointaine, ChatGPT Image insère le même champ photovoltaïque de manière photoréaliste et cohérente avec les DP2 à DP5.",
    fields: [...commonPvFields, "farPhoto"],
    generatedByImage2: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
  },
  {
    dp: 7,
    title: "Photographie de l'environnement proche",
    shortTitle: "Vue proche",
    purpose: "La photo réelle proche est conservée telle quelle. Aucune génération ni retouche.",
    fields: ["address", "nearPhoto"],
    generatedByImage2: false,
    preservesOriginalPhoto: true,
    usesInspector: false,
  },
  {
    dp: 8,
    title: "Photographie du paysage lointain",
    shortTitle: "Vue lointaine",
    purpose: "La photo réelle lointaine est conservée telle quelle. Aucune génération ni retouche.",
    fields: ["address", "farPhoto"],
    generatedByImage2: false,
    preservesOriginalPhoto: true,
    usesInspector: false,
  },
] as const;

export function getDpPieceContract(dp: number) {
  return DP_PIECE_CONTRACTS.find((piece) => piece.dp === dp);
}
