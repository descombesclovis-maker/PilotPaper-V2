import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Créer ma DP delegates the same K-par-k API to a persistent background manager", async () => {
  const page = await source("app/declaration-prealable/page.tsx");
  const experience = await source("components/production/complete-dp-background-experience.tsx");
  const manager = await source("lib/pilotpaper-complete-dossiers.ts");
  const kpark = await source("app/declaration-prealable/k-par-k/page.tsx");

  assert.match(page, /CompleteDpBackgroundExperience/);
  assert.doesNotMatch(page, /WorkspaceClient|ProductionDpWorkspace/);
  assert.match(kpark, /DpPieceWorkbenchClient/);
  assert.match(manager, /fetch\("\/api\/dp-piece"/);
  assert.match(manager, /persistDpPiece/);
  assert.match(experience, /Générer ma DP complète/);
  assert.match(experience, /La génération continue même si vous quittez cette page/);
});

test("complete generation reduces the critical path with two coherent parallel waves anchored on DP2", async () => {
  const manager = await source("lib/pilotpaper-complete-dossiers.ts");
  assert.match(manager, /const dp1Promise = runPiece\(id, 1, \[\]\)/);
  assert.match(manager, /const dp2Result = await runPiece\(id, 2, \[\]\)/);
  assert.match(manager, /const dp3Promise = runPiece\(id, 3, \[dp2Reference\]\)/);
  assert.match(manager, /const dp4Promise = runPiece\(id, 4, \[dp2Reference\]\)/);
  assert.match(manager, /Promise\.all\(\[dp3Promise, dp4Promise\]\)/);
  assert.match(manager, /const closeReferences = \[dp2Reference, dp4Reference\]/);
  assert.match(manager, /runPiece\(id, 5, closeReferences\)/);
  assert.match(manager, /runPiece\(id, 6, closeReferences\)/);
  assert.match(manager, /Promise\.allSettled\(\[dp1Promise, dp7Promise, dp8Promise\]\)/);
});

test("background dossiers persist and resume after navigation or application reopen", async () => {
  const manager = await source("lib/pilotpaper-complete-dossiers.ts");
  const shell = await source("components/production/pilotpaper-production-shell.tsx");
  const dossiers = await source("components/production/mes-dossiers.tsx");
  const route = await source("app/declaration-prealable/mes-dossiers/page.tsx");

  assert.match(manager, /indexedDB\.open/);
  assert.match(manager, /pilotpaper-production-dossiers/);
  assert.match(manager, /ensureCompleteDossierRunning/);
  assert.match(manager, /subscribeCompleteDossier/);
  assert.match(shell, /listCompleteDossiers/);
  assert.match(shell, /ensureCompleteDossierRunning/);
  assert.match(dossiers, /Mes dossiers/);
  assert.match(dossiers, /\/declaration-prealable\?dossier=/);
  assert.match(route, /MesDossiers/);
});

test("production form asks for exactly two real photos and reuses the close view as roof source", async () => {
  const experience = await source("components/production/complete-dp-background-experience.tsx");
  const manager = await source("lib/pilotpaper-complete-dossiers.ts");
  const fileInputs = experience.match(/type="file"/g) ?? [];
  assert.equal(fileInputs.length, 2);
  assert.match(manager, /role: "roof"/);
  assert.match(manager, /toiture-\$\{near\.filename/);
  assert.doesNotMatch(experience, /roofWidthMm|roofSlopeLengthMm|roofSlopeDeg/);
});

test("saved installation preferences are not cosmetic: they enter DP2 geometry and specialized DP3 facts", async () => {
  const experience = await source("components/production/complete-dp-background-experience.tsx");
  const manager = await source("lib/pilotpaper-complete-dossiers.ts");
  const types = await source("lib/pilotpaper-image2-types.ts");
  const vision = await source("lib/pilotpaper-vision-engine.ts");
  const dp3 = await source("lib/pilotpaper-dp3-generator.ts");

  assert.match(experience, /INSTALLATION_PREFS_STORAGE_KEY/);
  assert.match(experience, /mountingSystem/);
  assert.match(manager, /interPanelGapMm: current\.project\.panelGapMm/);
  assert.match(manager, /gutterClearanceMm: current\.project\.gutterClearanceMm/);
  assert.match(manager, /mountingSystem: current\.project\.mountingSystem/);
  assert.match(types, /mountingSystem\?: string/);

  assert.match(vision, /const gapMm = boundedPreference\(input\.interPanelGapMm, 20/);
  assert.match(vision, /const gutterClearanceMm = boundedPreference\(input\.gutterClearanceMm, 300/);
  assert.match(vision, /INSTALLER PREFERENCES/);
  assert.match(vision, /Actively apply the saved installer preferences/);
  assert.match(vision, /mounting system/);
  assert.match(dp3, /Calculated field footprint: \$\{fieldWidthMm\} × \$\{fieldHeightMm\} mm with \$\{gapMm\} mm/);
  assert.match(dp3, /Saved installer preferences inherited from DP2/);
});

test("production hides legacy dossier-control workflow while keeping internal quality rejection", async () => {
  const experience = await source("components/production/complete-dp-background-experience.tsx");
  assert.doesNotMatch(experience, /WorkspaceClient|layout-check|preflight|postflight|finalAttestation/);
  assert.match(experience, /L’Inspector reste actif uniquement en coulisses/);
  assert.match(experience, /Il ne crée plus d’étape de contrôle utilisateur/);
});

test("professional PDF puts agency logo in the header and chosen colors around every DP sheet", async () => {
  const pdf = await source("lib/pilotpaper-branded-dossier-pdf.ts");
  assert.match(pdf, /record\.branding\.logoDataUrl/);
  assert.match(pdf, /record\.branding\.primaryColor/);
  assert.match(pdf, /record\.branding\.accentColor/);
  assert.match(pdf, /borderColor: primary/);
  assert.match(pdf, /borderColor: accent/);
  assert.match(pdf, /page\.drawImage\(logo/);
  assert.match(pdf, /Professional frame/);
});

test("navigation exposes Mes dossiers and an accordion for every future building dossier", async () => {
  const shell = await source("components/production/pilotpaper-production-shell.tsx");
  assert.match(shell, />Mes dossiers</);
  assert.match(shell, /Demande de construction/);
  assert.match(shell, /PLU & urbanisme/);
  assert.match(shell, /Certificat d’urbanisme/);
  assert.match(shell, /Permis d’aménager/);
  assert.match(shell, /Autorisation de travaux ERP/);
  assert.match(shell, /Déclaration d’ouverture/);
  assert.match(shell, /Achèvement & conformité/);
  assert.match(shell, /Permis de démolir/);
  assert.match(shell, /LockedAction/);
});
