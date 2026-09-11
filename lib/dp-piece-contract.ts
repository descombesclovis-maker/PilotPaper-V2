import type { DPNumber } from "@/lib/dp-ai-engine/types";

export type DpPieceField =
  | "address"
  | "parcelReference"
  | "moduleReference"
  | "panelCount"
  | "rows"
  | "columns"
  | "orientation"
  | "placement"
  | "roofFace"
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
  output: "svg" | "image";
  usesRoofUnderstanding: boolean;
  usesLayout: boolean;
  usesProjection: boolean;
  usesPhotorealisticRender: boolean;
  usesInspector: boolean;
};

export const DP_PIECE_CONTRACTS: readonly DpPieceContract[] = [
  {
    dp: 1,
    title: "Plan de situation",
    shortTitle: "Situation",
    purpose: "Localiser précisément le terrain à partir des sources officielles IGN et cadastrales.",
    fields: ["address"],
    output: "svg",
    usesRoofUnderstanding: false,
    usesLayout: false,
    usesProjection: false,
    usesPhotorealisticRender: false,
    usesInspector: true,
  },
  {
    dp: 2,
    title: "Plan de masse",
    shortTitle: "Masse",
    purpose: "Montrer la parcelle, le bâtiment et l'implantation du champ photovoltaïque en vue aérienne.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "roofFace", "gutterClearanceMm", "interPanelGapMm", "roofPhoto"],
    output: "svg",
    usesRoofUnderstanding: true,
    usesLayout: true,
    usesProjection: true,
    usesPhotorealisticRender: false,
    usesInspector: true,
  },
  {
    dp: 3,
    title: "Plan en coupe",
    shortTitle: "Coupe",
    purpose: "Décrire la coupe du rampant et la position réelle des modules sans inventer de cote.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "roofSlopeDeg", "roofSlopeLengthMm", "gutterClearanceMm", "interPanelGapMm"],
    output: "svg",
    usesRoofUnderstanding: false,
    usesLayout: true,
    usesProjection: false,
    usesPhotorealisticRender: false,
    usesInspector: true,
  },
  {
    dp: 4,
    title: "Façades et toitures — état projeté",
    shortTitle: "Façades",
    purpose: "Produire l'état projeté en conservant le bâtiment et en imposant la géométrie photovoltaïque calculée.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "roofFace", "gutterClearanceMm", "interPanelGapMm", "nearPhoto", "roofPhoto"],
    output: "image",
    usesRoofUnderstanding: true,
    usesLayout: true,
    usesProjection: true,
    usesPhotorealisticRender: true,
    usesInspector: true,
  },
  {
    dp: 5,
    title: "Plan des toitures",
    shortTitle: "Toiture",
    purpose: "Dessiner le calepinage déterministe à partir des dimensions réelles du module et de la toiture.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "roofFace", "roofWidthMm", "roofSlopeLengthMm", "gutterClearanceMm", "interPanelGapMm"],
    output: "svg",
    usesRoofUnderstanding: false,
    usesLayout: true,
    usesProjection: false,
    usesPhotorealisticRender: false,
    usesInspector: true,
  },
  {
    dp: 6,
    title: "Insertion paysagère",
    shortTitle: "Insertion",
    purpose: "Insérer photoréalistement les modules dans la photographie en respectant la perspective et le masque géométrique.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "roofFace", "gutterClearanceMm", "interPanelGapMm", "nearPhoto", "roofPhoto", "farPhoto"],
    output: "image",
    usesRoofUnderstanding: true,
    usesLayout: true,
    usesProjection: true,
    usesPhotorealisticRender: true,
    usesInspector: true,
  },
  {
    dp: 7,
    title: "Photographie de l'environnement proche",
    shortTitle: "Vue proche",
    purpose: "Présenter une photographie réelle du site dans son environnement proche sans modification générative.",
    fields: ["address", "nearPhoto"],
    output: "svg",
    usesRoofUnderstanding: false,
    usesLayout: false,
    usesProjection: false,
    usesPhotorealisticRender: false,
    usesInspector: true,
  },
  {
    dp: 8,
    title: "Photographie du paysage lointain",
    shortTitle: "Vue lointaine",
    purpose: "Présenter une photographie réelle du site dans son paysage lointain sans modification générative.",
    fields: ["address", "farPhoto"],
    output: "svg",
    usesRoofUnderstanding: false,
    usesLayout: false,
    usesProjection: false,
    usesPhotorealisticRender: false,
    usesInspector: true,
  },
] as const;

export function getDpPieceContract(dp: number) {
  return DP_PIECE_CONTRACTS.find((piece) => piece.dp === dp);
}
