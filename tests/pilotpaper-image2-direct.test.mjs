import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("DP route uses deterministic DP1 plus preventive and specialized PilotPaper visual paths", async () => {
  const route = await source("app/api/dp-piece/route.ts");
  assert.match(route, /generateOfficialDp1/);
  assert.match(route, /official-cadastre-deterministic/);
  assert.match(route, /generatePreventiveDp/);
  assert.match(route, /generateSpecializedDp3/);
  assert.match(route, /generateSpecializedDp4/);
  assert.match(route, /pilotpaper-vision-preventive/);
  assert.match(route, /pilotpaper-dp3-specialized/);
  assert.match(route, /pilotpaper-dp4-specialized/);
  assert.doesNotMatch(route, /SiteTwin|googleSolar|roof-faces|normalizeRoofSelection|Geometry/);
});

test("generation prevents wrong PV counts and wrong module geometry before exposing a result", async () => {
  const engine = await source("lib/pilotpaper-vision-engine.ts");
  assert.match(engine, /EXACTLY \$\{spec\.panelCount\} photovoltaic modules/);
  assert.match(engine, /internally count the cells of the array row by row/);
  assert.match(engine, /internally recount them/);
  assert.match(engine, /MAX_GENERATION_ATTEMPTS = 4/);
  assert.match(engine, /PHOTOVOLTAIC INSERTION SPECIALIST PROTOCOL/);
  assert.match(engine, /Modules are rectangular physical objects, not square tiles/);
  assert.match(engine, /moduleShapeCorrect/);
  assert.match(engine, /moduleScalePlausible/);
  assert.match(engine, /projectiveConsistency/);
  assert.match(engine, /AUTOMATIC CORRECTION PASS/);
  assert.match(engine, /if \(inspector\.passed\)/);
  assert.match(engine, /non produite : PilotPaper a détecté une incohérence avant sauvegarde/);
});

test("DP2 locks the real target parcel and building instead of choosing a neighboring roof", async () => {
  const engine = await source("lib/pilotpaper-vision-engine.ts");
  assert.match(engine, /official close IGN aerial\/cadastral image and is an IMMUTABLE BASE/);
  assert.match(engine, /actual target building inside parcel/);
  assert.match(engine, /Do not equip a neighboring roof/);
  assert.match(engine, /targetParcelCorrect/);
  assert.match(engine, /targetBuildingCorrect/);
  assert.match(engine, /Do not regenerate the property/);
});

test("DP1 is deterministic from official IGN and API Carto geometry and does not spend an image-generation call", async () => {
  const route = await source("app/api/dp-piece/route.ts");
  const generator = await source("lib/pilotpaper-dp1-generator.ts");
  assert.match(route, /if \(input\.dp === 1\) return generateOfficialDp1/);
  assert.match(generator, /apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
  assert.match(generator, /PilotPaper refuse de deviner la parcelle/);
  assert.match(generator, /DP1 déterministe : aucune IA générative utilisée/);
  assert.match(generator, /Contour cible issu directement de l'API Carto Cadastre/);
  assert.doesNotMatch(generator, /\/v1\/images|gpt-image|OPENAI_API_KEY/);
});

test("DP3 has a dedicated non-blocking photo analysis and hybrid section path", async () => {
  const route = await source("app/api/dp-piece/route.ts");
  const generator = await source("lib/pilotpaper-dp3-generator.ts");
  const analyzer = await source("lib/pilotpaper-dp3-section-engine.ts");
  assert.match(route, /generateSpecializedDp3/);
  assert.match(generator, /orthographic LATERAL architectural section/);
  assert.match(generator, /3D axonometric cutaway/);
  assert.match(generator, /never invent building\/roof\/terrain numeric dimensions/i);
  assert.match(generator, /Verified module dimensions/);
  assert.match(generator, /MAX_DP3_ATTEMPTS = 4/);
  assert.match(analyzer, /pre-analysis stage of PilotPaper DP3/);
  assert.match(analyzer, /Do NOT invent measurements/);
  assert.match(analyzer, /return null/);
});

test("DP4 uses a dedicated photographic insertion path without false all-or-nothing judge gating", async () => {
  const route = await source("app/api/dp-piece/route.ts");
  const generator = await source("lib/pilotpaper-dp4-generator.ts");
  assert.match(route, /generateSpecializedDp4/);
  assert.match(generator, /same photo with only the photovoltaic array added/);
  assert.match(generator, /Count panels only in the projected state/);
  assert.match(generator, /moduleShapeCorrect/);
  assert.match(generator, /criticalPass/);
  assert.doesNotMatch(generator, /judge\.passed/);
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

test("provider wording is removed case-insensitively from the visible interface", async () => {
  const client = await source("components/dp-piece-workbench-client.tsx");
  assert.match(client, /sanitizeVisibleProviderWording/);
  assert.match(client, /PilotPaper Vision/);
  assert.equal(client.includes(".replace(/chatgpt"), true);
  assert.equal(client.includes("/gi"), true);
  assert.equal(client.includes(".replace(/openai/gi"), true);
});

test("visual generations stay sequential, persistent and reopenable without covering finished documents", async () => {
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
  assert.match(generationUi, /const collapsed = !running && !expanded/);
  assert.match(generationUi, /Ouvrir PilotPaper Live/);
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
