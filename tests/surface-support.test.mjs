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

const modulePromise = vite.ssrLoadModule("/lib/dp-ai-engine/geometry/surfaceSupport.ts");

function face(overrides = {}) {
  return {
    id: "A",
    label: "Pan principal",
    orientation: "south",
    confidence: 0.96,
    slopeDeg: 32,
    obstacles: [],
    views: [
      {
        role: "satellite_mass",
        faceId: "A",
        selectedFaceVisible: true,
        confidence: 0.97,
        roofPolygonNormalized: [
          { x: 0.15, y: 0.75 },
          { x: 0.82, y: 0.75 },
          { x: 0.72, y: 0.28 },
          { x: 0.25, y: 0.28 },
        ],
        gutterLineNormalized: [{ x: 0.15, y: 0.75 }, { x: 0.82, y: 0.75 }],
        ridgeLineNormalized: [{ x: 0.25, y: 0.28 }, { x: 0.72, y: 0.28 }],
        perspectiveNotes: [],
      },
      {
        role: "near",
        faceId: "A",
        selectedFaceVisible: true,
        confidence: 0.93,
        roofPolygonNormalized: [
          { x: 0.18, y: 0.80 },
          { x: 0.88, y: 0.72 },
          { x: 0.67, y: 0.21 },
          { x: 0.30, y: 0.25 },
        ],
        gutterLineNormalized: [{ x: 0.18, y: 0.80 }, { x: 0.88, y: 0.72 }],
        ridgeLineNormalized: [{ x: 0.30, y: 0.25 }, { x: 0.67, y: 0.21 }],
        perspectiveNotes: [],
      },
    ],
    ...overrides,
  };
}

test("adapts current roof-face evidence into generic SurfaceSupport without inventing dimensions", async () => {
  const { surfaceSupportFromRoofFace } = await modulePromise;
  const surface = surfaceSupportFromRoofFace(face(), "gable");
  assert.equal(surface.id, "A");
  assert.equal(surface.topology, "gable");
  assert.equal(surface.views.length, 2);
  assert.equal(surface.views[0].boundaries[0].kind, "gutter");
  assert.equal(surface.views[0].boundaries[1].kind, "ridge");
  assert.equal("widthMm" in surface, false);
});

test("accepts a well-demonstrated standard V1 roof surface", async () => {
  const { surfaceSupportFromRoofFace, auditSurfaceUnderstanding } = await modulePromise;
  const audit = auditSurfaceUnderstanding(surfaceSupportFromRoofFace(face(), "gable"));
  assert.equal(audit.passed, true);
  assert.equal(audit.errors.length, 0);
  assert.ok(audit.confidence >= 0.9);
});

test("rejects degenerate or insufficient-confidence roof understanding", async () => {
  const { surfaceSupportFromRoofFace, auditSurfaceUnderstanding } = await modulePromise;
  const bad = face({
    confidence: 0.51,
    views: [
      {
        role: "near",
        faceId: "A",
        selectedFaceVisible: true,
        confidence: 0.5,
        roofPolygonNormalized: [
          { x: 0.4, y: 0.4 },
          { x: 0.401, y: 0.4 },
          { x: 0.401, y: 0.401 },
          { x: 0.4, y: 0.401 },
        ],
        perspectiveNotes: [],
      },
    ],
  });
  const audit = auditSurfaceUnderstanding(surfaceSupportFromRoofFace(bad, "gable"));
  assert.equal(audit.passed, false);
  assert.ok(audit.errors.some((message) => message.includes("confidence")));
  assert.ok(audit.errors.some((message) => message.includes("degenerate")));
});
