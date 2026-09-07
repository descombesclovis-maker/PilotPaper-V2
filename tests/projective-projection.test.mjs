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

function almost(a, b, tolerance = 1e-9) {
  assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
}

function collinear(a, b, c, tolerance = 1e-9) {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  assert.ok(Math.abs(cross) <= tolerance, `points are not collinear: cross=${cross}`);
}

test("projective mapping preserves all four roof corners exactly", async () => {
  const { projectivePointInQuad } = await modulePromise;
  const quad = [
    { x: 0.10, y: 0.82 },
    { x: 0.90, y: 0.75 },
    { x: 0.70, y: 0.18 },
    { x: 0.28, y: 0.24 },
  ];
  const expected = [
    [0, 0, quad[0]],
    [1, 0, quad[1]],
    [1, 1, quad[2]],
    [0, 1, quad[3]],
  ];
  for (const [u, v, point] of expected) {
    const mapped = projectivePointInQuad(quad, u, v);
    almost(mapped.x, point.x);
    almost(mapped.y, point.y);
  }
});

test("projective mapping keeps straight panel-grid lines straight on an oblique roof", async () => {
  const { projectivePointInQuad } = await modulePromise;
  const quad = [
    { x: 0.08, y: 0.88 },
    { x: 0.94, y: 0.76 },
    { x: 0.68, y: 0.15 },
    { x: 0.32, y: 0.22 },
  ];
  const a = projectivePointInQuad(quad, 0.37, 0.1);
  const b = projectivePointInQuad(quad, 0.37, 0.5);
  const c = projectivePointInQuad(quad, 0.37, 0.9);
  collinear(a, b, c);
});

test("projective mapping remains affine on a parallelogram", async () => {
  const { projectivePointInQuad } = await modulePromise;
  const quad = [
    { x: 0.1, y: 0.8 },
    { x: 0.8, y: 0.8 },
    { x: 0.9, y: 0.2 },
    { x: 0.2, y: 0.2 },
  ];
  const center = projectivePointInQuad(quad, 0.5, 0.5);
  almost(center.x, 0.5);
  almost(center.y, 0.5);
});
