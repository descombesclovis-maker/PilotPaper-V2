import { PDFDocument, StandardFonts } from "pdf-lib";

export const OFFICIAL_CERFA_FILE = "/forms/cerfa_16702_03.pdf";
export const OFFICIAL_CERFA_VERSION = "16702*03";
export const OFFICIAL_CERFA_SHA256 = "a6fbb8d3797d768e3d4a181babd619c939f67d699b93dfe748304761dffcaea1";

export type CerfaProjectRecord = {
  requesterKind: "company" | "person";
  requesterName: string;
  requesterFirstName: string;
  requesterLastName: string;
  requesterAddress: string;
  requesterEmail: string;
  requesterSiret: string;
  requesterLegalFormCode: string;
  siteAddress: string;
  supportType: string;
  powerKwp: string;
  moduleCount: number;
  moduleReference: string;
  injectionMode: string;
  details: Record<string, string>;
};

type ParsedAddress = { number: string; street: string; postcode: string; city: string };

export function parseFrenchAddress(value: string): ParsedAddress | null {
  const normalized = value.replace(/\s+/g, " ").replace(/,\s*/g, " ").trim();
  const match = normalized.match(/^(?:(\d+[A-Za-z]?)\s+)?(.+?)\s+(\d{5})\s+(.+)$/);
  if (!match) return null;
  return { number: match[1] ?? "", street: match[2].trim(), postcode: match[3], city: match[4].trim() };
}

export function parseParcelId(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = normalized.match(/(\d{3})([A-Z]{1,2})(\d{1,4})$/);
  if (!match) return null;
  return { prefix: match[1], section: match[2], number: match[3].padStart(4, "0") };
}

function splitName(value: string) {
  const parts = value.trim().split(/\s+/);
  return { firstName: parts.shift() ?? "", lastName: parts.join(" ") };
}

function energyDestination(mode: string) {
  return {
    "self-no-export": "Autoconsommation sans injection",
    "self-surplus": "Autoconsommation avec vente du surplus",
    "total-sale": "Vente totale",
    collective: "Autoconsommation collective",
  }[mode] ?? mode;
}

function compactDate(value: string) {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}${iso[2]}${iso[1]}`;
  return value.replace(/\D/g, "").slice(0, 8);
}

export async function fillOfficialCerfa(
  sourceBytes: Uint8Array,
  project: CerfaProjectRecord,
) {
  const pdf = await PDFDocument.load(sourceBytes);
  const appearanceFont = await pdf.embedFont(StandardFonts.Helvetica);
  const form = pdf.getForm();
  const requesterAddress = parseFrenchAddress(project.requesterAddress);
  const siteAddress = parseFrenchAddress(project.siteAddress);
  const parcel = parseParcelId(project.details.cadastralReference ?? "");
  if (!requesterAddress || !siteAddress || !parcel) {
    throw new Error("Le Cerfa officiel ne peut pas être rempli : adresse ou parcelle non structurée.");
  }

  const setText = (name: string, value: string | undefined) => {
    if (value?.trim()) form.getTextField(name).setText(value.trim());
  };
  const check = (name: string) => form.getCheckBox(name).check();
  const inferred = splitName(project.requesterName);
  const firstName = project.requesterFirstName || inferred.firstName;
  const lastName = project.requesterLastName || inferred.lastName;

  if (project.requesterKind === "company") {
    setText("D2D_denomination", project.requesterName);
    setText("D2R_raison", project.requesterName);
    setText("D2S_siret", project.requesterSiret);
    setText("D2J_type", project.requesterLegalFormCode);
    setText("D2N_nom", project.details.representativeLastName);
    setText("D2P_prenom", project.details.representativeFirstName);
  } else {
    setText("D1N_nom", lastName);
    setText("D1P_prenom", firstName);
    setText("D1A_naissance", compactDate(project.details.birthDate ?? ""));
    setText("D1C_commune", project.details.birthCity);
    setText("D1D_dept", project.details.birthDepartment);
    setText("D1E_pays", project.details.birthCountry);
  }

  setText("D3N_numero", requesterAddress.number);
  setText("D3V_voie", requesterAddress.street);
  setText("D3L_localite", requesterAddress.city);
  setText("D3C_code", requesterAddress.postcode);
  setText("D5GE1_email", project.requesterEmail.split("@")[0]);
  setText("D5GE2_email", project.requesterEmail.split("@")[1]);
  check("D5A_acceptation");

  setText("T2Q_numero", siteAddress.number);
  setText("T2V_voie", siteAddress.street);
  setText("T2L_localite", siteAddress.city);
  setText("T2C_code", siteAddress.postcode);
  setText("T2F_prefixe", parcel.prefix);
  setText("T2S_section", parcel.section);
  setText("T2N_numero", parcel.number);
  setText("T2T_superficie", project.details.parcelAreaM2);
  setText("D5T_total", project.details.parcelAreaM2);

  if (["roof", "facade"].includes(project.supportType)) check("C2ZB1_existante");
  else check("C2ZA1_nouvelle");
  const description = project.details.projectDescription ||
    `Installation de ${project.moduleCount} modules photovoltaïques ${project.moduleReference}, puissance ${project.powerKwp} kWc, sur ${project.supportType}.`;
  const descriptionField = form.getTextField("C2ZD1_description");
  descriptionField.enableMultiline();
  descriptionField.acroField.setDefaultAppearance("/Helv 7 Tf 0 g");
  descriptionField.setText(description.trim());
  setText("C2ZA7_autres", "Installation photovoltaïque");
  if (["ground", "carport"].includes(project.supportType)) {
    setText("C2ZP1_crete", project.powerKwp);
    setText("C2ZR1_destination", energyDestination(project.injectionMode));
  }

  const binaryQuestions: Array<[string, string, string]> = [
    ["lawWater", "X1T_eau", "X1T0_eau"],
    ["environmentalAuthorization", "X1E_environnement", "X1E0_environnement"],
    ["protectedSpeciesDerogation", "X1D_derogation", "X1D0_derogation"],
    ["classifiedInstallation", "X1C_classe", "X1C0_classe"],
    ["otherLegislation", "X1L_legislation", "X1L0_legislation"],
    ["heatNetworkConnection", "X1U_raccordement", "X1U0_raccordement"],
    ["articleL1714", "X1V_toiture", "X1V0_toiture"],
  ];
  for (const [key, yesField, noField] of binaryQuestions) {
    const answer = project.details[key];
    if (answer === "yes") check(yesField);
    else if (answer === "no") check(noField);
    else throw new Error(`Réponse réglementaire non démontrée : ${key}.`);
  }
  if (project.details.heritageArea === "yes") check("X2R_remarquable");
  if (project.details.historicMonumentArea === "yes") check("X2H_historique");
  if (project.details.classifiedSite === "yes") check("X2C_classe");

  for (const field of ["P5PA2", "P5PB1", "P3GE1", "P3GD1", "P5PC1", "P3GF1", "P3GG1", "P3GH1"]) check(field);
  setText("E1L_lieu", siteAddress.city);
  setText("E1D_date", compactDate(new Date().toISOString().slice(0, 10)));
  setText("E1S_signature", project.requesterKind === "company"
    ? `${project.details.representativeFirstName} ${project.details.representativeLastName}`
    : `${firstName} ${lastName}`);

  form.updateFieldAppearances(appearanceFont);
  return pdf;
}
