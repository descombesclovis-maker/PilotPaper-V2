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

const modulePromise = vite.ssrLoadModule("/lib/dp-ai-engine/providers/openaiVision.ts");

function form(slopeDeg = 0) {
  return {
    projectId: "metric-test",
    address: "Test",
    panel: { model: "Test module", widthMm: 1000, heightMm: 2000 },
    array: {
      rows: 2,
      columns: 2,
      orientation: "portrait",
      roofFace: "A",
      placement: "centered",
    },
    roofGeometry: { slopeDeg },
  };
}

function photos() {
  return [
    {
      role: "satellite_mass",
      mimeType: "image/png",
      base64: "",
      widthPx: 1000,
      heightPx: 1000,
      metersPerPixel: 0.01,
    },
  ];
}

function face() {
  return {
    id: "A",
    label: "Pan A",
    confidence: 0.95,
    slopeDeg: 0,
    views: [
      {
        role: "satellite_mass",
        faceId: "A",
        selectedFaceVisible: true,
        confidence: 0.95,
        roofPolygonNormalized: [
          { x: 0.1, y: 0.8 },
          { x: 0.9, y: 0.8 },
          { x: 0.9, y: 0.2 },
          { x: 0.1, y: 0.2 },
        ],
        gutterLineNormalized: [{ x: 0.1, y: 0.8 }, { x: 0.9, y: 0.8 }],
        ridgeLineNormalized: [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.2 }],
        perspectiveNotes: [],
      },
    ],
    obstacles: [
      {
        type: "chimney",
        description: "Cheminée",
        viewRole: "satellite_mass",
        polygonNormalized: [
          { x: 0.2, y: 0.7 },
          { x: 0.3, y: 0.7 },
          { x: 0.3, y: 0.6 },
          { x: 0.2, y: 0.6 },
        ],
      },
    ],
  };
}

test("derives an exact local metric support polygon from the calibrated IGN view", async () => {
  const { deriveMetricRoofFaces } = await modulePromise;
  const [metric] = deriveMetricRoofFaces(form(), photos(), [face()]);
  assert.ok(metric);
  assert.equal(metric.widthMm, 8000);
  assert.equal(metric.slopeLengthMm, 6000);
  assert.deepEqual(metric.surfacePolygonMm?.map((point) => [Math.round(point.xMm), Math.round(point.yMm)]), [
    [0, 0],
    [8000, 0],
    [8000, 6000],
    [0, 6000],
  ]);
});

test("preserves obstacle footprint coordinates instead of reducing the obstacle to blocked cells", async () => {
  const { deriveMetricRoofFaces } = await modulePromise;
  const [metric] = deriveMetricRoofFaces(form(), photos(), [face()]);
  assert.ok(metric);
  assert.equal(metric.obstaclePolygonsMm?.length, 1);
  assert.equal(metric.obstaclePolygonsMm?.[0]?.type, "chimney");
  assert.deepEqual(metric.obstaclePolygonsMm?.[0]?.polygonMm.map((point) => [Math.round(point.xMm), Math.round(point.yMm)]), [
    [1000, 1000],
    [2000, 1000],
    [2000, 2000],
    [1000, 2000],
  ]);
  assert.ok((metric.blockedCells ?? 0) > 0, "legacy blockedCells remains temporarily available during migration");
});

test("converts the orthographic ground run into physical roof-plane distance using slope", async () => {
  const { deriveMetricRoofFaces } = await modulePromise;
  const [metric] = deriveMetricRoofFaces(form(60), photos(), [face()]);
  assert.ok(metric);
  assert.equal(metric.slopeLengthMm, 12000);
  const top = metric.surfacePolygonMm?.[2];
  assert.ok(top);
  assert.ok(Math.abs(top.yMm - 12000) < 1e-6);
});
