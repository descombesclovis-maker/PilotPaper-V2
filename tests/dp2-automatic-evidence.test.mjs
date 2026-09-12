import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const entry = await readFile(new URL("../lib/dp2-v1-engine.ts", import.meta.url), "utf8");
const engine = await readFile(new URL("../lib/dp2-roof-designer-engine.ts", import.meta.url), "utf8");
const parcel = await readFile(new URL("../lib/dp-ai-engine/context/officialParcel.ts", import.meta.url), "utf8");
const designer = await readFile(new URL("../lib/dp-ai-engine/site-model/manualRoofDesigner.ts", import.meta.url), "utf8");

test("DP2 keeps one official parcel and metric IGN frame before Roof Designer geometry", () => {
  assert.match(entry, /dp2-roof-designer-engine/);
  assert.match(engine, /resolveOfficialParcelContext/);
  assert.match(engine, /metricFrameForParcel/);
  assert.match(engine, /projectParcelRingNormalized/);
  const generatorStart = engine.indexOf("export async function generateDp2Piece");
  assert.ok(generatorStart >= 0);
  const generator = engine.slice(generatorStart);
  const officialCall = generator.indexOf("const official = await resolveDp2OfficialContext");
  const designCall = generator.indexOf("asReviewedRoofDesign");
  assert.ok(officialCall >= 0 && designCall > officialCall);
});

test("official parcel logic stays reusable rather than being copied into DP2", () => {
  assert.match(parcel, /https:\/\/apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
  assert.match(parcel, /resolveOfficialParcelContext/);
  assert.doesNotMatch(engine, /apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
  assert.doesNotMatch(engine, /geocodage\/reverse/);
});

test("DP2 no longer depends on LiDAR vision or automatic roof guessing", () => {
  assert.doesNotMatch(engine, /buildAutomaticSiteModelFromParcel/);
  assert.doesNotMatch(engine, /buildAssistedSiteModelFromParcel/);
  assert.doesNotMatch(engine, /resolveCrossViewSurfaceIdentity/);
  assert.doesNotMatch(engine, /resolveSurfaceObstacleInventory/);
  assert.doesNotMatch(engine, /lidarAltimetry|buildRoofModelFromLidar|samplePolygonLidarHeights|recoverRoofFromFourClicks/);
  assert.match(engine, /LiDAR n'est pas requis/);
  assert.match(engine, /Dp2RoofDesignerRequiredError/);
  assert.match(engine, /manualRoofDesign/);
});

test("Roof Designer converts a reviewed roof quad and keepouts into deterministic metric geometry", () => {
  assert.match(designer, /metricSurfaceFromManualRoofDesign/);
  assert.match(designer, /quadNormalized/);
  assert.match(designer, /slopeDeg/);
  assert.match(designer, /keepouts/);
  assert.match(designer, /surfacePolygonMm/);
  assert.match(designer, /obstaclePolygonsMm/);
  assert.match(engine, /resolveProjectLayout/);
});
