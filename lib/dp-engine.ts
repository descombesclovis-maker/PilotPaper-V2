export type DpStatus =
  | "blocked"
  | "incomplete"
  | "ready-review"
  | "verified"
  | "not-required";

export type DpPiece = {
  id: `DP${number}`;
  title: string;
  status: DpStatus;
  reason: string;
};

export type DpInput = {
  requesterVerified: boolean;
  siteAddress: string;
  supportType: string;
  powerKwp: string;
  moduleCount: string;
  moduleReference: string;
  photos: Record<string, string>;
  finalAttestation: boolean;
};

const has = (value: string) => value.trim().length > 0;

export function evaluateDpPieces(input: DpInput): DpPiece[] {
  const sourceStatus = (kind: string): DpStatus => {
    if (!input.photos[kind]) return "blocked";
    return "ready-review";
  };
  const sourceReason = (kind: string, label: string) => {
    if (!input.photos[kind]) return `${label} indispensable avant contrôle.`;
    if (!input.finalAttestation) return "Source reçue. Le contrôle final reste à attester.";
    return "Source présente ; le moteur doit encore démontrer sa conformité.";
  };
  const generatedStatus = (ready: boolean): DpStatus =>
    !ready ? "blocked" : "ready-review";

  return [
    {
      id: "DP1",
      title: "Plan de situation",
      status: generatedStatus(Boolean(input.photos.satellite)),
      reason: input.photos.satellite ? "Généré depuis l’adresse et la vue satellite." : "Vue satellite indispensable.",
    },
    {
      id: "DP2",
      title: "Plan de masse",
      status: generatedStatus(Boolean(input.photos.satellite_mass)),
      reason: input.photos.satellite_mass ? "Plan de masse calculé depuis la vue IGN rapprochée." : "Vue IGN rapprochée indispensable.",
    },
    {
      id: "DP3",
      title: "Plan en coupe",
      status: generatedStatus(Boolean(input.photos.satellite_mass && input.moduleReference)),
      reason: "Coupe générée depuis la géométrie du projet.",
    },
    {
      id: "DP4",
      title: "Façades et toitures",
      status: generatedStatus(Boolean(input.photos.near)),
      reason: input.photos.near ? "Élévations générées depuis la vue proche." : "Vue proche indispensable.",
    },
    {
      id: "DP5",
      title: "Aspect extérieur",
      status: generatedStatus(has(input.moduleReference)),
      reason: "Aspect généré depuis la référence des modules.",
    },
    {
      id: "DP6",
      title: "Insertion du projet",
      status: generatedStatus(Boolean(input.photos.near && input.photos.satellite_mass)),
      reason: "Insertion produite depuis la photographie proche et le recalage IGN rapproché.",
    },
    {
      id: "DP7",
      title: "Photographie proche",
      status: sourceStatus("near"),
      reason: sourceReason("near", "Photographie réelle de l’environnement proche"),
    },
    {
      id: "DP8",
      title: "Photographie lointaine",
      status: sourceStatus("far"),
      reason: sourceReason("far", "Photographie réelle du paysage lointain"),
    },
  ];
}

export function calculateCompletion(input: DpInput) {
  const checks = [
    input.requesterVerified,
    has(input.siteAddress),
    has(input.supportType),
    has(input.powerKwp),
    has(input.moduleCount),
    has(input.moduleReference),
    Boolean(input.photos.satellite),
    Boolean(input.photos.satellite_mass),
    Boolean(input.photos.near),
    Boolean(input.photos.far),
    input.finalAttestation,
  ];

  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
