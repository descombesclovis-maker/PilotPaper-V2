import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("DP route uses only the new direct Image-2 path for DP1-DP6", async () => {
  const route = await source("app/api/dp-piece/route.ts");
  assert.match(route, /generateImage2Dp/);
  assert.match(route, /chatgpt-image-2-direct/);
  assert.doesNotMatch(route, /SiteTwin|googleSolar|roof-faces|normalizeRoofSelection|Geometry/);
});

test("direct engine keeps ChatGPT Image free while locking project facts", async () => {
  const engine = await source("lib/pilotpaper-image2-engine.ts");
  assert.match(engine, /gpt-image-2/);
  assert.match(engine, /Use visual intelligence freely/);
  assert.match(engine, /automatically avoid chimneys, skylights\/Velux/);
  assert.match(engine, /Exact installation: \$\{spec\.panelCount\} panels arranged exactly/);
  assert.match(engine, /Do NOT use or draw masks/);
  assert.match(engine, /Aucun masque, Site Twin, recalage caméra ou Geometry Engine/);
});

test("DP1 through DP6 missions match the new product contract", async () => {
  const engine = await source("lib/pilotpaper-image2-engine.ts");
  assert.match(engine, /highlight only the target parcel in navy/i);
  assert.match(engine, /DP2 — PLAN DE MASSE \/ ROOF PLAN FROM ABOVE/);
  assert.match(engine, /DP3 — PROFESSIONAL ARCHITECTURAL SECTION/);
  assert.match(engine, /DP4 — INITIAL \/ PROJECTED STATE/);
  assert.match(engine, /somewhat HIGHER camera position/);
  assert.match(engine, /DP6 — DISTANT CONTEXTUAL INSERTION/);
});

test("DP2-DP6 continuity survives navigation through persistent generated references", async () => {
  const engine = await source("lib/pilotpaper-image2-engine.ts");
  const ui = await source("components/dp-piece-workbench.tsx");
  const persistence = await source("lib/pilotpaper-image2-persistence.ts");

  assert.match(engine, /same physical roof zone across all project references/i);
  assert.match(engine, /3: \[2\]/);
  assert.match(engine, /4: \[2, 3\]/);
  assert.match(engine, /5: \[4, 2, 3\]/);
  assert.match(engine, /6: \[5, 4, 2\]/);

  assert.match(ui, /if \(dp === 3\) return \[2\]/);
  assert.match(ui, /if \(dp === 4\) return \[2, 3\]/);
  assert.match(ui, /if \(dp === 5\) return \[4, 2, 3\]/);
  assert.match(ui, /if \(dp === 6\) return \[5, 4, 2\]/);
  assert.match(ui, /resultsByDp/);
  assert.match(ui, /resultsRef/);
  assert.match(ui, /persistDpPiece/);
  assert.match(ui, /loadPersistedDpPieces/);
  assert.match(persistence, /indexedDB\.open/);
  assert.match(persistence, /generated-dp-pieces/);
});

test("Image-2 generations are sequential jobs with a visible photovoltaic queue", async () => {
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

test("Windows build no longer bundles or starts the Geometry Engine", async () => {
  const workflow = await source(".github/workflows/build-v1-k-par-k-windows.yml");
  const launcher = await source("desktop/PilotPaperLauncher/Program.cs");
  const installer = await source("desktop/PilotPaperInstaller.iss");
  assert.doesNotMatch(workflow, /Build bundled Geometry Engine|Smoke-test bundled Geometry Engine|PilotPaper-GeometryEngine/);
  assert.doesNotMatch(launcher, /GeometryHealthUrl|StartGeometryEngine|PILOTPAPER_GEOMETRY_ENGINE_URL|GOOGLE_SOLAR_API_KEY/);
  assert.match(launcher, /DP_IMAGE_MODEL/);
  assert.match(installer, /\[InstallDelete\]/);
  assert.match(installer, /\{app\}\\geometry-engine/);
  assert.match(installer, /\{app\}\\app\\current/);
});
