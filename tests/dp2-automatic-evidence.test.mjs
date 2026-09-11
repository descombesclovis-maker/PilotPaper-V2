import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engine = await readFile(new URL("../lib/dp2-v1-engine.ts", import.meta.url), "utf8");
const parcel = await readFile(new URL("../lib/dp-ai-engine/context/officialParcel.ts", import.meta.url), "utf8");
const siteModel = await readFile(new URL("../lib/dp-ai-engine/site-model/siteModelEngine.ts", import.meta.url), "utf8");
const assisted = await readFile(new URL("../lib/dp-ai-engine/site-model/assistedRoofRecovery.ts", import.meta.url), "utf8");

test("DP2 anchors one official parcel before every automatic or assisted SiteModel", () => {
  assert.match(engine, /resolveOfficialParcelContext/);
  assert.match(engine, /metricFrameForParcel/);
  assert.match(engine, /projectParcelRingNormalized/);

  const generatorStart = engine.indexOf("export async function generateDp2Piece");
  assert.ok(generatorStart >= 0);
  const generator = engine.slice(generatorStart);
  const officialCall = generator.indexOf("const official = await resolveDp2OfficialContext");
  const assistedCall = generator.indexOf("buildAssistedSiteModelFromParcel");
  const automaticCall = generator.indexOf("buildAutomaticSiteModelFromParcel(official)");
  assert.ok(officialCall >= 0 && assistedCall > officialCall && automaticCall > officialCall);
  assert.match(engine, /function buildProjectContextFromSiteModel[\s\S]*resolveLayoutContext/);
});

test("official parcel logic lives in the reusable core rather than the DP2 document engine", () => {
  assert.match(parcel, /https:\/\/apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
  assert.match(parcel, /resolveOfficialParcelContext/);
  assert.doesNotMatch(engine, /apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
  assert.doesNotMatch(engine, /geocodage\/reverse/);
});

test("DP2 no longer falls back invisibly to vision geometry or the legacy obstacle census", () => {
  assert.doesNotMatch(engine, /resolveCrossViewSurfaceIdentity/);
  assert.doesNotMatch(engine, /metricSurfaceFromIdentity/);
  assert.doesNotMatch(engine, /resolveSurfaceObstacleInventory/);
  assert.doesNotMatch(engine, /generateWithLegacyVision/);
  assert.match(engine, /throw new Dp2AssistedRecoveryRequiredError\(reason, official\)/);
});

test("assisted recovery uses four clicks only to select a face and derives geometry from LiDAR", () => {
  assert.match(siteModel, /buildAssistedSiteModelFromParcel/);
  assert.match(siteModel, /recoverRoofFromFourClicks/);
  assert.match(assisted, /samplePolygonLidarHeights/);
  assert.match(assisted, /buildRoofModelFromLidar/);
  assert.match(assisted, /aucune dimension saisie/i);
  assert.match(assisted, /support: syntheticSupport/);
});

test("DP2 document engine orchestrates shared SiteModel and deterministic layout instead of implementing roof geometry", () => {
  assert.match(engine, /buildAutomaticSiteModelFromParcel/);
  assert.match(engine, /buildAssistedSiteModelFromParcel/);
  assert.match(engine, /metricSurfaceFromSitePlane/);
  assert.match(engine, /resolveProjectLayout/);
  assert.doesNotMatch(engine, /function planeFrom3/);
  assert.doesNotMatch(engine, /function fitPlaneLeastSquares/);
  assert.doesNotMatch(engine, /function extractPlaneRansac/);
});
