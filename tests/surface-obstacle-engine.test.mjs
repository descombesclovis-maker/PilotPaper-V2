import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});
after(async () => { await vite.close(); });

const obstacleModulePromise = vite.ssrLoadModule("/lib/dp-ai-engine/obstacles/surfaceObstacleEngine.ts");
const obstacleSource = await readFile(new URL("../lib/dp-ai-engine/obstacles/surfaceObstacleEngine.ts", import.meta.url), "utf8");
const dp2Source = await readFile(new URL("../lib/dp2-roof-designer-engine.ts", import.meta.url), "utf8");
const manualSource = await readFile(new URL("../lib/dp-ai-engine/site-model/manualRoofDesigner.ts", import.meta.url), "utf8");

const identity = {
  sameBuilding: true,
  sameRoofPlane: true,
  confidence: 0.95,
  slopeDeg: 30,
  slopeConfidence: 0.9,
  metricPlane: {
    polygonNormalized: [
      { x: 0.2, y: 0.8 }, { x: 0.8, y: 0.8 }, { x: 0.75, y: 0.2 }, { x: 0.25, y: 0.2 },
    ],
    gutterLineNormalized: [{ x: 0.2, y: 0.8 }, { x: 0.8, y: 0.8 }],
    ridgeLineNormalized: [{ x: 0.25, y: 0.2 }, { x: 0.75, y: 0.2 }],
  },
  roofPlane: {
    polygonNormalized: [
      { x: 0.1, y: 0.85 }, { x: 0.9, y: 0.75 }, { x: 0.7, y: 0.15 }, { x: 0.3, y: 0.2 },
    ],
    gutterLineNormalized: [{ x: 0.1, y: 0.85 }, { x: 0.9, y: 0.75 }],
    ridgeLineNormalized: [{ x: 0.3, y: 0.2 }, { x: 0.7, y: 0.15 }],
  },
  evidence: {
    parcelPositionConsistent: true,
    roofShapeConsistent: true,
    ridgeEaveAxisConsistent: true,
    obstaclePatternConsistent: true,
    annexContextConsistent: false,
  },
  obstacles: [],
  notes: [],
};

test("legacy visual obstacle engine remains available only as a non-DP2 QA experiment", () => {
  assert.match(obstacleSource, /Surface Obstacle Census Engine/);
  assert.match(obstacleSource, /INDEPENDENT Surface Obstacle Audit Engine/);
  assert.match(obstacleSource, /coverageConfidence/);
});

test("contextual obstacle fully outside the locked roof plane is discarded deterministically", async () => {
  const { finalizeSurfaceObstacleCandidates } = await obstacleModulePromise;
  const candidates = [{
    id: "O1",
    type: "chimney",
    description: "Neighbour roof chimney",
    confidence: 0.98,
    roofPolygonNormalized: [
      { x: 0.92, y: 0.3 }, { x: 0.98, y: 0.3 }, { x: 0.98, y: 0.4 }, { x: 0.92, y: 0.4 },
    ],
    metricPolygonNormalized: null,
  }];
  assert.deepEqual(finalizeSurfaceObstacleCandidates(candidates, identity), []);
});

test("small slender obstacle intersecting the selected face is retained by the legacy audit", async () => {
  const { finalizeSurfaceObstacleCandidates } = await obstacleModulePromise;
  const candidates = [{
    id: "O1",
    type: "antenna_mast",
    description: "Thin antenna base near ridge",
    confidence: 0.91,
    roofPolygonNormalized: [
      { x: 0.39, y: 0.23 }, { x: 0.405, y: 0.228 }, { x: 0.407, y: 0.27 }, { x: 0.392, y: 0.272 },
    ],
    metricPolygonNormalized: null,
  }];
  const result = finalizeSurfaceObstacleCandidates(candidates, identity);
  assert.equal(result.length, 1);
});

test("DP2 uses explicit reviewed keepouts instead of visual obstacle inference", () => {
  assert.doesNotMatch(dp2Source, /resolveSurfaceObstacleInventory|surfaceObstacleEngine/);
  assert.match(dp2Source, /Keepout Designer/);
  assert.match(dp2Source, /manualRoofDesign/);
  assert.match(manualSource, /obstaclePolygonsMm/);
  assert.match(manualSource, /Keepout validé par l'utilisateur/);
});
