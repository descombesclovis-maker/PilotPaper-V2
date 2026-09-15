import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Créer ma DP is a one-click orchestration of the same K-par-k piece engine", async () => {
  const page = await source("app/declaration-prealable/page.tsx");
  const experience = await source("components/production/complete-dp-experience.tsx");
  const kpark = await source("app/declaration-prealable/k-par-k/page.tsx");

  assert.match(page, /CompleteDpExperience/);
  assert.doesNotMatch(page, /WorkspaceClient|ProductionDpWorkspace/);
  assert.match(kpark, /DpPieceWorkbenchClient/);
  assert.match(experience, /fetch\("\/api\/dp-piece"/);
  assert.match(experience, /for \(const \{ dp \} of PIECES\)/);
  assert.match(experience, /DP1 → DP8/);
  assert.match(experience, /persistDpPiece/);
});

test("production form asks for two real photos and automatically reuses the close view as roof source", async () => {
  const experience = await source("components/production/complete-dp-experience.tsx");
  const fileInputs = experience.match(/type="file"/g) ?? [];
  assert.equal(fileInputs.length, 2);
  assert.match(experience, /role: "near"/);
  assert.match(experience, /role: "roof"/);
  assert.match(experience, /role: "far"/);
  assert.match(experience, /toiture-\$\{nearPhoto\.filename\}/);
  assert.doesNotMatch(experience, /roofWidthMm|roofSlopeLengthMm|roofSlopeDeg/);
});

test("production hides legacy dossier-control workflow while keeping internal quality rejection", async () => {
  const experience = await source("components/production/complete-dp-experience.tsx");
  assert.doesNotMatch(experience, /WorkspaceClient|layout-check|preflight|postflight|finalAttestation/);
  assert.match(experience, /Le contrôle qualité reste actif en coulisses/);
  assert.match(experience, /une pièce refusée n’est jamais présentée comme valide/i);
  assert.match(experience, /Générer ma DP complète/);
});

test("complete production output can be exported as a branded DP1-DP8 PDF", async () => {
  const experience = await source("components/production/complete-dp-experience.tsx");
  assert.match(experience, /PDFDocument\.create/);
  assert.match(experience, /branding\.primaryColor/);
  assert.match(experience, /branding\.accentColor/);
  assert.match(experience, /branding\.companyName/);
  assert.match(experience, /PilotPaper-DP-Complete\.pdf/);
  assert.match(experience, /Télécharger le dossier complet/);
});
