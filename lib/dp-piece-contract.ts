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
 * Canonical PilotPaper DP contracts.
 *
 * Principle: ask the user only for evidence that the requested piece actually
 * needs. Shared project facts (address + PV configuration) are persisted by the
 * workbench, but each DP has its own mission and its own visual evidence.
 */
export const DP_PIECE_CONTRACTS: readonly DpPieceContract[] = [
  {
    dp: 1,
    title: "Plan de situation du terrain",
    shortTitle: "Situation",
    purpose: "Localiser sans ambiguïté le terrain dans la commune. PilotPaper utilise l'orthophoto/cadastre officiels et la zone de toiture choisie pour identifier visuellement la bonne maison ; le projet PV apparaît dans un repère aérien lisible.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "roofFace"],
    output: "image",
    usesSiteTwin: true,
    usesLayout: false,
    usesCameraRegistration: false,
    allowsGenerativeRefinement: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
    officialRule: "DP1 — plan de situation du terrain. Cette pièce est obligatoire dans tous les dossiers et doit permettre de localiser précisément le terrain dans la commune.",
  },
  {
    dp: 2,
    title: "Plan de masse des constructions à modifier",
    shortTitle: "Masse",
    purpose: "Montrer la vraie parcelle, le vrai bâtiment et l'implantation photovoltaïque vus du dessus. Le pan est choisi uniquement sur la vue satellite/cadastrale et les modules sont rendus avec un contour blanc très visible.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "roofFace"],
    output: "image",
    usesSiteTwin: true,
    usesLayout: true,
    usesCameraRegistration: false,
    allowsGenerativeRefinement: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
    officialRule: "DP2 — plan de masse des constructions à édifier ou à modifier lorsqu'il est requis ; PilotPaper peut aussi le produire comme pièce explicative du projet photovoltaïque.",
  },
  {
    dp: 3,
    title: "Plan en coupe du terrain et de la construction",
    shortTitle: "Coupe",
    purpose: "À partir d'une seule photo lisible de la maison, ChatGPT Image reconstruit une coupe architecturale fidèle à sa forme et représente l'installation. Seules les dimensions photovoltaïques calculables depuis le module et la matrice peuvent être cotées automatiquement ; aucune cote de bâtiment ne peut être inventée.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "nearPhoto"],
    output: "image",
    usesSiteTwin: false,
    usesLayout: false,
    usesCameraRegistration: false,
    allowsGenerativeRefinement: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
    officialRule: "DP3 — plan en coupe du terrain et de la construction lorsqu'il est requis. Il doit permettre de comprendre le profil du terrain et le volume extérieur de la construction sans fabriquer de cotes absentes des preuves.",
  },
  {
    dp: 4,
    title: "Plans des façades et des toitures — état initial et projeté",
    shortTitle: "Façades / toitures",
    purpose: "À partir d'une photo de la façade/toiture concernée, ChatGPT Image produit une planche architecturale avant/après distincte : état initial fidèle puis état projeté avec les panneaux. Si la photo ne permet pas de comprendre une façade nécessaire, PilotPaper doit demander une vue complémentaire plutôt que l'inventer.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "nearPhoto"],
    output: "image",
    usesSiteTwin: false,
    usesLayout: false,
    usesCameraRegistration: false,
    allowsGenerativeRefinement: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
    officialRule: "DP4 — plans des façades et des toitures. Lorsque le projet modifie l'aspect extérieur, faire apparaître l'état initial et l'état futur des éléments concernés.",
  },
  {
    dp: 5,
    title: "Représentation de l'aspect extérieur de la construction",
    shortTitle: "Aspect extérieur",
    purpose: "À partir d'une photo rapprochée de la façade et du pan concernés, ChatGPT Image réalise le photomontage final fidèle : même maison, même cadrage, même toiture, seuls les panneaux sont ajoutés selon la configuration.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "nearPhoto"],
    output: "image",
    usesSiteTwin: false,
    usesLayout: false,
    usesCameraRegistration: false,
    allowsGenerativeRefinement: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
    officialRule: "DP5 — représentation de l'aspect extérieur lorsque DP4 ne suffit pas à montrer les modifications projetées.",
  },
  {
    dp: 6,
    title: "Document graphique d'insertion du projet dans son environnement",
    shortTitle: "Insertion",
    purpose: "À partir d'une photo contextualisée montrant la maison et son environnement, ChatGPT Image réalise une insertion photoréaliste du projet en conservant strictement le bâtiment, les voisins, le paysage et la perspective.",
    fields: ["address", "moduleReference", "panelCount", "rows", "columns", "orientation", "placement", "farPhoto"],
    output: "image",
    usesSiteTwin: false,
    usesLayout: false,
    usesCameraRegistration: false,
    allowsGenerativeRefinement: true,
    preservesOriginalPhoto: false,
    usesInspector: true,
    officialRule: "DP6 — document graphique permettant d'apprécier l'insertion du projet par rapport aux constructions avoisinantes et aux paysages lorsqu'il est requis.",
  },
  {
    dp: 7,
    title: "Photographie de l'environnement proche",
    shortTitle: "Vue proche",
    purpose: "Joindre la photographie réelle de l'environnement proche. PilotPaper la normalise techniquement mais ne génère, ne retouche et ne déplace aucun élément.",
    fields: ["address", "nearPhoto"],
    output: "svg",
    usesSiteTwin: false,
    usesLayout: false,
    usesCameraRegistration: false,
    allowsGenerativeRefinement: false,
    preservesOriginalPhoto: true,
    usesInspector: true,
    officialRule: "DP7 — photographie permettant de situer le terrain dans l'environnement proche lorsque cette pièce est requise.",
  },
  {
    dp: 8,
    title: "Photographie du paysage lointain",
    shortTitle: "Vue lointaine",
    purpose: "Joindre la photographie réelle permettant de situer le terrain dans le paysage lointain et les constructions avoisinantes. Aucune génération visuelle n'est autorisée.",
    fields: ["address", "farPhoto"],
    output: "svg",
    usesSiteTwin: false,
    usesLayout: false,
    usesCameraRegistration: false,
    allowsGenerativeRefinement: false,
    preservesOriginalPhoto: true,
    usesInspector: true,
    officialRule: "DP8 — photographie permettant de situer le terrain dans le paysage lointain lorsque cette pièce est requise.",
  },
] as const;

export function getDpPieceContract(dp: number) {
  return DP_PIECE_CONTRACTS.find((piece) => piece.dp === dp);
}
