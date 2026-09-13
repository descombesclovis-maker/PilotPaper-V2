import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engine = await readFile(new URL("../lib/dp2-roof-designer-engine.ts", import.meta.url), "utf8");
const raster = await readFile(new URL("../lib/dp-ai-engine/context/ignRaster.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/dp-piece/route.ts", import.meta.url), "utf8");
const direct = await readFile(new URL("../lib/dp-direct-chatgpt-image-engine.ts", import.meta.url), "utf8");
const semantic = await readFile(new URL("../lib/dp-ai-engine/providers/openaiSemanticImage.ts", import.meta.url), "utf8");
const contract = await readFile(new URL("../lib/dp-piece-contract.ts", import.meta.url), "utf8");
const workbench = await readFile(new URL("../components/dp-piece-workbench.tsx", import.meta.url), "utf8");

test("legacy DP2 metric helper stays independent from OpenAI", () => {
  assert.doesNotMatch(engine, /configFromEnv|OPENAI_API_KEY|asRoofPhoto/);
  assert.doesNotMatch(engine, /buildAutomaticSiteModelFromParcel|buildAssistedSiteModelFromParcel/);
  assert.match(engine, /metricSurfaceFromManualRoofDesign/);
});

test("isolated DP2 now routes through direct ChatGPT Image instead of Roof Designer recovery", () => {
  assert.match(route, /generateDirectChatGptDp/);
  assert.match(route, /input\.dp === 2/);
  assert.match(route, /dp: 2/);
  assert.match(route, /chatgpt-direct/);
  assert.doesNotMatch(route, /generateDp2Piece/);
  assert.doesNotMatch(route, /Dp2RoofDesignerRequiredError/);
  assert.match(direct, /lockSiteTwinProperty/);
  assert.match(direct, /fetchIgnImage\("satellite_mass"/);
  assert.match(direct, /OpenAISemanticImageEditor/);
  assert.doesNotMatch(semantic, /data\.set\("mask"|data\.append\("mask"/);
});

test("DP2 direct path receives official IGN aerial and cadastral site context", () => {
  assert.match(direct, /HR\.ORTHOIMAGERY\.ORTHOPHOTOS,CADASTRALPARCELS\.PARCELLAIRE_EXPRESS/);
  assert.match(direct, /Property Lock/);
  assert.match(raster, /ORTHOIMAGERY\.ORTHOPHOTOS/);
  assert.match(raster, /CADASTRALPARCELS\.PARCELLAIRE_EXPRESS/);
});

test("DP2 UI contract stays geospatial and does not require project photographs", () => {
  const dp2Start = contract.indexOf("dp: 2,");
  const dp3Start = contract.indexOf("dp: 3,");
  assert.ok(dp2Start >= 0 && dp3Start > dp2Start);
  const dp2 = contract.slice(dp2Start, dp3Start);
  assert.match(dp2, /output: "image"/);
  assert.match(dp2, /allowsGenerativeRefinement: true/);
  assert.doesNotMatch(dp2, /"nearPhoto"|"roofPhoto"|"farPhoto"/);
});

test("old Roof Designer UI remains available only as legacy recovery tooling, not the DP2 route", () => {
  assert.match(workbench, /type RoofDesignerRecovery/);
  assert.match(workbench, /manualRoofDesign/);
  assert.doesNotMatch(route, /roof_designer/);
  assert.doesNotMatch(route, /status: 409/);
});
