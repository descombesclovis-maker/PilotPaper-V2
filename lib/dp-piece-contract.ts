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
  usesSiteTwin: boolean;
  usesLayout: boolean;
  usesCameraRegistration: boolean;
  allowsGenerativeRefinement: boolean;
  preservesOriginalPhoto: boolean;
  usesInspector: true;
  officialRule: string;
};

/**
 * Canonical PilotPaper DP contracts. The old V1 interpretation is intentionally
 * not reused: every DP is rebuilt from the official administrative purpose.
 */
export const DP_PIECE_CONTRACTS: readonly DpPieceContract[] = [
  {
    dp: 1,
    title: "Plan de situation du terrain",
    shortTitle: "Situation",
    purpose: "Localiser précisément le terrain dans la commune et reporter, lorsqu'ils sont connus, les points/angles des prises de vue DP7 et DP8.",
    fields: ["address"],
    output: "svg",
    usesSiteTwin: true,
    usesLayout: false,
    usesCameraRegistration: false,
    allowsGenerativeRefinement: false,
    preservesOriginalPhoto: false,
    usesInspector: true,
    officialRule: "DP1 — plan de situation du terrain ; obligatoire dans tous les dossiers de DP.",
  },
  {
    dp: 2,
    title: "Plan de masse des constructions à modifier",
    shortTitle: "Masse",
    purpose: "Présenter la parcelle, les constructions existantes, l'orientation, les dimensions pertinentes et l'implantation exacte du projet photovoltaïque.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "roofFace", "gutterClearanceMm", "interPanelGapMm"],
    output: "svg",
    usesSiteTwin: true,
    usesLayout: true,
    usesCameraRegistration: false,
    allowsGenerativeRefinement: false,
    preservesOriginalPhoto: false,
    usesInspector: true,
    officialRule: "DP2 — plan de masse lorsque le projet crée une construction ou modifie le volume d'une construction existante ; PilotPaper peut également le produire comme pièce explicative du projet solaire.",
  },
  {
    dp: 3,
    title: "Plan en coupe du terrain et de la construction",
    shortTitle: "Coupe",
    purpose: "Montrer une coupe métrique cohérente avec le Site Twin et le terrain naturel, sans inventer de hauteur.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "roofFace", "gutterClearanceMm", "interPanelGapMm"],
    output: "svg",
    usesSiteTwin: true,
    usesLayout: true,
    usesCameraRegistration: false,
    allowsGenerativeRefinement: false,
    preservesOriginalPhoto: false,
    usesInspector: true,
    officialRule: "DP3 — plan en coupe lorsque le profil du terrain est modifié ; PilotPaper ne doit jamais fabriquer des cotes altimétriques manquantes.",
  },
  {
    dp: 4,
    title: "Plans des façades et des toitures — état initial et projeté",
    shortTitle: "Façades / toitures",
    purpose: "Présenter l'ensemble des façades et la toiture concernée, avec l'état initial et l'état futur lorsque le projet modifie l'aspect extérieur.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "roofFace", "gutterClearanceMm", "interPanelGapMm", "nearPhoto", "roofPhoto"],
    output: "svg",
    usesSiteTwin: true,
    usesLayout: true,
    usesCameraRegistration: true,
    allowsGenerativeRefinement: false,
    preservesOriginalPhoto: true,
    usesInspector: true,
    officialRule: "DP4 — plans de toutes les façades et des toitures ; faire apparaître l'état initial et futur lorsque le projet les modifie.",
  },
  {
    dp: 5,
    title: "Représentation de l'aspect extérieur de la construction",
    shortTitle: "Aspect extérieur",
    purpose: "Montrer précisément l'aspect extérieur final si DP4 ne suffit pas, en projetant le projet sur une vue rapprochée sans modifier le reste du bâtiment.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "roofFace", "gutterClearanceMm", "interPanelGapMm", "roofPhoto", "nearPhoto"],
    output: "image",
    usesSiteTwin: true,
    usesLayout: true,
    usesCameraRegistration: true,
    allowsGenerativeRefinement: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
    officialRule: "DP5 — représentation de l'aspect extérieur uniquement lorsque DP4 ne suffit pas à montrer les modifications projetées.",
  },
  {
    dp: 6,
    title: "Document graphique d'insertion du projet dans son environnement",
    shortTitle: "Insertion",
    purpose: "Montrer le projet depuis une photographie contextualisée, avec perspective calculée et modification limitée aux modules photovoltaïques.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "roofFace", "gutterClearanceMm", "interPanelGapMm", "farPhoto", "nearPhoto", "roofPhoto"],
    output: "image",
    usesSiteTwin: true,
    usesLayout: true,
    usesCameraRegistration: true,
    allowsGenerativeRefinement: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
    officialRule: "DP6 — document graphique permettant d'apprécier l'insertion du projet par rapport aux constructions avoisinantes et aux paysages.",
  },
  {
    dp: 7,
    title: "Photographie de l'environnement proche",
    shortTitle: "Vue proche",
    purpose: "Présenter la photographie réelle et non générée du terrain et de ses abords immédiats.",
    fields: ["address", "nearPhoto"],
    output: "svg",
    usesSiteTwin: true,
    usesLayout: false,
    usesCameraRegistration: false,
    allowsGenerativeRefinement: false,
    preservesOriginalPhoto: true,
    usesInspector: true,
    officialRule: "DP7 — photographie permettant de situer le terrain dans l'environnement proche.",
  },
  {
    dp: 8,
    title: "Photographie du paysage lointain",
    shortTitle: "Vue lointaine",
    purpose: "Présenter la photographie réelle et non générée permettant de comprendre le paysage et les terrains avoisinants.",
    fields: ["address", "farPhoto"],
    output: "svg",
    usesSiteTwin: true,
    usesLayout: false,
    usesCameraRegistration: false,
    allowsGenerativeRefinement: false,
    preservesOriginalPhoto: true,
    usesInspector: true,
    officialRule: "DP8 — photographie permettant de situer le terrain dans le paysage lointain.",
  },
] as const;

export function getDpPieceContract(dp: number) {
  return DP_PIECE_CONTRACTS.find((piece) => piece.dp === dp);
}
