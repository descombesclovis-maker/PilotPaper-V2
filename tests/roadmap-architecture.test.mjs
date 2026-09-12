import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dp1 = await readFile(new URL("../lib/dp1-engine.ts", import.meta.url), "utf8");
const dp2 = await readFile(new URL("../lib/dp2-roof-designer-engine.ts", import.meta.url), "utf8");
const parcel = await readFile(new URL("../lib/dp-ai-engine/context/officialParcel.ts", import.meta.url), "utf8");
const designer = await readFile(new URL("../lib/dp-ai-engine/site-model/manualRoofDesigner.ts", import.meta.url), "utf8");
const siteModel = await readFile(new URL("../lib/dp-ai-engine/site-model/siteModelEngine.ts", import.meta.url), "utf8");
const roadmap = await readFile(new URL("../V1-K-PAR-K.md", import.meta.url), "utf8");

test("DP1 and DP2 share one official parcel truth", () => {
  assert.match(dp1, /resolveOfficialParcelContext/);
  assert.match(dp2, /resolveOfficialParcelContext/);
  assert.match(parcel, /adresse -> parcelle|address|parcel/i);
  assert.doesNotMatch(dp1, /apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
  assert.doesNotMatch(dp2, /apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
});

test("DP2 consumes reviewed Roof Designer geometry before deterministic layout", () => {
  assert.match(dp2, /metricSurfaceFromManualRoofDesign/);
  assert.match(dp2, /manualRoofDesign/);
  assert.match(dp2, /resolveProjectLayout/);
  assert.doesNotMatch(dp2, /buildAutomaticSiteModelFromParcel/);
  assert.doesNotMatch(dp2, /buildAssistedSiteModelFromParcel/);
  assert.doesNotMatch(dp2, /resolveCrossViewSurfaceIdentity/);
});

test("manual Roof Designer derives metric support and keepouts from the IGN frame", () => {
  assert.match(designer, /MetricFrame/);
  assert.match(designer, /surfacePolygonMm/);
  assert.match(designer, /obstaclePolygonsMm/);
  assert.match(designer, /slopeDeg/);
});

test("experimental automatic SiteModel remains isolated and cannot block DP2", () => {
  assert.match(siteModel, /buildAutomaticSiteModelFromParcel/);
  assert.doesNotMatch(dp2, /siteModelEngine/);
});

test("roadmap explicitly forbids document-specific copies of engine-level rules", () => {
  assert.match(roadmap, /Règle de promotion obligatoire/);
  assert.match(roadmap, /engine-level/);
  assert.match(roadmap, /Une pièce ne peut pas être déclarée validée/);
});

test("roadmap makes reviewed geometry the reliable path and automatic providers optional", () => {
  assert.match(roadmap, /Roof Designer/);
  assert.match(roadmap, /LiDAR.*optionnel|optionnel.*LiDAR/i);
  assert.match(roadmap, /Google Solar API/i);
  assert.match(roadmap, /ne doit jamais bloquer/i);
});

test("roadmap freezes launcher and updater work while the engine is under validation", () => {
  assert.match(roadmap, /Gel des sujets périphériques/);
  assert.match(roadmap, /aucune amélioration esthétique du launcher/);
  assert.match(roadmap, /La priorité est le moteur/);
});
