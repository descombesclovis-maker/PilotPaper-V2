import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engine = await readFile(new URL("../lib/dp2-v1-engine.ts", import.meta.url), "utf8");
const raster = await readFile(new URL("../lib/dp-ai-engine/context/ignRaster.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/dp-piece/route.ts", import.meta.url), "utf8");
const contract = await readFile(new URL("../lib/dp-piece-contract.ts", import.meta.url), "utf8");
const workbench = await readFile(new URL("../components/dp-piece-workbench.tsx", import.meta.url), "utf8");

test("DP2 geometry path does not require a user photograph or OpenAI configuration", () => {
  assert.doesNotMatch(engine, /configFromEnv/);
  assert.doesNotMatch(engine, /OPENAI_API_KEY/);
  assert.doesNotMatch(engine, /asRoofPhoto/);
  assert.match(engine, /buildAutomaticSiteModelFromParcel/);
});

test("DP2 routes through its dedicated orchestrator and exposes explicit assisted recovery", () => {
  assert.match(route, /generateDp2Piece/);
  assert.match(route, /input\.dp === 2/);
  assert.match(route, /Dp2AssistedRecoveryRequiredError/);
  assert.match(route, /status: 409/);
  assert.match(route, /roof_quad/);
  assert.match(engine, /buildAssistedSiteModelFromParcel/);
});

test("DP2 consumes separate shared orthophoto and cadastral raster layers", () => {
  assert.match(engine, /orthophotoCandidates/);
  assert.match(engine, /cadastralCandidates/);
  assert.match(raster, /ORTHOIMAGERY\.ORTHOPHOTOS/);
  assert.match(raster, /CADASTRALPARCELS\.PARCELLAIRE_EXPRESS/);
  assert.doesNotMatch(raster, /ORTHOIMAGERY\.ORTHOPHOTOS,CADASTRALPARCELS/);
});

test("DP2 UI contract is geospatial and no longer asks for near roof or far photographs", () => {
  const dp2Start = contract.indexOf("dp: 2,");
  const dp3Start = contract.indexOf("dp: 3,");
  assert.ok(dp2Start >= 0 && dp3Start > dp2Start);
  const dp2 = contract.slice(dp2Start, dp3Start);
  assert.doesNotMatch(dp2, /"nearPhoto"|"roofPhoto"|"farPhoto"/);
});

test("workbench collects exactly four normalized points and resubmits them as assistedRoofQuad", () => {
  assert.match(workbench, /type RoofQuadRecovery/);
  assert.match(workbench, /recoveryPoints\.length >= 4/);
  assert.match(workbench, /\.slice\(0, 4\)/);
  assert.match(workbench, /assistedRoofQuad/);
  assert.match(workbench, /Analyser ce pan avec LiDAR/);
});
