import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const vision = await readFile(new URL("../lib/dp-ai-engine/providers/openaiVision.ts", import.meta.url), "utf8");
const jsonProvider = await readFile(new URL("../lib/dp-ai-engine/providers/openaiJson.ts", import.meta.url), "utf8");

test("vision evidence images carry authoritative roles instead of relying on model inference", () => {
  assert.match(vision, /AUTHORITATIVE IMAGE INVENTORY/);
  assert.match(vision, /AUTHORITATIVE ROLE/);
  assert.match(vision, /imageLabels:photos\.map\(imageLabel\)/);
  assert.match(jsonProvider, /imageLabels\?: string\[\]/);
  assert.match(jsonProvider, /params\.imageLabels\?\.\[index\]/);
});

test("metric roof understanding accepts richer polygons and reconstructs a quad automatically", () => {
  assert.match(vision, /canonicalizeRoofFaceQuad/);
  assert.match(vision, /gutter&&ridge/);
  assert.match(vision, /orientedBoxFromPolygon/);
  assert.doesNotMatch(vision, /roofPolygonNormalized\.length===4/);
});

test("missing first-pass metric geometry triggers a targeted automatic recovery pass", () => {
  assert.match(vision, /AUTOMATIC METRIC RECOVERY PASS/);
  assert.match(vision, /const recoveryPhotos=\[satMass,roof\]/);
  assert.match(vision, /await this\.inspect\(form,recoveryPhotos,true\)/);
  assert.match(vision, /recoveredMetric\.length/);
});
