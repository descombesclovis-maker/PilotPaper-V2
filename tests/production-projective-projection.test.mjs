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

function closePoints(a, b, tolerance = 1e-10) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].length, b[i].length);
    for (let j = 0; j < a[i].length; j++) {
      assert.ok(Math.abs(a[i][j].x - b[i][j].x) <= tolerance);
      assert.ok(Math.abs(a[i][j].y - b[i][j].y) <= tolerance);
    }
  }
}

test("production panel projection uses projective homography while legacy remains available", async () => {
  const {
    panelPolygonsForView,
    panelPolygonsForViewProjective,
    panelPolygonsForViewLegacy,
  } = await modulePromise;

  const context = {
    projectId: "v1-projection-test",
    address: "test",
    panel: { model: "module", widthMm: 1000, heightMm: 2000 },
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
      resolvedGutterMm: 500,
      resolvedLeftMm: 990,
      resolvedRightMm: 990,
      widthMm: 4000,
      slopeLengthMm: 4000,
    }],
    immutableFacts: [],
  };

  const view = {
    role: "near",
    faceId: "A",
    selectedFaceVisible: true,
    confidence: 1,
    roofPolygonNormalized: [
      { x: 0.08, y: 0.88 },
      { x: 0.94, y: 0.76 },
      { x: 0.68, y: 0.15 },
      { x: 0.32, y: 0.22 },
    ],
    perspectiveNotes: [],
  };

  const production = panelPolygonsForView(context, view);
  const projective = panelPolygonsForViewProjective(context, view);
  const legacy = panelPolygonsForViewLegacy(context, view);
  assert.ok(production && projective && legacy);
  assert.equal(production.length, 2);
  closePoints(production, projective);

  const differsFromLegacy = production.some((polygon, i) =>
    polygon.some((point, j) =>
      Math.abs(point.x - legacy[i][j].x) > 1e-6 ||
      Math.abs(point.y - legacy[i][j].y) > 1e-6,
    ),
  );
  assert.equal(differsFromLegacy, true);
});
