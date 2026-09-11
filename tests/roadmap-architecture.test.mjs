import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dp1 = await readFile(new URL("../lib/dp1-engine.ts", import.meta.url), "utf8");
const dp2 = await readFile(new URL("../lib/dp2-v1-engine.ts", import.meta.url), "utf8");
const parcel = await readFile(new URL("../lib/dp-ai-engine/context/officialParcel.ts", import.meta.url), "utf8");
const siteModel = await readFile(new URL("../lib/dp-ai-engine/site-model/siteModelEngine.ts", import.meta.url), "utf8");
const lidar = await readFile(new URL("../lib/dp-ai-engine/site-model/lidarAltimetry.ts", import.meta.url), "utf8");
const roofGeometry = await readFile(new URL("../lib/dp-ai-engine/site-model/roofGeometryEngine.ts", import.meta.url), "utf8");
const roadmap = await readFile(new URL("../V1-K-PAR-K.md", import.meta.url), "utf8");

test("DP1 and DP2 share one official parcel truth", () => {
  assert.match(dp1, /resolveOfficialParcelContext/);
  assert.match(dp2, /resolveOfficialParcelContext/);
  assert.match(parcel, /adresse -> parcelle|address|parcel/i);
  assert.doesNotMatch(dp1, /apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
  assert.doesNotMatch(dp2, /apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
});

test("DP2 consumes SiteModel geometry before deterministic layout", () => {
  assert.match(dp2, /buildAutomaticSiteModelFromParcel/);
  assert.match(dp2, /buildAssistedSiteModelFromParcel/);
  assert.match(dp2, /metricSurfaceFromSitePlane/);
  assert.match(dp2, /resolveProjectLayout/);
  assert.doesNotMatch(dp2, /resolveCrossViewSurfaceIdentity/);
  assert.doesNotMatch(dp2, /metricSurfaceFromIdentity/);
  assert.doesNotMatch(dp2, /resolveSurfaceObstacleInventory/);
});

test("SiteModel geometry is grounded in official context LiDAR and deterministic roof mathematics", () => {
  assert.match(siteModel, /resolveTargetBuilding/);
  assert.match(siteModel, /buildRoofModelFromLidar/);
  assert.match(lidar, /LiDAR|MNX|altim/i);
  assert.match(roofGeometry, /extractPlaneRansac/);
  assert.match(roofGeometry, /deriveLidarObstacles/);
});

test("roadmap explicitly forbids document-specific copies of engine-level rules", () => {
  assert.match(roadmap, /Règle de promotion obligatoire/);
  assert.match(roadmap, /engine-level/);
  assert.match(roadmap, /Une pièce ne peut pas être déclarée validée/);
});

test("roadmap freezes launcher and updater work while the engine is under validation", () => {
  assert.match(roadmap, /Gel des sujets périphériques/);
  assert.match(roadmap, /aucune amélioration esthétique du launcher/);
  assert.match(roadmap, /aucune nouvelle fonction updater/);
  assert.match(roadmap, /La priorité est le moteur/);
});

test("roadmap defines an explicit strategy-switch trigger instead of endless patching", () => {
  assert.match(roadmap, /Critère de changement de stratégie/);
  assert.match(roadmap, /plusieurs cas V1 simples/);
  assert.match(roadmap, /on arrête les patchs du pipeline actuel/);
});
