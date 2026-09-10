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

const modulePromise = vite.ssrLoadModule("/lib/dp-ai-engine/geometry/projectLayout.ts");

function face(overrides = {}) {
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

function form(overrides = {}) {
  return {
    projectId: "test-project",
    address: "1 rue Test",
    panel: {
      manufacturer: "Example Solar",
      model: "MODEL-A",
      widthMm: 1000,
      heightMm: 2000,
      powerWp: 500,
    },
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
    requestedPanelCount: 6,
    roofFaces: [face()],
    roofSelection: { mode: "priority", priorityFaceId: "A" },
    ...overrides,
  };
}

test("production resolveProjectLayout persists polygon-safe physical module coordinates", async () => {
  const { resolveProjectLayout } = await modulePromise;
  const obstacleFace = face({
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

  const result = resolveProjectLayout(form({ roofFaces: [obstacleFace] }));
  assert.equal(result.placements.length, 1);
  const placement = result.placements[0];
  assert.equal(placement.rows, 2);
  assert.equal(placement.columns, 3);
  assert.equal(placement.modulePlacementsMm?.length, 6);

  const xs = placement.modulePlacementsMm.flatMap((item) => item.polygonMm.map((point) => point.xMm));
  assert.ok(Math.max(...xs) <= 3500 || Math.min(...xs) >= 4300);
});

test("same power with different exact module dimensions produces different physical layouts", async () => {
  const { resolveProjectLayout } = await modulePromise;

  const modelA = resolveProjectLayout(form({
    panel: {
      manufacturer: "Example Solar",
      model: "MODEL-A",
      widthMm: 1000,
      heightMm: 2000,
      powerWp: 500,
    },
  }));

  const modelB = resolveProjectLayout(form({
    panel: {
      manufacturer: "Other Solar",
      model: "MODEL-B",
      widthMm: 1134,
      heightMm: 1762,
      powerWp: 500,
    },
  }));

  const modulesA = modelA.placements[0].modulePlacementsMm;
  const modulesB = modelB.placements[0].modulePlacementsMm;
  assert.equal(modulesA?.length, 6);
  assert.equal(modulesB?.length, 6);
  assert.notDeepEqual(modulesB, modulesA);
  assert.notEqual(modelB.primaryFieldWidthMm, modelA.primaryFieldWidthMm);
  assert.notEqual(modelB.primaryFieldHeightMm, modelA.primaryFieldHeightMm);
});
