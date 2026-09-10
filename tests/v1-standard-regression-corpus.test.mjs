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

const layoutPromise = vite.ssrLoadModule("/lib/dp-ai-engine/geometry/projectLayout.ts");

function rectangleFace(id, widthMm, slopeLengthMm, overrides = {}) {
  return {
    id,
    label: `Pan ${id}`,
    widthMm,
    slopeLengthMm,
    surfacePolygonMm: [
      { xMm: 0, yMm: 0 },
      { xMm: widthMm, yMm: 0 },
      { xMm: widthMm, yMm: slopeLengthMm },
      { xMm: 0, yMm: slopeLengthMm },
    ],
    obstaclePolygonsMm: [],
    source: "ign-derived",
    ...overrides,
  };
}

function form(overrides = {}) {
  return {
    projectId: "v1-regression",
    address: "Maison standard de régression",
    panel: { manufacturer: "Regression", model: "R-500", widthMm: 1134, heightMm: 1961, powerWp: 500 },
    requestedPanelCount: 6,
    array: {
      rows: 2,
      columns: 3,
      orientation: "portrait",
      roofFace: "A",
      placement: "centered",
      layoutMode: "fixed",
      gutterClearanceMm: 300,
      ridgeClearanceMm: 100,
      leftEdgeClearanceMm: 100,
      rightEdgeClearanceMm: 100,
      interPanelGapMm: 20,
    },
    roofFaces: [rectangleFace("A", 6000, 5200)],
    roofSelection: { mode: "priority", priorityFaceId: "A" },
    support: { topology: "gable", covering: "tile", existingStructure: true },
    ...overrides,
  };
}

function assertAuthoritative(layout, expectedCount) {
  assert.equal(layout.count, expectedCount);
  const physical = layout.placements.flatMap((placement) => placement.modulePlacementsMm ?? []);
  assert.equal(physical.length, expectedCount);
  assert.equal(new Set(physical.map((item) => item.index)).size, expectedCount);
  for (const placement of layout.placements) {
    assert.equal(placement.modulePlacementsMm?.length, placement.panelCount);
  }
}

test("V1 corpus: simple single-face portrait fixed matrix is fully physical and deterministic", async () => {
  const { resolveProjectLayout } = await layoutPromise;
  const input = form();
  const a = resolveProjectLayout(input);
  const b = resolveProjectLayout(input);
  assertAuthoritative(a, 6);
  assert.deepEqual(a, b);
  assert.equal(a.placements[0].rows, 2);
  assert.equal(a.placements[0].columns, 3);
});

test("V1 corpus: landscape module orientation uses the exact swapped physical dimensions", async () => {
  const { resolveProjectLayout } = await layoutPromise;
  const input = form({
    requestedPanelCount: 4,
    array: {
      ...form().array,
      rows: 2,
      columns: 2,
      orientation: "landscape",
    },
    roofFaces: [rectangleFace("A", 5000, 3500)],
  });
  const layout = resolveProjectLayout(input);
  assertAuthoritative(layout, 4);
  const first = layout.placements[0].modulePlacementsMm[0].polygonMm;
  assert.equal(Math.round(first[1].xMm - first[0].xMm), 1961);
  assert.equal(Math.round(first[3].yMm - first[0].yMm), 1134);
});

test("V1 corpus: trapezoidal standard roof never lets a module cross the narrowing upper edges", async () => {
  const { resolveProjectLayout } = await layoutPromise;
  const trapezoid = rectangleFace("A", 6000, 5200, {
    surfacePolygonMm: [
      { xMm: 0, yMm: 0 },
      { xMm: 6000, yMm: 0 },
      { xMm: 5000, yMm: 5200 },
      { xMm: 1000, yMm: 5200 },
    ],
  });
  const layout = resolveProjectLayout(form({ roofFaces: [trapezoid] }));
  assertAuthoritative(layout, 6);
  for (const placedPanel of layout.placements[0].modulePlacementsMm) {
    assert.ok(placedPanel.polygonMm.every((point) => point.xMm >= 0 && point.xMm <= 6000));
  }
});

test("V1 corpus: metric chimney forces a deterministic legal translation instead of being ignored", async () => {
  const { resolveProjectLayout } = await layoutPromise;
  const chimney = {
    type: "chimney",
    description: "Cheminée de régression",
    polygonMm: [
      { xMm: 2300, yMm: 300 },
      { xMm: 3300, yMm: 300 },
      { xMm: 3300, yMm: 1800 },
      { xMm: 2300, yMm: 1800 },
    ],
  };
  const input = form({
    requestedPanelCount: 4,
    array: { ...form().array, rows: 2, columns: 2 },
    roofFaces: [rectangleFace("A", 7000, 5200, { obstaclePolygonsMm: [chimney] })],
  });
  const layout = resolveProjectLayout(input);
  assertAuthoritative(layout, 4);
  assert.notEqual(Math.round(layout.placements[0].resolvedLeftMm), Math.round((7000 - (2 * 1134 + 20)) / 2));
});

test("V1 corpus: preferred 300 mm gutter clearance can shrink when the requested array otherwise cannot fit", async () => {
  const { resolveProjectLayout } = await layoutPromise;
  const input = form({
    requestedPanelCount: 3,
    array: {
      ...form().array,
      rows: 1,
      columns: 3,
      ridgeClearanceMm: 100,
      gutterClearanceMm: 300,
    },
    roofFaces: [rectangleFace("A", 6000, 2150)],
  });
  const layout = resolveProjectLayout(input);
  assertAuthoritative(layout, 3);
  assert.ok(layout.placements[0].resolvedGutterMm < 300);
  assert.ok(layout.placements[0].resolvedGutterMm >= 0);
});

test("V1 corpus: a simple two-face priority roof remains deterministic and uses only safe physical allocations", async () => {
  const { resolveProjectLayout } = await layoutPromise;
  const input = form({
    requestedPanelCount: 4,
    array: { ...form().array, rows: 2, columns: 2, layoutMode: "automatic" },
    roofFaces: [rectangleFace("A", 5000, 4800), rectangleFace("B", 5000, 4800)],
    roofSelection: { mode: "priority", priorityFaceId: "B" },
  });
  const layout = resolveProjectLayout(input);
  assertAuthoritative(layout, 4);
  assert.equal(layout.placements[0].faceId, "B");
});

test("V1 corpus: simple four-face roof can distribute a quantity without losing physical module identity", async () => {
  const { resolveProjectLayout } = await layoutPromise;
  const faces = ["A", "B", "C", "D"].map((id) => rectangleFace(id, 2500, 2400));
  const input = form({
    requestedPanelCount: 8,
    array: {
      ...form().array,
      rows: 1,
      columns: 8,
      layoutMode: "automatic",
      ridgeClearanceMm: 100,
    },
    roofFaces: faces,
    roofSelection: { mode: "automatic" },
    support: { topology: "hipped", covering: "tile", existingStructure: true },
  });
  const layout = resolveProjectLayout(input);
  assertAuthoritative(layout, 8);
  assert.ok(layout.placements.length >= 2);
  assert.equal(layout.placements.reduce((sum, placement) => sum + placement.panelCount, 0), 8);
});
