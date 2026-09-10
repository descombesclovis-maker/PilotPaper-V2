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

const modulePromise = vite.ssrLoadModule("/lib/dp-ai-engine/geometry/polygonalLayoutSolver.ts");

function panel() {
  return { model: "Test 500", widthMm: 1000, heightMm: 2000 };
}

function array(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function rectangularFace(overrides = {}) {
  return {
    id: "A",
    label: "Pan A",
    widthMm: 8000,
    slopeLengthMm: 6000,
    source: "ign-derived",
    surfacePolygonMm: [
      { xMm: 0, yMm: 0 },
      { xMm: 8000, yMm: 0 },
      { xMm: 8000, yMm: 6000 },
      { xMm: 0, yMm: 6000 },
    ],
    obstaclePolygonsMm: [],
    ...overrides,
  };
}

test("fixed mode preserves the requested 2x3 matrix and centers it when unobstructed", async () => {
  const { solvePolygonalPlacement } = await modulePromise;
  const solution = solvePolygonalPlacement({ face: rectangularFace(), panel: panel(), array: array(), panelCount: 6 });
  assert.ok(solution);
  assert.equal(solution.placement.rows, 2);
  assert.equal(solution.placement.columns, 3);
  assert.equal(solution.modules.length, 6);
  assert.equal(solution.placement.resolvedGutterMm, 300);
  assert.ok(Math.abs(solution.placement.resolvedLeftMm - solution.placement.resolvedRightMm) < 1e-6);
});

test("fixed mode translates the whole requested matrix away from a chimney when a valid position exists", async () => {
  const { solvePolygonalPlacement } = await modulePromise;
  const face = rectangularFace({
    obstaclePolygonsMm: [
      {
        type: "chimney",
        description: "Cheminée centrale",
        polygonMm: [
          { xMm: 3500, yMm: 250 },
          { xMm: 4300, yMm: 250 },
          { xMm: 4300, yMm: 2300 },
          { xMm: 3500, yMm: 2300 },
        ],
      },
    ],
  });
  const solution = solvePolygonalPlacement({ face, panel: panel(), array: array(), panelCount: 6 });
  assert.ok(solution, "the exact fixed matrix should be translated to a legal position");
  assert.equal(solution.placement.rows, 2);
  assert.equal(solution.placement.columns, 3);
  assert.equal(solution.modules.length, 6);
  const moduleXs = solution.modules.flatMap((item) => item.polygonMm.map((point) => point.xMm));
  assert.ok(Math.max(...moduleXs) <= 3500 || Math.min(...moduleXs) >= 4300);
});

test("fixed mode never silently reflows a requested matrix", async () => {
  const { solvePolygonalPlacement } = await modulePromise;
  const face = rectangularFace({ widthMm: 3200, surfacePolygonMm: [
    { xMm: 0, yMm: 0 },
    { xMm: 3200, yMm: 0 },
    { xMm: 3200, yMm: 6000 },
    { xMm: 0, yMm: 6000 },
  ] });
  const solution = solvePolygonalPlacement({ face, panel: panel(), array: array(), panelCount: 6 });
  assert.equal(solution, undefined);
});

test("automatic mode can choose a different matrix when it is the only polygon-safe solution", async () => {
  const { solvePolygonalPlacement } = await modulePromise;
  const face = rectangularFace({
    widthMm: 4700,
    slopeLengthMm: 7000,
    surfacePolygonMm: [
      { xMm: 0, yMm: 0 },
      { xMm: 4700, yMm: 0 },
      { xMm: 4700, yMm: 7000 },
      { xMm: 0, yMm: 7000 },
    ],
    obstaclePolygonsMm: [
      {
        type: "roof_window",
        description: "Velux",
        polygonMm: [
          { xMm: 3000, yMm: 0 },
          { xMm: 4700, yMm: 0 },
          { xMm: 4700, yMm: 2500 },
          { xMm: 3000, yMm: 2500 },
        ],
      },
    ],
  });
  const solution = solvePolygonalPlacement({
    face,
    panel: panel(),
    array: array({ layoutMode: "automatic", rows: 2, columns: 3 }),
    panelCount: 6,
  });
  assert.ok(solution);
  assert.equal(solution.modules.length, 6);
  assert.notEqual(`${solution.placement.rows}x${solution.placement.columns}`, "2x3");
});

test("solver rejects every solution that would cross a trapezoidal roof edge", async () => {
  const { solvePolygonalPlacement } = await modulePromise;
  const face = rectangularFace({
    widthMm: 8000,
    surfacePolygonMm: [
      { xMm: 0, yMm: 0 },
      { xMm: 8000, yMm: 0 },
      { xMm: 5000, yMm: 6000 },
      { xMm: 3000, yMm: 6000 },
    ],
  });
  const solution = solvePolygonalPlacement({
    face,
    panel: panel(),
    array: array({ rows: 3, columns: 3 }),
    panelCount: 9,
  });
  assert.equal(solution, undefined);
});

test("same input produces the exact same physical module coordinates", async () => {
  const { solvePolygonalPlacement } = await modulePromise;
  const args = { face: rectangularFace(), panel: panel(), array: array(), panelCount: 6 };
  const first = solvePolygonalPlacement(args);
  const second = solvePolygonalPlacement(args);
  assert.deepEqual(second, first);
});
