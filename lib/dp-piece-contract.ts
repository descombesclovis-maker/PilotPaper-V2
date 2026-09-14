import type { DPNumber } from "@/lib/pilotpaper-image2-types";

export type DpPieceField =
  | "address"
  | "moduleReference"
  | "panelCount"
  | "rows"
  | "columns"
  | "orientation"
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
];

export const DP_PIECE_CONTRACTS: readonly DpPieceContract[] = [
  {
    dp: 1,
    title: "Plan de situation du terrain",
    shortTitle: "Situation",
    purpose: "Vue aérienne et cadastrale officielle : la parcelle concernée est mise en évidence en bleu nuit, les autres parcelles restent en gris et les données cartographiques sont préservées.",
    fields: ["address"],
    generatedByImage2: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
  },
  {
    dp: 2,
    title: "Plan de masse — implantation photovoltaïque",
    shortTitle: "Masse",
    purpose: "Vue aérienne rapprochée réelle : PilotPaper conserve le site et ajoute exactement la configuration photovoltaïque demandée. Cette implantation devient la référence commune du dossier.",
    fields: commonPvFields,
    generatedByImage2: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
  },
  {
    dp: 3,
    title: "Plan en coupe de la construction",
    shortTitle: "Coupe",
    purpose: "Plan architectural en coupe latérale, perpendiculaire au faîtage, fidèle au volume visible et sans cote de bâtiment inventée.",
    fields: [...commonPvFields, "nearPhoto"],
    generatedByImage2: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
  },
  {
    dp: 4,
    title: "État initial / état projeté",
    shortTitle: "Avant / après",
    purpose: "Comparaison fidèle de la maison avant et après insertion, sans modification de l'architecture ni des alentours.",
    fields: [...commonPvFields, "nearPhoto"],
    generatedByImage2: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
  },
  {
    dp: 5,
    title: "Aspect extérieur rapproché",
    shortTitle: "Vue rapprochée",
    purpose: "Vue réaliste plus haute et plus rapprochée de la même maison, avec le même champ photovoltaïque et sans invention architecturale.",
    fields: [...commonPvFields, "roofPhoto"],
    generatedByImage2: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
  },
  {
    dp: 6,
    title: "Insertion du projet dans son environnement",
    shortTitle: "Insertion lointaine",
    purpose: "La photo lointaine réelle reste la base : seul le champ photovoltaïque est ajouté sur le pan concerné, sans recomposer la maison ni son environnement.",
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
