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

/** Canonical PilotPaper DP contracts rebuilt from the administrative purpose. */
export const DP_PIECE_CONTRACTS: readonly DpPieceContract[] = [
  {
    dp: 1,
    title: "Plan de situation du terrain",
    shortTitle: "Situation",
    purpose: "Localiser précisément le terrain dans la commune. La sélection aérienne du toit reste disponible uniquement pour verrouiller visuellement le bâtiment concerné.",
    fields: ["address", "roofFace"],
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
    purpose: "Présenter la vraie parcelle et la vraie construction depuis l'imagerie IGN. Le pan ou la zone de toiture est choisi uniquement ici depuis la vue satellite.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "roofFace", "gutterClearanceMm", "interPanelGapMm"],
    output: "image",
    usesSiteTwin: true,
    usesLayout: true,
    usesCameraRegistration: false,
    allowsGenerativeRefinement: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
    officialRule: "DP2 — plan de masse lorsque le projet crée une construction ou modifie le volume d'une construction existante ; PilotPaper peut également le produire comme pièce explicative du projet solaire.",
  },
  {
    dp: 3,
    title: "Plan en coupe du terrain et de la construction",
    shortTitle: "Coupe",
    purpose: "À partir d'une vraie photo de la maison et de la configuration du formulaire, ChatGPT Image comprend automatiquement le toit et produit la représentation demandée ; un Inspector indépendant contrôle ensuite le résultat.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "gutterClearanceMm", "interPanelGapMm", "nearPhoto"],
    output: "image",
    usesSiteTwin: false,
    usesLayout: false,
    usesCameraRegistration: false,
    allowsGenerativeRefinement: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
    officialRule: "DP3 — plan en coupe lorsque le profil du terrain est modifié ; PilotPaper ne doit jamais fabriquer des cotes altimétriques manquantes.",
  },
  {
    dp: 4,
    title: "Plans des façades et des toitures — état initial et projeté",
    shortTitle: "Façades / toitures",
    purpose: "Une vraie photo de la maison + la configuration du formulaire. ChatGPT Image reconnaît le pan, les Velux, cheminées et limites visibles et réalise directement le projet sans sélection satellite.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "gutterClearanceMm", "interPanelGapMm", "nearPhoto"],
    output: "image",
    usesSiteTwin: false,
    usesLayout: false,
    usesCameraRegistration: false,
    allowsGenerativeRefinement: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
    officialRule: "DP4 — plans de toutes les façades et des toitures ; faire apparaître l'état initial et futur lorsque le projet les modifie.",
  },
  {
    dp: 5,
    title: "Représentation de l'aspect extérieur de la construction",
    shortTitle: "Aspect extérieur",
    purpose: "Une vraie photo de la maison + la configuration du formulaire. ChatGPT Image produit directement l'aspect final en préservant le bâtiment ; l'Inspector accepte ou rejette ensuite le rendu.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "gutterClearanceMm", "interPanelGapMm", "nearPhoto"],
    output: "image",
    usesSiteTwin: false,
    usesLayout: false,
    usesCameraRegistration: false,
    allowsGenerativeRefinement: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
    officialRule: "DP5 — représentation de l'aspect extérieur uniquement lorsque DP4 ne suffit pas à montrer les modifications projetées.",
  },
  {
    dp: 6,
    title: "Document graphique d'insertion du projet dans son environnement",
    shortTitle: "Insertion",
    purpose: "Une vraie photo contextualisée + la configuration du formulaire. ChatGPT Image effectue l'insertion de façon autonome sur le toit visible, sans sélection satellite ; l'Inspector valide ensuite la conformité visuelle.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "gutterClearanceMm", "interPanelGapMm", "farPhoto"],
    output: "image",
    usesSiteTwin: false,
    usesLayout: false,
    usesCameraRegistration: false,
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
    usesSiteTwin: false,
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
    usesSiteTwin: false,
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
