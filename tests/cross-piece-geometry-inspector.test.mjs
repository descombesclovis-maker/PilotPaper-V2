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

const inspectorPromise = vite.ssrLoadModule("/lib/dp-ai-engine/quality/crossPieceGeometryInspector.ts");

const modules = [
  {
    index: 0,
    faceId: "A",
    row: 0,
    column: 0,
    polygonMm: [
      { xMm: 500, yMm: 500 }, { xMm: 1500, yMm: 500 }, { xMm: 1500, yMm: 2500 }, { xMm: 500, yMm: 2500 },
    ],
  },
  {
    index: 1,
    faceId: "A",
    row: 0,
    column: 1,
    polygonMm: [
      { xMm: 1520, yMm: 500 }, { xMm: 2520, yMm: 500 }, { xMm: 2520, yMm: 2500 }, { xMm: 1520, yMm: 2500 },
    ],
  },
];

function context(overrides = {}) {
  const views = ["near", "roof"].map((role) => ({
    role,
    faceId: "A",
    selectedFaceVisible: true,
    confidence: 1,
    roofPolygonNormalized: [
      { x: 0.1, y: 0.9 }, { x: 0.9, y: 0.8 }, { x: 0.75, y: 0.1 }, { x: 0.25, y: 0.15 },
    ],
    perspectiveNotes: [],
  }));
  return {
    projectId: "cross-piece",
    address: "test",
    panel: { model: "module", widthMm: 1000, heightMm: 2000 },
    array: { rows: 1, columns: 2, orientation: "portrait", roofFace: "A", placement: "centered" },
    exactPanelCount: 2,
    fieldWidthMm: 2020,
    fieldHeightMm: 2000,
    facePlacements: [{
      faceId: "A",
      panelCount: 2,
      rows: 1,
      columns: 2,
      lastRowCount: 2,
      resolvedGutterMm: 500,
      resolvedRidgeMm: 1500,
      resolvedLeftMm: 500,
      resolvedRightMm: 1480,
      widthMm: 4000,
      slopeLengthMm: 4000,
      modulePlacementsMm: modules,
    }],
    roof: {
      selectedFaceDescription: "Pan A",
      confidence: 1,
      obstacles: [],
      perspectiveNotes: [],
      uncertainties: [],
      views,
    },
    immutableFacts: [],
    ...overrides,
  };
}

function assets(dp5Text = '<polygon data-module-index="0"/><polygon data-module-index="1"/>') {
  return [
    { dp: 4, kind: "image", mimeType: "image/png", base64: "x", attempt: 1, sourceRole: "roof" },
    { dp: 5, kind: "svg", mimeType: "image/svg+xml", text: dp5Text, attempt: 1 },
    { dp: 6, kind: "image", mimeType: "image/png", base64: "x", attempt: 1, sourceRole: "near" },
  ];
}

test("passes when DP4 DP5 and DP6 trace to one complete physical module identity set", async () => {
  const { inspectCrossPieceGeometry } = await inspectorPromise;
  const result = inspectCrossPieceGeometry(context(), assets());
  assert.equal(result.passed, true);
  assert.equal(result.physicalModuleCount, 2);
  assert.deepEqual(result.issues, []);
});

test("rejects DP5 when one physical module identity is missing", async () => {
  const { inspectCrossPieceGeometry } = await inspectorPromise;
  const result = inspectCrossPieceGeometry(context(), assets('<polygon data-module-index="0"/>'));
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.code === "DP5_MODULE_IDENTITY_MISMATCH"));
});

test("rejects incomplete persisted physical geometry before visual consistency can be trusted", async () => {
  const { inspectCrossPieceGeometry } = await inspectorPromise;
  const brokenContext = context({
    facePlacements: [{
      ...context().facePlacements[0],
      modulePlacementsMm: modules.slice(0, 1),
    }],
  });
  const result = inspectCrossPieceGeometry(brokenContext, assets());
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.code === "PHYSICAL_LAYOUT_NOT_AUTHORITATIVE"));
});
