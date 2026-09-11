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

const modulePromise = vite.ssrLoadModule("/lib/dp-ai-engine/geometry/metricSurfaceFromIdentity.ts");

function baseIdentity(obstacles) {
  return {
    sameBuilding: true,
    sameRoofPlane: true,
    confidence: 0.94,
    slopeDeg: 30,
    slopeConfidence: 0.9,
    metricPlane: {
      polygonNormalized: [
        { x: 0.20, y: 0.75 },
        { x: 0.70, y: 0.75 },
        { x: 0.66, y: 0.30 },
        { x: 0.24, y: 0.30 },
      ],
      gutterLineNormalized: [{ x: 0.20, y: 0.75 }, { x: 0.70, y: 0.75 }],
      ridgeLineNormalized: [{ x: 0.24, y: 0.30 }, { x: 0.66, y: 0.30 }],
    },
    roofPlane: {
      polygonNormalized: [
        { x: 0.18, y: 0.82 },
        { x: 0.78, y: 0.74 },
        { x: 0.65, y: 0.22 },
        { x: 0.30, y: 0.26 },
      ],
      gutterLineNormalized: [{ x: 0.18, y: 0.82 }, { x: 0.78, y: 0.74 }],
      ridgeLineNormalized: [{ x: 0.30, y: 0.26 }, { x: 0.65, y: 0.22 }],
    },
    evidence: {
      parcelPositionConsistent: true,
      roofShapeConsistent: true,
      ridgeEaveAxisConsistent: true,
      obstaclePatternConsistent: true,
      annexContextConsistent: false,
    },
    obstacles,
    notes: [],
  };
}

const metricImage = {
  role: "satellite_mass",
  mimeType: "image/png",
  base64: "x".repeat(2000),
  widthPx: 1400,
  heightPx: 1000,
  metersPerPixel: 0.05,
};

test("contextual obstacle wholly outside the matched roof plane cannot block layout", async () => {
  const { metricSurfaceFromIdentity } = await modulePromise;
  const surface = metricSurfaceFromIdentity({
    identity: baseIdentity([{
      type: "chimney",
      description: "Tall chimney on adjoining roof",
      roofPolygonNormalized: [
        { x: 0.86, y: 0.72 },
        { x: 0.93, y: 0.72 },
        { x: 0.93, y: 0.58 },
        { x: 0.86, y: 0.58 },
      ],
      metricPolygonNormalized: null,
    }]),
    metricImage,
    faceId: "A",
  });
  assert.deepEqual(surface.obstaclePolygonsMm, []);
});

test("obstacle on the matched roof plane is reprojected and remains a metric exclusion", async () => {
  const { metricSurfaceFromIdentity } = await modulePromise;
  const surface = metricSurfaceFromIdentity({
    identity: baseIdentity([{
      type: "chimney",
      description: "Chimney on selected roof",
      roofPolygonNormalized: [
        { x: 0.43, y: 0.58 },
        { x: 0.48, y: 0.57 },
        { x: 0.47, y: 0.50 },
        { x: 0.42, y: 0.51 },
      ],
      metricPolygonNormalized: null,
    }]),
    metricImage,
    faceId: "A",
  });
  assert.equal(surface.obstaclePolygonsMm.length, 1);
  assert.equal(surface.obstaclePolygonsMm[0].type, "chimney");
});

test("unlocalized obstacle with no geometry still fails closed", async () => {
  const { metricSurfaceFromIdentity } = await modulePromise;
  assert.throws(() => metricSurfaceFromIdentity({
    identity: baseIdentity([{
      type: "chimney",
      description: "Unlocalized possible chimney",
      roofPolygonNormalized: null,
      metricPolygonNormalized: null,
    }]),
    metricImage,
    faceId: "A",
  }), /touche potentiellement le pan sélectionné/);
});
