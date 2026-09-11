import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engine = await readFile(new URL("../lib/dp2-v1-engine.ts", import.meta.url), "utf8");
const parcel = await readFile(new URL("../lib/dp-ai-engine/context/officialParcel.ts", import.meta.url), "utf8");
const identity = await readFile(new URL("../lib/dp-ai-engine/identity/crossViewSurfaceIdentity.ts", import.meta.url), "utf8");
const metric = await readFile(new URL("../lib/dp-ai-engine/geometry/metricSurfaceFromIdentity.ts", import.meta.url), "utf8");

test("DP2 anchors one official parcel before SiteModel geometry and any fallback layout", () => {
  assert.match(engine, /resolveOfficialParcelContext/);
  assert.match(engine, /metricFrameForParcel/);
  assert.match(engine, /projectParcelRingNormalized/);

  const generatorStart = engine.indexOf("export async function generateDp2Piece");
  assert.ok(generatorStart >= 0);
  const generator = engine.slice(generatorStart);
  const officialCall = generator.indexOf("const official = await resolveDp2OfficialContext");
  const siteModelCall = generator.indexOf("buildAutomaticSiteModelFromParcel(official)");
  const legacyCall = generator.indexOf("generateWithLegacyVision(input, form, official, reason)");
  assert.ok(officialCall >= 0 && siteModelCall > officialCall);
  assert.ok(legacyCall > siteModelCall);

  assert.match(engine, /function buildProjectContextFromSiteModel[\s\S]*resolveLayoutContext/);
  assert.match(engine, /function buildLegacyProjectContext[\s\S]*resolveLayoutContext/);
});

test("official parcel logic lives in the reusable core rather than the DP2 document engine", () => {
  assert.match(parcel, /https:\/\/apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
  assert.match(parcel, /resolveOfficialParcelContext/);
  assert.doesNotMatch(engine, /apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
  assert.doesNotMatch(engine, /geocodage\/reverse/);
});

test("legacy cross-view identity remains a deterministic fail-closed fallback, not the primary metric source", () => {
  assert.match(identity, /sameBuilding/);
  assert.match(identity, /sameRoofPlane/);
  assert.match(identity, /minimumIndependentVisualCues/);
  assert.match(identity, /cross_view_surface_identity_recovery/);
  assert.match(identity, /do not lower confidence thresholds/);
  assert.match(engine, /SiteModel geometry-first — fallback déclenché/);
});

test("roof-only obstacles remain transferable through the legacy shared projective reconstruction", () => {
  assert.match(metric, /reprojectPolygonBetweenQuads/);
  assert.match(metric, /projectivePointInQuad/);
  assert.match(metric, /metricSurfaceFromIdentity/);
  assert.match(metric, /obstaclePolygonsMm/);
});

test("DP2 document engine orchestrates shared SiteModel and fallback bricks instead of implementing roof geometry", () => {
  assert.match(engine, /buildAutomaticSiteModelFromParcel/);
  assert.match(engine, /metricSurfaceFromSitePlane/);
  assert.match(engine, /resolveCrossViewSurfaceIdentity/);
  assert.match(engine, /metricSurfaceFromIdentity/);
  assert.doesNotMatch(engine, /identitySchema\s*=/);
  assert.doesNotMatch(engine, /function projectiveCoefficients/);
  assert.doesNotMatch(engine, /function metricBasis/);
});