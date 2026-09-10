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

test("reports separate surface, boundary, metric, obstacle and multi-view confidences", async () => {
  const { surfaceSupportFromRoofFace, auditSurfaceUnderstanding } = await modulePromise;
  const audit = auditSurfaceUnderstanding(surfaceSupportFromRoofFace(face(), "gable"));
  assert.deepEqual(Object.keys(audit.components).sort(), ["boundaries", "metric", "multiView", "obstacles", "surface"]);
  assert.equal(audit.components.surface, 0.96);
  assert.equal(audit.components.metric, 0.97);
  assert.equal(audit.components.boundaries, 0.97);
  assert.equal(audit.components.obstacles, 1);
  assert.equal(audit.components.multiView, 0.93);
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

test("gates every allocated surface and returns the weakest accepted confidence", async () => {
  const { gateAllocatedSurfaces } = await modulePromise;
  const faceA = face();
  const faceB = face({ id: "B", label: "Pan secondaire", confidence: 0.88 });
  faceB.views = faceB.views.map((view) => ({ ...view, faceId: "B", confidence: 0.86 }));
  const result = gateAllocatedSurfaces([faceA, faceB], "gable", ["A", "B"]);
  assert.equal(result.confidence, 0.86);
  assert.deepEqual(Object.keys(result.audits).sort(), ["A", "B"]);
});

test("does not let an unrelated weak face block a valid allocated surface", async () => {
  const { gateAllocatedSurfaces } = await modulePromise;
  const weakUnused = face({ id: "B", confidence: 0.3 });
  const result = gateAllocatedSurfaces([face(), weakUnused], "gable", ["A"]);
  assert.ok(result.confidence >= 0.9);
});

test("rejects an allocated surface without metric IGN evidence", async () => {
  const { gateAllocatedSurfaces } = await modulePromise;
  const noIgn = face({ views: face().views.filter((view) => view.role !== "satellite_mass") });
  assert.throws(
    () => gateAllocatedSurfaces([noIgn], "gable", ["A"]),
    /not demonstrated on the metric IGN close view/,
  );
});

test("rejects an allocated surface without a usable real project photograph", async () => {
  const { gateAllocatedSurfaces } = await modulePromise;
  const onlyIgn = face({ views: face().views.filter((view) => view.role === "satellite_mass") });
  assert.throws(
    () => gateAllocatedSurfaces([onlyIgn], "gable", ["A"]),
    /not demonstrated in a usable real project photograph/,
  );
});

test("rejects an obstacle that was detected but has no usable metric polygon", async () => {
  const { selectLayoutEligibleSurfaces } = await modulePromise;
  const obstacleUnknown = face({
    obstacles: [{ type: "chimney", description: "Cheminée visible", polygonNormalized: undefined }],
  });
  const result = selectLayoutEligibleSurfaces([obstacleUnknown], "gable");
  assert.deepEqual(result.eligibleFaceIds, []);
  assert.ok(result.rejected.A?.some((message) => message.includes("no usable polygon")));
});

test("rejects an obstacle localized only in a perspective photo because layout cannot metrically exclude it", async () => {
  const { selectLayoutEligibleSurfaces } = await modulePromise;
  const perspectiveOnly = face({
    obstacles: [{
      type: "roof_window",
      description: "Velux",
      viewRole: "near",
      polygonNormalized: [
        { x: 0.45, y: 0.45 },
        { x: 0.55, y: 0.44 },
        { x: 0.56, y: 0.58 },
        { x: 0.44, y: 0.59 },
      ],
    }],
  });
  const result = selectLayoutEligibleSurfaces([perspectiveOnly], "gable");
  assert.deepEqual(result.eligibleFaceIds, []);
  assert.ok(result.rejected.A?.some((message) => message.includes("no metric IGN footprint")));
});

test("accepts a metrically localized obstacle for downstream polygonal layout", async () => {
  const { selectLayoutEligibleSurfaces } = await modulePromise;
  const metricObstacle = face({
    obstacles: [{
      type: "chimney",
      description: "Cheminée IGN",
      viewRole: "satellite_mass",
      polygonNormalized: [
        { x: 0.45, y: 0.45 },
        { x: 0.55, y: 0.45 },
        { x: 0.55, y: 0.55 },
        { x: 0.45, y: 0.55 },
      ],
    }],
  });
  const result = selectLayoutEligibleSurfaces([metricObstacle], "gable");
  assert.deepEqual(result.eligibleFaceIds, ["A"]);
  assert.ok(result.audits.A.components.obstacles >= 0.9);
});

test("excludes an unsafe face before layout while keeping independent safe candidates", async () => {
  const { selectLayoutEligibleSurfaces } = await modulePromise;
  const safe = face();
  const weak = face({ id: "B", label: "Pan faible", confidence: 0.4 });
  weak.views = weak.views.map((view) => ({ ...view, faceId: "B" }));
  const result = selectLayoutEligibleSurfaces([safe, weak], "gable");
  assert.deepEqual(result.eligibleFaceIds, ["A"]);
  assert.ok(result.rejected.B?.some((message) => message.includes("confidence")));
});

test("never offers a face without real-photo evidence to the Layout Engine", async () => {
  const { selectLayoutEligibleSurfaces } = await modulePromise;
  const onlyIgn = face({ views: face().views.filter((view) => view.role === "satellite_mass") });
  const result = selectLayoutEligibleSurfaces([onlyIgn], "gable");
  assert.deepEqual(result.eligibleFaceIds, []);
  assert.ok(result.rejected.A?.some((message) => message.includes("usable real project photograph")));
});
