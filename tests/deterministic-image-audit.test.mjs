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

const pixelsPromise = vite.ssrLoadModule("/lib/dp-ai-engine/utils/pngPixels.ts");
const auditPromise = vite.ssrLoadModule("/lib/dp-ai-engine/quality/deterministicImageAudit.ts");

function solidRgba(width, height, value) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = value;
    rgba[i * 4 + 1] = value;
    rgba[i * 4 + 2] = value;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

test("deterministic audit passes an unchanged source with exact panel geometry", async () => {
  const { encodePng } = await pixelsPromise;
  const { auditDeterministicImage } = await auditPromise;
  const source = encodePng(32, 24, solidRgba(32, 24, 120));
  const polygons = [[
    { x: 0.2, y: 0.2 },
    { x: 0.4, y: 0.2 },
    { x: 0.4, y: 0.5 },
    { x: 0.2, y: 0.5 },
  ]];
  const result = auditDeterministicImage({
    sourceBase64: source,
    outputBase64: source,
    panelPolygons: polygons,
    expectedPanelCount: 1,
  });
  assert.equal(result.passed, true);
  assert.equal(result.exactPanelCount, true);
  assert.equal(result.exactOutsideMaskPreservation, true);
  assert.equal(result.changedOutsidePixels, 0);
  assert.equal(result.overlapPairs, 0);
});

test("deterministic audit detects a changed pixel outside the authorized panel islands", async () => {
  const { encodePng } = await pixelsPromise;
  const { auditDeterministicImage } = await auditPromise;
  const sourceRgba = solidRgba(32, 24, 120);
  const outputRgba = new Uint8Array(sourceRgba);
  outputRgba[0] = 250;
  const source = encodePng(32, 24, sourceRgba);
  const output = encodePng(32, 24, outputRgba);
  const polygons = [[
    { x: 0.4, y: 0.4 },
    { x: 0.6, y: 0.4 },
    { x: 0.6, y: 0.6 },
    { x: 0.4, y: 0.6 },
  ]];
  const result = auditDeterministicImage({
    sourceBase64: source,
    outputBase64: output,
    panelPolygons: polygons,
    expectedPanelCount: 1,
  });
  assert.equal(result.passed, false);
  assert.equal(result.exactOutsideMaskPreservation, false);
  assert.ok(result.changedOutsidePixels >= 1);
});

test("deterministic audit rejects overlapping module polygons", async () => {
  const { encodePng } = await pixelsPromise;
  const { auditDeterministicImage } = await auditPromise;
  const source = encodePng(32, 24, solidRgba(32, 24, 120));
  const polygons = [
    [
      { x: 0.2, y: 0.2 }, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.5 }, { x: 0.2, y: 0.5 },
    ],
    [
      { x: 0.4, y: 0.3 }, { x: 0.7, y: 0.3 }, { x: 0.7, y: 0.6 }, { x: 0.4, y: 0.6 },
    ],
  ];
  const result = auditDeterministicImage({
    sourceBase64: source,
    outputBase64: source,
    panelPolygons: polygons,
    expectedPanelCount: 2,
  });
  assert.equal(result.passed, false);
  assert.ok(result.overlapPairs > 0);
});
