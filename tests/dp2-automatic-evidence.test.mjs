import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const entry = await readFile(new URL("../lib/dp2-v1-engine.ts", import.meta.url), "utf8");
const autoEngine = await readFile(new URL("../lib/dp2-google-solar-engine.ts", import.meta.url), "utf8");
const provider = await readFile(new URL("../lib/dp-ai-engine/providers/googleSolar.ts", import.meta.url), "utf8");
const safeCells = await readFile(new URL("../lib/dp-ai-engine/site-model/googleSolarAutomaticRoof.ts", import.meta.url), "utf8");
const targetResolver = await readFile(new URL("../lib/dp-ai-engine/site-model/targetPropertyResolver.ts", import.meta.url), "utf8");
const fallback = await readFile(new URL("../lib/dp2-roof-designer-engine.ts", import.meta.url), "utf8");
const designer = await readFile(new URL("../lib/dp-ai-engine/site-model/manualRoofDesigner.ts", import.meta.url), "utf8");

test("DP2 entry routes through Google Solar automatic engine", () => {
  assert.match(entry, /dp2-google-solar-engine/);
  assert.match(autoEngine, /fetchGoogleSolarBuildingInsights/);
  assert.match(autoEngine, /automaticRoofDesignFromGoogleSolar/);
  assert.match(autoEngine, /resolveProjectLayout/);
  const generatorStart = autoEngine.indexOf("export async function generateDp2Piece");
  assert.ok(generatorStart >= 0);
  const generator = autoEngine.slice(generatorStart);
  assert.ok(generator.indexOf("generateAutomaticDp2") < generator.indexOf("generateRoofDesignerDp2"));
});

test("Google Solar provider uses Building Insights and supports France-friendly MEDIUM plus BASE fallback", () => {
  assert.match(provider, /buildingInsights:findClosest/);
  assert.match(provider, /requiredQuality/);
  assert.match(provider, /quality: "MEDIUM"/);
  assert.match(provider, /EXPANDED_COVERAGE/);
  assert.match(provider, /GOOGLE_SOLAR_API_KEY/);
  assert.match(provider, /solarPanels/);
  assert.match(provider, /roofSegmentStats/);
});

test("automatic layout consumes only contiguous Google candidate cells and exact manufacturer dimensions", () => {
  assert.match(safeCells, /rectangleCells/);
  assert.match(safeCells, /googlePanelCountUsedAsSafeArea/);
  assert.match(safeCells, /moduleWidthMeters/);
  assert.match(safeCells, /moduleHeightMeters/);
  assert.match(safeCells, /requestedRows/);
  assert.match(safeCells, /requestedColumns/);
  assert.match(safeCells, /requestedOrientation/);
  assert.match(safeCells, /requestedWidth > safeWidth/);
  assert.match(safeCells, /requestedSlope > safeSlope/);
});

test("physical building center re-resolves the official parcel instead of trusting the roadside address point", () => {
  assert.match(autoEngine, /resolveTargetParcelFromBuildingCenter/);
  assert.match(targetResolver, /geocodage\/reverse/);
  assert.match(targetResolver, /index.*parcel/);
  assert.match(targetResolver, /buildingCenter/);
  assert.match(targetResolver, /apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
});

test("Roof Designer remains a safety fallback, not the primary DP2 workflow", () => {
  assert.match(autoEngine, /generateRoofDesignerDp2/);
  assert.match(fallback, /Dp2RoofDesignerRequiredError/);
  assert.match(fallback, /manualRoofDesign/);
  assert.match(designer, /metricSurfaceFromManualRoofDesign/);
  assert.match(designer, /webMercatorGroundScale/);
  assert.match(designer, /Math\.cos\(frame\.latitude/);
});
