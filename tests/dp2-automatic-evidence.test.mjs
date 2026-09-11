import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const gate = await readFile(new URL("../lib/dp-ai-engine/geometry/surfaceSupport.ts", import.meta.url), "utf8");
const vision = await readFile(new URL("../lib/dp-ai-engine/providers/openaiVision.ts", import.meta.url), "utf8");
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
