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
const dp2Source = await readFile(new URL("../lib/dp2-v1-engine.ts", import.meta.url), "utf8");

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

test("dedicated legacy obstacle engine still scans a locked face systematically and audits completeness", () => {
  assert.match(obstacleSource, /Surface Obstacle Census Engine/);
  assert.match(obstacleSource, /LEFT -> CENTER -> RIGHT/);
  assert.match(obstacleSource, /GUTTER -> MID-SLOPE -> RIDGE/);
  assert.match(obstacleSource, /INDEPENDENT Surface Obstacle Audit Engine/);
  assert.match(obstacleSource, /coverageConfidence/);
  assert.match(obstacleSource, /rejectedCandidateIds/);
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

test("small slender obstacle intersecting the selected face is retained for metric projection", async () => {
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
  assert.equal(result[0].type, "antenna_mast");
  assert.ok(result[0].roofPolygonNormalized.length >= 3);
});

test("duplicate detections are collapsed inside the legacy visual audit", async () => {
  const { finalizeSurfaceObstacleCandidates } = await obstacleModulePromise;
  const candidates = [
    {
      id: "O1",
      type: "vent",
      description: "Vent first pass",
      confidence: 0.82,
      roofPolygonNormalized: [
        { x: 0.45, y: 0.5 }, { x: 0.49, y: 0.5 }, { x: 0.49, y: 0.55 }, { x: 0.45, y: 0.55 },
      ],
      metricPolygonNormalized: null,
    },
    {
      id: "A1",
      type: "vent",
      description: "Vent audit",
      confidence: 0.94,
      roofPolygonNormalized: [
        { x: 0.448, y: 0.498 }, { x: 0.492, y: 0.498 }, { x: 0.492, y: 0.552 }, { x: 0.448, y: 0.552 },
      ],
      metricPolygonNormalized: null,
    },
  ];
  assert.equal(finalizeSurfaceObstacleCandidates(candidates, identity).length, 1);
});

test("DP2 primary geometry path cannot invoke the legacy visual obstacle engine", () => {
  assert.doesNotMatch(dp2Source, /resolveSurfaceObstacleInventory/);
  assert.doesNotMatch(dp2Source, /surfaceObstacleEngine/);
  assert.match(dp2Source, /Keepout Engine/);
  assert.match(dp2Source, /buildAssistedSiteModelFromParcel/);
});
