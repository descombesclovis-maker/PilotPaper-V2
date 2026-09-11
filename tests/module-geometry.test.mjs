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

const modulePromise = vite.ssrLoadModule("/lib/dp-ai-engine/geometry/moduleGeometry.ts");

const panel = { model: "Module test", widthMm: 1000, heightMm: 2000 };
const array = {
  rows: 2,
  columns: 3,
  orientation: "portrait",
  roofFace: "A",
  placement: "centered",
  interPanelGapMm: 20,
};

function placement(overrides = {}) {
  return {
    faceId: "A",
    label: "Pan A",
    panelCount: 6,
    rows: 2,
    columns: 3,
    lastRowCount: 3,
    resolvedGutterMm: 300,
    resolvedLeftMm: 1480,
    resolvedRightMm: 1480,
    widthMm: 6000,
    slopeLengthMm: 5000,
    ...overrides,
  };
}

function face(overrides = {}) {
  return {
    id: "A",
    label: "Pan A",
    widthMm: 6000,
    slopeLengthMm: 5000,
    surfacePolygonMm: [
      { xMm: 0, yMm: 0 },
      { xMm: 6000, yMm: 0 },
      { xMm: 6000, yMm: 5000 },
      { xMm: 0, yMm: 5000 },
    ],
    obstaclePolygonsMm: [],
    ...overrides,
  };
}

function roundedPolygon(module) {
  return module.polygonMm.map((point) => [Math.round(point.xMm), Math.round(point.yMm)]);
}

test("materializes an exact deterministic 2x3 physical module grid", async () => {
  const { materializePhysicalModules } = await modulePromise;
  const modules = materializePhysicalModules({ placement: placement(), panel, array });
  assert.equal(modules.length, 6);
  assert.deepEqual(roundedPolygon(modules[0]), [
    [1480, 300],
    [2480, 300],
    [2480, 2300],
    [1480, 2300],
  ]);
  assert.deepEqual(roundedPolygon(modules[5]), [
    [3520, 2320],
    [4520, 2320],
    [4520, 4320],
    [3520, 4320],
  ]);
});

test("centers a partial final row inside the resolved full field", async () => {
  const { materializePhysicalModules } = await modulePromise;
  const partialPlacement = placement({ panelCount: 5, lastRowCount: 2 });
  const modules = materializePhysicalModules({ placement: partialPlacement, panel, array });
  assert.equal(modules.length, 5);
  assert.deepEqual(roundedPolygon(modules[3]), [
    [1990, 2320],
    [2990, 2320],
    [2990, 4320],
    [1990, 4320],
  ]);
  assert.deepEqual(roundedPolygon(modules[4]), [
    [3010, 2320],
    [4010, 2320],
    [4010, 4320],
    [3010, 4320],
  ]);
});

test("passes a standard layout fully contained in the support with no obstacles", async () => {
  const { auditPhysicalModules } = await modulePromise;
  const audit = auditPhysicalModules({ face: face(), placement: placement(), panel, array });
  assert.equal(audit.passed, true);
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.modules.length, 6);
});

test("allows adjacent modules to touch when the declared inter-panel gap is zero", async () => {
  const { auditPhysicalModules } = await modulePromise;
  const zeroGapArray = { ...array, rows: 1, columns: 2, interPanelGapMm: 0 };
  const zeroGapPlacement = placement({
    panelCount: 2,
    rows: 1,
    columns: 2,
    lastRowCount: 2,
    resolvedGutterMm: 300,
    resolvedLeftMm: 2000,
    resolvedRightMm: 2000,
  });
  const audit = auditPhysicalModules({
    face: face(),
    placement: zeroGapPlacement,
    panel,
    array: zeroGapArray,
  });
  assert.equal(audit.passed, true);
  assert.deepEqual(audit.errors, []);
});

test("detects positive-area overlap while ignoring edge-only contact", async () => {
  const { metricConvexPolygonsOverlapArea } = await modulePromise;
  const a = [
    { xMm: 0, yMm: 0 },
    { xMm: 1000, yMm: 0 },
    { xMm: 1000, yMm: 2000 },
    { xMm: 0, yMm: 2000 },
  ];
  const touching = [
    { xMm: 1000, yMm: 0 },
    { xMm: 2000, yMm: 0 },
    { xMm: 2000, yMm: 2000 },
    { xMm: 1000, yMm: 2000 },
  ];
  const overlapping = [
    { xMm: 999, yMm: 0 },
    { xMm: 1999, yMm: 0 },
    { xMm: 1999, yMm: 2000 },
    { xMm: 999, yMm: 2000 },
  ];
  assert.equal(metricConvexPolygonsOverlapArea(a, touching), false);
  assert.equal(metricConvexPolygonsOverlapArea(a, overlapping), true);
});

test("rejects a module that crosses a trapezoidal roof boundary", async () => {
  const { auditPhysicalModules } = await modulePromise;
  const trapezoid = face({
    surfacePolygonMm: [
      { xMm: 0, yMm: 0 },
      { xMm: 6000, yMm: 0 },
      { xMm: 4000, yMm: 5000 },
      { xMm: 2000, yMm: 5000 },
    ],
  });
  const audit = auditPhysicalModules({ face: trapezoid, placement: placement(), panel, array });
  assert.equal(audit.passed, false);
  assert.ok(audit.errors.some((message) => message.includes("leaves the metric boundary")));
});

test("rejects a module that intersects a metric chimney footprint", async () => {
  const { auditPhysicalModules } = await modulePromise;
  const obstructed = face({
    obstaclePolygonsMm: [
      {
        type: "chimney",
        description: "Cheminée centrale",
        polygonMm: [
          { xMm: 2500, yMm: 500 },
          { xMm: 3400, yMm: 500 },
          { xMm: 3400, yMm: 1500 },
          { xMm: 2500, yMm: 1500 },
        ],
      },
    ],
  });
  const audit = auditPhysicalModules({ face: obstructed, placement: placement(), panel, array });
  assert.equal(audit.passed, false);
  assert.ok(audit.errors.some((message) => message.includes("collides with obstacle chimney")));
});

test("does not reject a layout when an obstacle is elsewhere on the same support", async () => {
  const { auditPhysicalModules } = await modulePromise;
  const obstacleAway = face({
    obstaclePolygonsMm: [
      {
        type: "vent",
        description: "Ventilation hors champ PV",
        polygonMm: [
          { xMm: 100, yMm: 4400 },
          { xMm: 400, yMm: 4400 },
          { xMm: 400, yMm: 4700 },
          { xMm: 100, yMm: 4700 },
        ],
      },
    ],
  });
  const audit = auditPhysicalModules({ face: obstacleAway, placement: placement(), panel, array });
  assert.equal(audit.passed, true);
});

test("rejects concave metric supports in the bounded Monday V1", async () => {
  const { auditPhysicalModules } = await modulePromise;
  const concave = face({
    surfacePolygonMm: [
      { xMm: 0, yMm: 0 },
      { xMm: 6000, yMm: 0 },
      { xMm: 6000, yMm: 5000 },
      { xMm: 3000, yMm: 3000 },
      { xMm: 0, yMm: 5000 },
    ],
  });
  const audit = auditPhysicalModules({ face: concave, placement: placement(), panel, array });
  assert.equal(audit.passed, false);
  assert.ok(audit.errors.some((message) => message.includes("not a convex V1 support polygon")));
});

test("rejects uncalibrated placements that have no metric support polygon", async () => {
  const { auditPhysicalModules } = await modulePromise;
  const audit = auditPhysicalModules({
    face: face({ surfacePolygonMm: undefined }),
    placement: placement(),
    panel,
    array,
  });
  assert.equal(audit.passed, false);
  assert.ok(audit.errors.some((message) => message.includes("no valid metric support polygon")));
});
