import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("DP route uses the preventive PilotPaper visual path for DP1-DP6", async () => {
  const route = await source("app/api/dp-piece/route.ts");
  assert.match(route, /generatePreventiveDp/);
  assert.match(route, /pilotpaper-vision-preventive/);
  assert.doesNotMatch(route, /SiteTwin|googleSolar|roof-faces|normalizeRoofSelection|Geometry/);
});

test("generation prevents wrong PV counts before exposing a result", async () => {
  const engine = await source("lib/pilotpaper-vision-engine.ts");
  assert.match(engine, /EXACTLY \$\{spec\.panelCount\} photovoltaic modules/);
  assert.match(engine, /internally count the cells of the array row by row/);
  assert.match(engine, /internally recount them/);
  assert.match(engine, /MAX_GENERATION_ATTEMPTS = 3/);
  assert.match(engine, /AUTOMATIC CORRECTION PASS/);
  assert.match(engine, /if \(inspector\.passed\)/);
  assert.match(engine, /non produite : PilotPaper a détecté une incohérence avant sauvegarde/);
});

test("DP2 and DP6 lock the real source instead of rebuilding the property", async () => {
  const engine = await source("lib/pilotpaper-vision-engine.ts");
  assert.match(engine, /official close IGN aerial\/cadastral image and is an IMMUTABLE BASE/);
  assert.match(engine, /Do not regenerate the property/);
  assert.match(engine, /The ONLY physical change allowed is the photovoltaic installation/);
  assert.match(engine, /Do not invent a new entrance, door, window, roof, annex, tree, road, fence/);
  assert.match(engine, /\[2, 4, 6\]\.includes\(dp\)/);
});

test("DP3 is forced into a genuine side section and cannot invent dimensions", async () => {
  const engine = await source("lib/pilotpaper-vision-engine.ts");
  assert.match(engine, /section plane must be PERPENDICULAR TO THE ROOF RIDGE/);
  assert.match(engine, /not a front elevation/);
  assert.match(engine, /Do not invent numeric dimensions of the house/);
  assert.match(engine, /sectionSideCorrect/);
  assert.match(engine, /inventedNumericDimensions/);
});

test("DP2 is the persistent master placement reference for DP3-DP6", async () => {
  const engine = await source("lib/pilotpaper-vision-engine.ts");
  const ui = await source("components/dp-piece-workbench.tsx");
  const persistence = await source("lib/pilotpaper-image2-persistence.ts");

  assert.match(engine, /3: \[2\]/);
  assert.match(engine, /4: \[2\]/);
  assert.match(engine, /5: \[2, 4\]/);
  assert.match(engine, /6: \[2, 4, 5\]/);
  assert.match(engine, /générez d'abord la DP2/);

  assert.match(ui, /resultsByDp/);
  assert.match(ui, /resultsRef/);
  assert.match(ui, /persistDpPiece/);
  assert.match(ui, /loadPersistedDpPieces/);
  assert.match(persistence, /indexedDB\.open/);
  assert.match(persistence, /generated-dp-pieces/);
});

test("visible forms ask only for minimum project facts and required photos", async () => {
  const contract = await source("lib/dp-piece-contract.ts");
  const commonBlock = contract.match(/const commonPvFields:[\s\S]*?\];/)?.[0] ?? "";
  assert.match(commonBlock, /"address"/);
  assert.match(commonBlock, /"moduleReference"/);
  assert.match(commonBlock, /"panelCount"/);
  assert.match(commonBlock, /"rows"/);
  assert.match(commonBlock, /"columns"/);
  assert.match(commonBlock, /"orientation"/);
  assert.doesNotMatch(commonBlock, /instructions|roofWidthMm|roofSlopeLengthMm|roofSlopeDeg|gutterClearanceMm|interPanelGapMm|placement/);
  assert.match(contract, /fields: \[\.\.\.commonPvFields, "nearPhoto"\]/);
  assert.match(contract, /fields: \[\.\.\.commonPvFields, "roofPhoto"\]/);
  assert.match(contract, /fields: \[\.\.\.commonPvFields, "farPhoto"\]/);
});

test("provider wording is removed from the visible interface", async () => {
  const client = await source("components/dp-piece-workbench-client.tsx");
  assert.match(client, /sanitizeVisibleProviderWording/);
  assert.match(client, /PilotPaper Vision/);
  assert.match(client, /replaceAll\("ChatGPT"/);
});

test("visual generations stay sequential, persistent and reopenable", async () => {
  const ui = await source("components/dp-piece-workbench.tsx");
  const generationUi = await source("components/solar-generation-ui.tsx");
  assert.match(ui, /queueRef/);
  assert.match(ui, /processingRef/);
  assert.match(ui, /async function processQueue/);
  assert.match(ui, /queueRef\.current\.shift\(\)/);
  assert.match(ui, /GenerationDock/);
  assert.match(ui, /SolarGenerationStage/);
  assert.match(ui, /Effacer et recommencer/);
  assert.match(generationUi, /PILOTPAPER LIVE/);
  assert.match(generationUi, /FILE D’ATTENTE/);
  assert.match(generationUi, /Aucun faux pourcentage/);
});

test("DP7 and DP8 preserve original photos", async () => {
  const pieceEngine = await source("lib/dp-piece-engine.ts");
  assert.match(pieceEngine, /photographie originale conservée sans génération/i);
  assert.match(pieceEngine, /Aucune retouche générative/);
});

test("Windows build remains free of the retired Geometry Engine", async () => {
  const workflow = await source(".github/workflows/build-v1-k-par-k-windows.yml");
  const launcher = await source("desktop/PilotPaperLauncher/Program.cs");
  const installer = await source("desktop/PilotPaperInstaller.iss");
  assert.doesNotMatch(workflow, /Build bundled Geometry Engine|Smoke-test bundled Geometry Engine|PilotPaper-GeometryEngine/);
  assert.doesNotMatch(launcher, /GeometryHealthUrl|StartGeometryEngine|PILOTPAPER_GEOMETRY_ENGINE_URL|GOOGLE_SOLAR_API_KEY/);
  assert.match(installer, /\[InstallDelete\]/);
  assert.match(installer, /\{app\}\\geometry-engine/);
  assert.match(installer, /\{app\}\\app\\current/);
});
