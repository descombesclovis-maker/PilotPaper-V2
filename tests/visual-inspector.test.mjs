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
const inspectorPromise = vite.ssrLoadModule("/lib/dp-ai-engine/quality/visualInspector.ts");

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

function context() {
  return {
    projectId: "visual-inspector",
    address: "test",
    panel: { model: "module", widthMm: 1000, heightMm: 2000 },
    array: {
      rows: 1,
      columns: 1,
      orientation: "portrait",
      roofFace: "A",
      placement: "centered",
    },
    exactPanelCount: 1,
    fieldWidthMm: 1000,
    fieldHeightMm: 2000,
    facePlacements: [{
      faceId: "A",
      panelCount: 1,
      rows: 1,
      columns: 1,
      lastRowCount: 1,
      resolvedGutterMm: 1000,
      resolvedRidgeMm: 1000,
      resolvedLeftMm: 1500,
      resolvedRightMm: 1500,
      widthMm: 4000,
      slopeLengthMm: 4000,
      modulePlacementsMm: [{
        index: 0,
        faceId: "A",
        row: 0,
        column: 0,
        polygonMm: [
          { xMm: 1500, yMm: 1000 },
          { xMm: 2500, yMm: 1000 },
          { xMm: 2500, yMm: 3000 },
          { xMm: 1500, yMm: 3000 },
        ],
      }],
    }],
    roof: {
      selectedFaceDescription: "Pan A",
      confidence: 1,
      obstacles: [],
      perspectiveNotes: [],
      uncertainties: [],
      views: [{
        role: "near",
        faceId: "A",
        selectedFaceVisible: true,
        confidence: 1,
        roofPolygonNormalized: [
          { x: 0.1, y: 0.9 },
          { x: 0.9, y: 0.9 },
          { x: 0.8, y: 0.1 },
          { x: 0.2, y: 0.1 },
        ],
        perspectiveNotes: [],
      }],
    },
    immutableFacts: [],
  };
}

test("independent visual inspector passes when every PV island changed and all outside pixels stay identical", async () => {
  const { encodePng } = await pixelsPromise;
  const { inspectGeneratedVisualDeterministically } = await inspectorPromise;
  const sourceRgba = solidRgba(40, 30, 100);
  const outputRgba = new Uint8Array(sourceRgba);
  const inside = (15 * 40 + 20) * 4;
  outputRgba[inside] = 180;
  const source = encodePng(40, 30, sourceRgba);
  const output = encodePng(40, 30, outputRgba);
  const inspection = inspectGeneratedVisualDeterministically({
    context: context(),
    originalPhotos: [{ role: "near", mimeType: "image/png", base64: source }],
    generated: { dp: 6, kind: "image", mimeType: "image/png", base64: output, attempt: 1, sourceRole: "near" },
  });
  assert.equal(inspection.passed, true);
  assert.equal(inspection.audit?.exactPanelCount, true);
  assert.equal(inspection.audit?.exactOutsideMaskPreservation, true);
  assert.equal(inspection.audit?.allPanelIslandsRendered, true);
});

test("independent visual inspector rejects an authoritative PV island with no generated pixel change", async () => {
  const { encodePng } = await pixelsPromise;
  const { inspectGeneratedVisualDeterministically } = await inspectorPromise;
  const source = encodePng(40, 30, solidRgba(40, 30, 100));
  const inspection = inspectGeneratedVisualDeterministically({
    context: context(),
    originalPhotos: [{ role: "near", mimeType: "image/png", base64: source }],
    generated: { dp: 6, kind: "image", mimeType: "image/png", base64: source, attempt: 1, sourceRole: "near" },
  });
  assert.equal(inspection.passed, false);
  assert.ok(inspection.issues.some((issue) => issue.code === "PANEL_ISLAND_NOT_RENDERED"));
});

test("independent visual inspector fatally rejects changed building pixels outside the mask", async () => {
  const { encodePng } = await pixelsPromise;
  const { inspectGeneratedVisualDeterministically } = await inspectorPromise;
  const sourceRgba = solidRgba(40, 30, 100);
  const outputRgba = new Uint8Array(sourceRgba);
  outputRgba[0] = 240;
  const source = encodePng(40, 30, sourceRgba);
  const output = encodePng(40, 30, outputRgba);
  const inspection = inspectGeneratedVisualDeterministically({
    context: context(),
    originalPhotos: [{ role: "near", mimeType: "image/png", base64: source }],
    generated: { dp: 6, kind: "image", mimeType: "image/png", base64: output, attempt: 1, sourceRole: "near" },
  });
  assert.equal(inspection.passed, false);
  assert.ok(inspection.issues.some((issue) => issue.code === "BUILDING_PIXELS_CHANGED_OUTSIDE_MASK" && issue.severity === "fatal"));
});

test("independent visual inspector rejects a missing source trace instead of guessing", async () => {
  const { inspectGeneratedVisualDeterministically } = await inspectorPromise;
  const inspection = inspectGeneratedVisualDeterministically({
    context: context(),
    originalPhotos: [],
    generated: { dp: 4, kind: "image", mimeType: "image/png", base64: "abc", attempt: 1, sourceRole: "near" },
  });
  assert.equal(inspection.passed, false);
  assert.ok(inspection.issues.some((issue) => issue.code === "SOURCE_PHOTO_NOT_FOUND"));
});
