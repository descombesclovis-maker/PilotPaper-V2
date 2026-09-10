import assert from "node:assert/strict";
import test, { after } from "node:test";
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

const modulePromise = vite.ssrLoadModule("/lib/dp-ai-engine/geometry/panelProjection.ts");

function context(modulePlacementsMm) {
  return {
    projectId: "physical-sot",
    address: "test",
    panel: { model: "Model X", widthMm: 1000, heightMm: 2000, powerWp: 500 },
    array: {
      rows: 1,
      columns: 2,
      orientation: "portrait",
      roofFace: "A",
      placement: "centered",
      interPanelGapMm: 20,
    },
    exactPanelCount: 2,
    fieldWidthMm: 2020,
    fieldHeightMm: 2000,
    roof: {
      selectedFaceDescription: "Pan A",
      confidence: 1,
      obstacles: [],
      perspectiveNotes: [],
      uncertainties: [],
      views: [],
    },
    facePlacements: [{
      faceId: "A",
      panelCount: 2,
      rows: 1,
      columns: 2,
      lastRowCount: 2,
      resolvedGutterMm: 300,
      resolvedLeftMm: 990,
      resolvedRightMm: 990,
      widthMm: 4000,
      slopeLengthMm: 4000,
      modulePlacementsMm,
    }],
    immutableFacts: [],
  };
}

const authoritativeModules = [
  {
    index: 0,
    faceId: "A",
    row: 0,
    column: 0,
    polygonMm: [
      { xMm: 100, yMm: 600 },
      { xMm: 1100, yMm: 600 },
      { xMm: 1100, yMm: 2600 },
      { xMm: 100, yMm: 2600 },
    ],
  },
  {
    index: 1,
    faceId: "A",
    row: 0,
    column: 1,
    polygonMm: [
      { xMm: 1120, yMm: 600 },
      { xMm: 2120, yMm: 600 },
      { xMm: 2120, yMm: 2600 },
      { xMm: 1120, yMm: 2600 },
    ],
  },
];

const identityView = {
  role: "near",
  faceId: "A",
  selectedFaceVisible: true,
  confidence: 1,
  roofPolygonNormalized: [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 0 },
    { x: 0, y: 0 },
  ],
  perspectiveNotes: [],
};

test("production projection consumes exact physical module polygons instead of reconstructing rows", async () => {
  const { panelPolygonsForView } = await modulePromise;
  const polygons = panelPolygonsForView(context(authoritativeModules), identityView);
  assert.ok(polygons);
  assert.equal(polygons.length, 2);

  // The authoritative first module begins at x=100 mm, y=600 mm. If the
  // legacy row reconstruction were used it would begin near x=990 mm, y=300 mm.
  assert.ok(Math.abs(polygons[0][0].x - 0.025) < 1e-10);
  assert.ok(Math.abs(polygons[0][0].y - 0.85) < 1e-10);
  assert.ok(Math.abs(polygons[0][2].x - 0.275) < 1e-10);
  assert.ok(Math.abs(polygons[0][2].y - 0.35) < 1e-10);
});

test("the same physical modules remain the source of truth across two camera views", async () => {
  const { panelPolygonsForView, projectivePointInQuad } = await modulePromise;
  const obliqueView = {
    ...identityView,
    role: "roof",
    roofPolygonNormalized: [
      { x: 0.08, y: 0.9 },
      { x: 0.94, y: 0.78 },
      { x: 0.7, y: 0.14 },
      { x: 0.3, y: 0.2 },
    ],
  };
  const polygons = panelPolygonsForView(context(authoritativeModules), obliqueView);
  assert.ok(polygons);
  assert.equal(polygons.length, 2);

  const expected = projectivePointInQuad(obliqueView.roofPolygonNormalized, 100 / 4000, 600 / 4000);
  assert.ok(Math.abs(polygons[0][0].x - expected.x) < 1e-10);
  assert.ok(Math.abs(polygons[0][0].y - expected.y) < 1e-10);
});

test("an invalid authoritative physical set fails closed instead of falling back to row reconstruction", async () => {
  const { panelPolygonsForView } = await modulePromise;
  const polygons = panelPolygonsForView(context(authoritativeModules.slice(0, 1)), identityView);
  assert.equal(polygons, undefined);
});
