import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engine = await readFile(new URL("../lib/dp2-v1-engine.ts", import.meta.url), "utf8");
const parcel = await readFile(new URL("../lib/dp-ai-engine/context/officialParcel.ts", import.meta.url), "utf8");
const identity = await readFile(new URL("../lib/dp-ai-engine/identity/crossViewSurfaceIdentity.ts", import.meta.url), "utf8");
const metric = await readFile(new URL("../lib/dp-ai-engine/geometry/metricSurfaceFromIdentity.ts", import.meta.url), "utf8");

test("DP2 anchors roof recognition to one official parcel context before any layout", () => {
  assert.match(engine, /resolveOfficialParcelContext/);
  assert.match(engine, /metricFrameForParcel/);
  assert.match(engine, /projectParcelRingNormalized/);
  assert.ok(engine.indexOf("resolveDp2OfficialContext") < engine.indexOf("resolveCrossViewSurfaceIdentity"));
  assert.ok(engine.indexOf("resolveCrossViewSurfaceIdentity") < engine.lastIndexOf("resolveProjectLayout"));
});

test("official parcel logic lives in the reusable core rather than the DP2 document engine", () => {
  assert.match(parcel, /https:\/\/apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
  assert.match(parcel, /resolveOfficialParcelContext/);
  assert.doesNotMatch(engine, /apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
  assert.doesNotMatch(engine, /geocodage\/reverse/);
});

test("cross-view identity uses deterministic evidence and a fail-closed recovery pass", () => {
  assert.match(identity, /sameBuilding/);
  assert.match(identity, /sameRoofPlane/);
  assert.match(identity, /minimumIndependentVisualCues/);
  assert.match(identity, /cross_view_surface_identity_recovery/);
  assert.match(identity, /do not lower confidence thresholds/);
});

test("roof-only obstacles are transferred through a shared projective metric reconstruction", () => {
  assert.match(metric, /reprojectPolygonBetweenQuads/);
  assert.match(metric, /projectivePointInQuad/);
  assert.match(metric, /metricSurfaceFromIdentity/);
  assert.match(metric, /obstaclePolygonsMm/);
});

test("DP2 document engine is now orchestration/rendering, not another roof-understanding implementation", () => {
  assert.match(engine, /resolveCrossViewSurfaceIdentity/);
  assert.match(engine, /metricSurfaceFromIdentity/);
  assert.doesNotMatch(engine, /identitySchema\s*=/);
  assert.doesNotMatch(engine, /function projectiveCoefficients/);
  assert.doesNotMatch(engine, /function metricBasis/);
});
