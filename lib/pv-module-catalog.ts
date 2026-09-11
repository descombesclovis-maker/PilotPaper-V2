export const PV_MODULE_CATALOG_VERSION = "v1-2026-09-10";

export type VerifiedPvModule = {
  manufacturer: string;
  model: string;
  canonicalReference: string;
  aliases: readonly string[];
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  powerWp: number;
  sourceUrl: string;
  sourceDocument: string;
  sourceUpdatedAt?: string;
  verifiedAt: string;
  sourceKind: "manufacturer_datasheet" | "manufacturer_technical_page";
};

const catalog = [
  {
    manufacturer: "Trina Solar",
    model: "Vertex S+ 450 W",
    canonicalReference: "TSM-450NEG9R.28",
    aliases: ["TSM 450 NEG9R.28", "TSM-450 NEG9R.28", "Vertex S+ TSM-450NEG9R.28"],
    widthMm: 1134,
    heightMm: 1762,
    thicknessMm: 30,
    powerWp: 450,
    sourceUrl: "https://vertexsplus.trinasolar.com/fr/wp-content/uploads/sites/4/2024/09/240917_Datasheet_Vertex-S_NEG9R.28_FR_2024_C_web.pdf",
    sourceDocument: "Vertex S+ NEG9R.28 — fiche technique fabricant FR 2024 C",
    verifiedAt: "2026-09-10",
    sourceKind: "manufacturer_datasheet",
  },
  {
    manufacturer: "JinkoSolar",
    model: "Tiger Neo N-type 54HL4R-B 440 W",
    canonicalReference: "JKM440N-54HL4R-B",
    aliases: ["JKM440N 54HL4R B", "JKM440N-54HL4R-B-F1.3", "Tiger Neo JKM440N-54HL4R-B"],
    widthMm: 1134,
    heightMm: 1762,
    thicknessMm: 30,
    powerWp: 440,
    sourceUrl: "https://www.jinkosolar.com/uploads/JKM420-440N-54HL4R-B-F1.3-EN.pdf",
    sourceDocument: "Tiger Neo JKM420-440N-54HL4R-B F1.3 — manufacturer datasheet",
    verifiedAt: "2026-09-10",
    sourceKind: "manufacturer_datasheet",
  },
  {
    manufacturer: "DualSun",
    model: "FLASH 500 Half-Cut Glass-Glass TOPCon",
    canonicalReference: "DS500-120M10TB-03",
    aliases: ["FLASH 500 Half-Cut Glass-Glass TOPCon", "DualSun DS500-120M10TB-03"],
    widthMm: 1134,
    heightMm: 1950,
    thicknessMm: 30,
    powerWp: 500,
    sourceUrl: "https://dualsun.com/pro/fiche-technique/flash-500-half-cut-glass-glass-topcon/",
    sourceDocument: "FLASH 500 Half-Cut Glass-Glass TOPCon — DS500-120M10TB-03, V1.2",
    sourceUpdatedAt: "2026-03-13",
    verifiedAt: "2026-09-10",
    sourceKind: "manufacturer_technical_page",
  },
  {
    manufacturer: "DualSun",
    model: "FLASH 500 Half-Cut Black",
    canonicalReference: "DS500-132M10-01",
    aliases: ["FLASH 500 Half-Cut Black", "DualSun DS500-132M10-01"],
    widthMm: 1134,
    heightMm: 2094,
    thicknessMm: 35,
    powerWp: 500,
    sourceUrl: "https://dualsun.com/wp-content/uploads/dualsun-fr-fiche-technique-flash-500-half-cut-black.pdf",
    sourceDocument: "FLASH 500 Half-Cut Black — DS500-132M10-01, fiche technique fabricant",
    verifiedAt: "2026-09-10",
    sourceKind: "manufacturer_datasheet",
  },
] as const satisfies readonly VerifiedPvModule[];

const officialHostSuffix: Record<string, string> = {
  "Trina Solar": "trinasolar.com",
  JinkoSolar: "jinkosolar.com",
  DualSun: "dualsun.com",
};

export function normalizePvModuleReference(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function validateCatalogEntry(entry: VerifiedPvModule) {
  if (!(entry.widthMm > 0 && entry.heightMm > 0 && entry.thicknessMm > 0 && entry.powerWp > 0)) {
    throw new Error(`Invalid physical data in PV catalog for ${entry.canonicalReference}.`);
  }
  const expectedHost = officialHostSuffix[entry.manufacturer];
  const source = new URL(entry.sourceUrl);
  if (source.protocol !== "https:" || !expectedHost || !(source.hostname === expectedHost || source.hostname.endsWith(`.${expectedHost}`))) {
    throw new Error(`Non-manufacturer source rejected for ${entry.canonicalReference}.`);
  }
}

const byNormalizedReference = new Map<string, VerifiedPvModule>();
for (const entry of catalog) {
  validateCatalogEntry(entry);
  for (const token of [entry.canonicalReference, entry.model, ...entry.aliases]) {
    const normalized = normalizePvModuleReference(token);
    if (!normalized) continue;
    const previous = byNormalizedReference.get(normalized);
    if (previous && previous.canonicalReference !== entry.canonicalReference) {
      throw new Error(`Ambiguous PV catalog alias: ${token}.`);
    }
    byNormalizedReference.set(normalized, entry);
  }
}

export function listVerifiedPvModules(): readonly VerifiedPvModule[] {
  return catalog;
}

export function resolveVerifiedPvModule(reference: string): VerifiedPvModule | null {
  const normalized = normalizePvModuleReference(reference);
  if (!normalized) return null;
  return byNormalizedReference.get(normalized) ?? null;
}

export function requireVerifiedPvModule(reference: string): VerifiedPvModule {
  const resolved = resolveVerifiedPvModule(reference);
  if (!resolved) {
    throw new Error(
      `MODULE_REFERENCE_UNKNOWN: la référence « ${reference.trim() || "non renseignée"} » n'existe pas dans le catalogue fabricant vérifié ${PV_MODULE_CATALOG_VERSION}. Ajoutez sa fiche technique fabricant avant de générer le dossier.`,
    );
  }
  return resolved;
}

export function totalPowerKwp(moduleSpec: VerifiedPvModule, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Invalid module quantity.");
  return (moduleSpec.powerWp * quantity) / 1000;
}
