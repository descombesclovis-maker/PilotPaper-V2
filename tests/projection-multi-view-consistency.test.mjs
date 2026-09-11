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

const physicalModules = [
  {
    index: 0,
    faceId: "A",
    row: 0,
    column: 0,
    polygonMm: [
      { xMm: 900, yMm: 600 },
      { xMm: 1900, yMm: 600 },
      { xMm: 1900, yMm: 2600 },
      { xMm: 900, yMm: 2600 },
    ],
  },
  {
    index: 1,
    faceId: "A",
    row: 0,
    column: 1,
    polygonMm: [
      { xMm: 1920, yMm: 600 },
      { xMm: 2920, yMm: 600 },
      { xMm: 2920, yMm: 2600 },
      { xMm: 1920, yMm: 2600 },
    ],
  },
];

const views = [
  {
    role: "front",
    faceId: "A",
    selectedFaceVisible: true,
    confidence: 1,
    roofPolygonNormalized: [
      { x: 0.12, y: 0.82 }, { x: 0.88, y: 0.82 }, { x: 0.78, y: 0.18 }, { x: 0.22, y: 0.18 },
    ],
    perspectiveNotes: [],
  },
  {
    role: "left_oblique",
    faceId: "A",
    selectedFaceVisible: true,
    confidence: 1,
    roofPolygonNormalized: [
      { x: 0.08, y: 0.88 }, { x: 0.92, y: 0.72 }, { x: 0.67, y: 0.12 }, { x: 0.30, y: 0.23 },
    ],
    perspectiveNotes: [],
  },
  {
    role: "near",
    faceId: "A",
    selectedFaceVisible: true,
    confidence: 1,
    roofPolygonNormalized: [
      { x: 0.04, y: 0.94 }, { x: 0.96, y: 0.64 }, { x: 0.58, y: 0.06 }, { x: 0.36, y: 0.17 },
    ],
    perspectiveNotes: [],
  },
];

function context() {
  return {
    projectId: "multi-view-consistency",
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
      resolvedGutterMm: 600,
      resolvedRidgeMm: 1400,
      resolvedLeftMm: 900,
      resolvedRightMm: 1080,
      widthMm: 4000,
      slopeLengthMm: 4000,
      modulePlacementsMm: physicalModules,
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
  };
}

function polygonArea(poly) {
  let value = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    value += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return Math.abs(value) / 2;
}

function close(actual, expected, tolerance = 1e-10) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) {
    assert.ok(Math.abs(actual[i].x - expected[i].x) <= tolerance);
    assert.ok(Math.abs(actual[i].y - expected[i].y) <= tolerance);
  }
}

test("front, oblique and strong-perspective views all project the same physical module corners", async () => {
  const { panelPolygonsForView, projectivePointInQuad } = await modulePromise;
  const c = context();
  for (const view of views) {
    const projected = panelPolygonsForView(c, view);
    assert.ok(projected);
    assert.equal(projected.length, physicalModules.length);
    for (let index = 0; index < physicalModules.length; index++) {
      const expected = physicalModules[index].polygonMm.map((point) =>
        projectivePointInQuad(view.roofPolygonNormalized, point.xMm / 4000, point.yMm / 4000),
      );
      close(projected[index], expected);
      assert.ok(polygonArea(projected[index]) > 1e-6);
    }
  }
});

test("role projection keeps the same exact module count for every usable camera", async () => {
  const { allPanelPolygonsForRole } = await modulePromise;
  const c = context();
  for (const role of ["front", "left_oblique", "near"]) {
    const projected = allPanelPolygonsForRole(c, role);
    assert.ok(projected);
    assert.equal(projected.length, c.exactPanelCount);
  }
});
