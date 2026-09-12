import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dp1 = await readFile(new URL("../lib/dp1-engine.ts", import.meta.url), "utf8");
const entry = await readFile(new URL("../lib/dp2-v1-engine.ts", import.meta.url), "utf8");
const dp2 = await readFile(new URL("../lib/dp2-google-solar-engine.ts", import.meta.url), "utf8");
const fallback = await readFile(new URL("../lib/dp2-roof-designer-engine.ts", import.meta.url), "utf8");
const parcel = await readFile(new URL("../lib/dp-ai-engine/context/officialParcel.ts", import.meta.url), "utf8");
const google = await readFile(new URL("../lib/dp-ai-engine/providers/googleSolar.ts", import.meta.url), "utf8");
const target = await readFile(new URL("../lib/dp-ai-engine/site-model/targetPropertyResolver.ts", import.meta.url), "utf8");
const safeCells = await readFile(new URL("../lib/dp-ai-engine/site-model/googleSolarAutomaticRoof.ts", import.meta.url), "utf8");
const designer = await readFile(new URL("../lib/dp-ai-engine/site-model/manualRoofDesigner.ts", import.meta.url), "utf8");
const siteModel = await readFile(new URL("../lib/dp-ai-engine/site-model/siteModelEngine.ts", import.meta.url), "utf8");
const roadmap = await readFile(new URL("../V1-K-PAR-K.md", import.meta.url), "utf8");

test("DP1 keeps reusable official parcel context while DP2 can correct target parcel from physical building center", () => {
  assert.match(dp1, /resolveOfficialParcelContext/);
  assert.match(parcel, /resolveOfficialParcelContext/);
  assert.match(dp2, /resolveOfficialParcelContext/);
  assert.match(dp2, /resolveTargetParcelFromBuildingCenter/);
  assert.match(target, /buildingCenter/);
  assert.match(target, /APICARTO|apicarto/i);
  assert.doesNotMatch(dp1, /apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
});

test("DP2 automatic critical path is Google Solar safe cells before deterministic layout", () => {
  assert.match(entry, /dp2-google-solar-engine/);
  assert.match(dp2, /fetchGoogleSolarBuildingInsights/);
  assert.match(dp2, /automaticRoofDesignFromGoogleSolar/);
  assert.match(dp2, /resolveProjectLayout/);
  assert.match(google, /solarPanels/);
  assert.match(google, /roofSegmentStats/);
  assert.match(safeCells, /rectangleCells/);
  assert.match(safeCells, /moduleWidthMeters/);
  assert.match(safeCells, /moduleHeightMeters/);
  assert.doesNotMatch(dp2, /resolveCrossViewSurfaceIdentity/);
});

test("Roof Designer remains the deterministic recovery path and derives true ground metric support", () => {
  assert.match(dp2, /generateRoofDesignerDp2/);
  assert.match(fallback, /manualRoofDesign/);
  assert.match(designer, /MetricFrame/);
  assert.match(designer, /webMercatorGroundScale/);
  assert.match(designer, /surfacePolygonMm/);
  assert.match(designer, /obstaclePolygonsMm/);
});

test("experimental LiDAR SiteModel stays isolated and cannot block automatic Google Solar DP2", () => {
  assert.match(siteModel, /buildAutomaticSiteModelFromParcel/);
  assert.doesNotMatch(dp2, /siteModelEngine/);
  assert.doesNotMatch(dp2, /samplePolygonLidarHeights|buildRoofModelFromLidar/);
});

test("roadmap explicitly forbids document-specific copies of engine-level rules", () => {
  assert.match(roadmap, /Règle de promotion obligatoire/);
  assert.match(roadmap, /engine-level/);
  assert.match(roadmap, /Une pièce ne peut pas être déclarée validée/);
});

test("roadmap makes Google Solar AUTO primary and Roof Designer fallback", () => {
  assert.match(roadmap, /Google Solar API — fournisseur AUTO primaire/);
  assert.match(roadmap, /Roof Designer — fallback de sécurité/);
  assert.match(roadmap, /aucun clic utilisateur obligatoire lorsque le fournisseur AUTO réussit/i);
  assert.match(roadmap, /LiDAR.*optionnel|optionnel.*LiDAR/i);
  assert.match(roadmap, /OpenAI n'est pas une source métrique/);
});

test("roadmap freezes launcher and updater work while the engine is under validation", () => {
  assert.match(roadmap, /Gel des sujets périphériques/);
  assert.match(roadmap, /aucune amélioration esthétique du launcher/);
  assert.match(roadmap, /La priorité est le moteur/);
});
