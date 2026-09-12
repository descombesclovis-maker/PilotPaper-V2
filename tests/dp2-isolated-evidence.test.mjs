import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engine = await readFile(new URL("../lib/dp2-roof-designer-engine.ts", import.meta.url), "utf8");
const raster = await readFile(new URL("../lib/dp-ai-engine/context/ignRaster.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/dp-piece/route.ts", import.meta.url), "utf8");
const contract = await readFile(new URL("../lib/dp-piece-contract.ts", import.meta.url), "utf8");
const workbench = await readFile(new URL("../components/dp-piece-workbench.tsx", import.meta.url), "utf8");

test("DP2 does not require user photographs OpenAI or LiDAR for geometry", () => {
  assert.doesNotMatch(engine, /configFromEnv|OPENAI_API_KEY|asRoofPhoto/);
  assert.doesNotMatch(engine, /buildAutomaticSiteModelFromParcel|buildAssistedSiteModelFromParcel/);
  assert.match(engine, /metricSurfaceFromManualRoofDesign/);
});

test("DP2 routes through Roof Designer recovery before deterministic generation", () => {
  assert.match(route, /generateDp2Piece/);
  assert.match(route, /input\.dp === 2/);
  assert.match(route, /Dp2RoofDesignerRequiredError/);
  assert.match(route, /status: 409/);
  assert.match(route, /roof_designer/);
  assert.match(engine, /manualRoofDesign/);
});

test("DP2 consumes separate shared orthophoto and cadastral raster layers", () => {
  assert.match(engine, /orthophotoCandidates/);
  assert.match(engine, /cadastralCandidates/);
  assert.match(raster, /ORTHOIMAGERY\.ORTHOPHOTOS/);
  assert.match(raster, /CADASTRALPARCELS\.PARCELLAIRE_EXPRESS/);
  assert.doesNotMatch(raster, /ORTHOIMAGERY\.ORTHOPHOTOS,CADASTRALPARCELS/);
});

test("DP2 UI contract stays geospatial and does not ask for project photographs", () => {
  const dp2Start = contract.indexOf("dp: 2,");
  const dp3Start = contract.indexOf("dp: 3,");
  assert.ok(dp2Start >= 0 && dp3Start > dp2Start);
  const dp2 = contract.slice(dp2Start, dp3Start);
  assert.doesNotMatch(dp2, /"nearPhoto"|"roofPhoto"|"farPhoto"/);
});

test("workbench reviews roof slope and keepouts before submitting manualRoofDesign", () => {
  assert.match(workbench, /type RoofDesignerRecovery/);
  assert.match(workbench, /Gouttière gauche/);
  assert.match(workbench, /Faîtage droite/);
  assert.match(workbench, /manualRoofDesign/);
  assert.match(workbench, /Ajouter un obstacle/);
  assert.match(workbench, /obstaclesConfirmed: true/);
  assert.match(workbench, /Valider le toit et générer DP2/);
  assert.doesNotMatch(workbench, /Analyser ce pan avec LiDAR/);
});
