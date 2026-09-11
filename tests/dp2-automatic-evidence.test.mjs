import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const gate = await readFile(new URL("../lib/dp-ai-engine/geometry/surfaceSupport.ts", import.meta.url), "utf8");
const vision = await readFile(new URL("../lib/dp-ai-engine/providers/openaiVision.ts", import.meta.url), "utf8");
const prompt = await readFile(new URL("../lib/dp-ai-engine/prompts/projectAnalysis.ts", import.meta.url), "utf8");
const dp2 = await readFile(new URL("../lib/dp2-engine.ts", import.meta.url), "utf8");

test("isolated DP2 uses one roof photo plus metric IGN evidence instead of near+roof", () => {
  assert.match(dp2, /new OpenAIVisionAnalyzer\(config\.openaiApiKey, config\.analysisModel, 1\)/);
  assert.match(vision, /requiredRealRoles:\["roof"\]/);
  assert.match(vision, /minimumRealPhotoObservations:1/);
  assert.match(gate, /SurfaceEvidencePolicy/);
  assert.doesNotMatch(gate, /for \(const role of \["near", "roof"\] as const\)/);
});

test("roof-only obstacles are transferred to the metric IGN face instead of ignored", () => {
  assert.match(vision, /reprojectObstaclesToMetric/);
  assert.match(vision, /projectiveCoordinatesInQuad/);
  assert.match(vision, /projectivePointInQuad/);
  assert.match(vision, /viewRole:"satellite_mass" as const/);
  assert.match(gate, /requireMetricObstacleFootprints/);
});

test("rich roof outlines are canonicalized before layout and gating", () => {
  assert.match(vision, /canonicalizeRoofFaceQuad/);
  assert.match(vision, /canonicalizeFaceEvidence/);
  assert.match(vision, /faces=reprojectObstaclesToMetric\(canonicalizeFaceEvidence\(faces\)\)/);
});

test("DP2 anchors metric roof recognition to the official cadastral parcel", () => {
  assert.match(dp2, /https:\/\/apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
  assert.match(dp2, /metricFrameForParcel/);
  assert.match(dp2, /vue métrique rapprochée IGN centrée sur la parcelle/);
  assert.match(dp2, /analyzer\.analyze\(form, \[ign\.mass, roofPhoto\]\)/);
  assert.doesNotMatch(dp2, /analyzer\.analyze\(form, \[ign\.situation/);
});

test("vision prompt must preserve the same physical roof-face identity across camera roles", () => {
  assert.match(prompt, /SAME physical building and the SAME physical roof plane/);
  assert.match(prompt, /MUST keep one identical face ID across those views/);
  assert.match(prompt, /Ignore neighboring roofs/);
});
