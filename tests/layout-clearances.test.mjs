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

const allocationPromise = vite.ssrLoadModule("/lib/dp-ai-engine/geometry/multiRoofAllocation.ts");
const layoutPromise = vite.ssrLoadModule("/lib/dp-ai-engine/geometry/projectLayout.ts");
const projectionPromise = vite.ssrLoadModule("/lib/dp-ai-engine/geometry/panelProjection.ts");

const panel = { model: "TEST", widthMm: 1000, heightMm: 1700 };

function baseForm(overrides = {}) {
  return {
    projectId: "test-project",
    address: "1 rue du Test, 75000 Paris",
    panel,
    requestedPanelCount: 4,
    array: {
      rows: 2,
      columns: 2,
      orientation: "portrait",
      roofFace: "A",
      placement: "centered",
      layoutMode: "fixed",
      gutterClearanceMm: 300,
      ridgeClearanceMm: 200,
      interPanelGapMm: 20,
    },
    roofFaces: [{ id: "A", widthMm: 5000, slopeLengthMm: 4000, slopeDeg: 30 }],
    roofSelection: { mode: "priority", priorityFaceId: "A" },
    ...overrides,
  };
}

test("multi-roof capacity removes hard ridge clearance before counting rows", async () => {
  const { faceCapacity } = await allocationPromise;
  const face = { id: "A", widthMm: 5000, slopeLengthMm: 3600 };
  const withoutRidge = faceCapacity(panel, "portrait", face, 20, 300, 0);
  const withRidge = faceCapacity(panel, "portrait", face, 20, 300, 300);
  assert.equal(withoutRidge.rowsAtZero, 2);
  assert.equal(withRidge.rowsAtZero, 1);
  assert.equal(withoutRidge.capacity, 8);
  assert.equal(withRidge.capacity, 4);
});

test("resolved allocation never consumes the requested ridge clearance", async () => {
  const { allocateAcrossRoofFaces } = await allocationPromise;
  const result = allocateAcrossRoofFaces({
    panel,
    totalPanels: 4,
    orientation: "portrait",
    faces: [{ id: "A", widthMm: 5000, slopeLengthMm: 3600 }],
    mode: "automatic",
    gapMm: 20,
    preferredGutterMm: 300,
    minimumRidgeMm: 300,
  });
  assert.equal(result.fits, true);
  assert.equal(result.allocations.length, 1);
  assert.ok(result.allocations[0].resolvedRidgeMm >= 300);
});

test("centered fixed layout persists one symmetric physical field origin", async () => {
  const { resolveProjectLayout } = await layoutPromise;
  const result = resolveProjectLayout(baseForm());
  assert.equal(result.placements.length, 1);
  const placement = result.placements[0];
  assert.equal(result.primaryFieldWidthMm, 2020);
  assert.equal(placement.resolvedLeftMm, 1490);
  assert.equal(placement.resolvedRightMm, 1490);
  assert.ok(placement.resolvedRidgeMm >= 200);
});

test("left placement respects explicit left edge clearance and remains inside the roof", async () => {
  const { resolveProjectLayout } = await layoutPromise;
  const form = baseForm();
  form.array = {
    ...form.array,
    placement: "left",
    leftEdgeClearanceMm: 250,
  };
  const result = resolveProjectLayout(form);
  const placement = result.placements[0];
  assert.equal(placement.resolvedLeftMm, 250);
  assert.equal(placement.resolvedRightMm, 2730);
});

test("partial rows align inside the resolved full field instead of recentering independently", async () => {
  const { resolvedRowLeftMm } = await projectionPromise;
  const placement = {
    faceId: "A",
    panelCount: 6,
    rows: 2,
    columns: 4,
    lastRowCount: 2,
    resolvedGutterMm: 300,
    resolvedLeftMm: 500,
    resolvedRightMm: 440,
    widthMm: 5000,
    slopeLengthMm: 4000,
  };
  const context = {
    panel,
    array: {
      rows: 2,
      columns: 4,
      orientation: "portrait",
      roofFace: "A",
      placement: "centered",
      interPanelGapMm: 20,
    },
  };
  assert.equal(resolvedRowLeftMm(context, placement, 4), 500);
  assert.equal(resolvedRowLeftMm(context, placement, 2), 1520);
  context.array.placement = "left";
  assert.equal(resolvedRowLeftMm(context, placement, 2), 500);
  context.array.placement = "right";
  assert.equal(resolvedRowLeftMm(context, placement, 2), 2540);
});
