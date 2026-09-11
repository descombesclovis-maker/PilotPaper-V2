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

const modulePromise = vite.ssrLoadModule("/lib/dp2-v1-engine.ts");
const engineSource = await readFile(new URL("../lib/dp2-v1-engine.ts", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../app/api/dp-piece/route.ts", import.meta.url), "utf8");

const parcel = [
  { x: 0.10, y: 0.10 },
  { x: 0.90, y: 0.10 },
  { x: 0.90, y: 0.90 },
  { x: 0.10, y: 0.90 },
];

function identity(overrides = {}) {
  return {
    sameBuilding: true,
    sameRoofPlane: true,
    confidence: 0.94,
    slopeDeg: 30,
    slopeConfidence: 0.88,
    metricPlane: {
      polygonNormalized: [
        { x: 0.30, y: 0.70 },
        { x: 0.65, y: 0.70 },
        { x: 0.62, y: 0.40 },
        { x: 0.33, y: 0.40 },
      ],
      gutterLineNormalized: [{ x: 0.30, y: 0.70 }, { x: 0.65, y: 0.70 }],
      ridgeLineNormalized: [{ x: 0.33, y: 0.40 }, { x: 0.62, y: 0.40 }],
    },
    roofPlane: {
      polygonNormalized: [
        { x: 0.18, y: 0.82 },
        { x: 0.88, y: 0.72 },
        { x: 0.66, y: 0.24 },
        { x: 0.30, y: 0.28 },
      ],
      gutterLineNormalized: [{ x: 0.18, y: 0.82 }, { x: 0.88, y: 0.72 }],
      ridgeLineNormalized: [{ x: 0.30, y: 0.28 }, { x: 0.66, y: 0.24 }],
    },
    evidence: {
      parcelPositionConsistent: true,
      roofShapeConsistent: true,
      ridgeEaveAxisConsistent: true,
      obstaclePatternConsistent: false,
      annexContextConsistent: false,
    },
    obstacles: [],
    notes: [],
    ...overrides,
  };
}

test("DP2 accepts a demonstrated same physical roof plane inside the official parcel", async () => {
  const { validateDp2CrossViewIdentity } = await modulePromise;
  assert.deepEqual(validateDp2CrossViewIdentity(identity(), parcel), []);
});

test("DP2 rejects an apparently plausible roof plane whose metric centroid is outside the official parcel", async () => {
  const { validateDp2CrossViewIdentity } = await modulePromise;
  const candidate = identity({
    metricPlane: {
      polygonNormalized: [
        { x: 0.91, y: 0.70 },
        { x: 0.99, y: 0.70 },
        { x: 0.99, y: 0.40 },
        { x: 0.91, y: 0.40 },
      ],
      gutterLineNormalized: [{ x: 0.91, y: 0.70 }, { x: 0.99, y: 0.70 }],
      ridgeLineNormalized: [{ x: 0.91, y: 0.40 }, { x: 0.99, y: 0.40 }],
    },
  });
  const issues = validateDp2CrossViewIdentity(candidate, parcel);
  assert.ok(issues.some((issue) => issue.includes("hors de la parcelle")));
});

test("DP2 refuses a cross-view match supported by fewer than two independent visual cues", async () => {
  const { validateDp2CrossViewIdentity } = await modulePromise;
  const candidate = identity({
    evidence: {
      parcelPositionConsistent: true,
      roofShapeConsistent: true,
      ridgeEaveAxisConsistent: false,
      obstaclePatternConsistent: false,
      annexContextConsistent: false,
    },
  });
  const issues = validateDp2CrossViewIdentity(candidate, parcel);
  assert.ok(issues.some((issue) => issue.includes("deux indices visuels")));
});

test("isolated DP2 is routed through the dedicated identity engine, not the legacy all-in-one analyzer", () => {
  assert.match(routeSource, /@\/lib\/dp2-v1-engine/);
  assert.match(engineSource, /dp2_cross_view_identity/);
  assert.match(engineSource, /dp2_cross_view_identity_recovery/);
  assert.match(engineSource, /resolveCrossViewIdentity/);
  assert.match(engineSource, /validateDp2CrossViewIdentity/);
  assert.match(engineSource, /pointInPolygon/);
  assert.match(engineSource, /resolveProjectLayout/);
  assert.ok(engineSource.indexOf("resolveCrossViewIdentity") < engineSource.lastIndexOf("resolveProjectLayout"));
});
