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

const modulePromise = vite.ssrLoadModule("/lib/dp-ai-engine/generators/dp5RoofPlan.ts");

const form = {
  projectId: "dp5-sot",
  address: "1 rue de test",
  panel: { manufacturer: "Test", model: "Model X", widthMm: 1000, heightMm: 2000, powerWp: 500 },
  array: {
    rows: 1,
    columns: 2,
    orientation: "portrait",
    roofFace: "A",
    placement: "centered",
    layoutMode: "fixed",
    interPanelGapMm: 20,
  },
};

const modules = [
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

function placement(overrides = {}) {
  return {
    faceId: "A",
    label: "Pan A",
    panelCount: 2,
    rows: 1,
    columns: 2,
    lastRowCount: 2,
    resolvedGutterMm: 600,
    resolvedRidgeMm: 1400,
    resolvedLeftMm: 100,
    resolvedRightMm: 1880,
    widthMm: 4000,
    slopeLengthMm: 4000,
    modulePlacementsMm: modules,
    ...overrides,
  };
}

function context(p = placement()) {
  return {
    projectId: form.projectId,
    address: form.address,
    array: form.array,
    panel: form.panel,
    exactPanelCount: 2,
    fieldWidthMm: 2020,
    fieldHeightMm: 2000,
    roofGeometry: { widthMm: 4000, slopeLengthMm: 4000, source: "ign-derived" },
    facePlacements: [p],
    roof: {
      selectedFaceDescription: "Pan A",
      confidence: 1,
      obstacles: [],
      perspectiveNotes: [],
      uncertainties: [],
      views: [],
    },
    immutableFacts: [],
  };
}

test("DP5 exposes the persisted physical modules unchanged", async () => {
  const { physicalModulesForDP5 } = await modulePromise;
  assert.deepEqual(physicalModulesForDP5(form, placement()), modules);
});

test("DP5 SVG draws the authoritative physical coordinates rather than recentering the field", async () => {
  const { buildDP5RoofPlan } = await modulePromise;
  const result = buildDP5RoofPlan(form, context());
  assert.equal(result.quality.passed, true);
  assert.equal(result.quality.panelCountObserved, 2);
  assert.ok(result.asset.text.includes('data-module-index="0"'));
  assert.ok(
    result.asset.text.includes('points="169.50,570.50 364.50,570.50 364.50,355.50 169.50,355.50"'),
    "first module must be drawn from x=100..1100 mm and y=600..2600 mm",
  );
});

test("DP5 rejects an incomplete authoritative set instead of rebuilding missing modules", async () => {
  const { buildDP5RoofPlan } = await modulePromise;
  const broken = placement({ modulePlacementsMm: modules.slice(0, 1) });
  assert.throws(
    () => buildDP5RoofPlan(form, context(broken)),
    /authoritative geometry rejected/,
  );
});
