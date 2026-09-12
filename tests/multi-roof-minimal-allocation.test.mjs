import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const { allocateAcrossRoofFaces } = await vite.ssrLoadModule("/lib/dp-ai-engine/geometry/multiRoofAllocation.ts");

const panel = { model: "TEST-1000x2000", widthMm: 1000, heightMm: 2000 };
const faces = [
  { id: "A", widthMm: 5000, slopeLengthMm: 4000 }, // 10
  { id: "B", widthMm: 4000, slopeLengthMm: 4000 }, // 8
  { id: "C", widthMm: 3000, slopeLengthMm: 4000 }, // 6
  { id: "D", widthMm: 2000, slopeLengthMm: 4000 }, // 4
  { id: "E", widthMm: 1000, slopeLengthMm: 4000 }, // 2
];

function allocate(totalPanels, allowedFaces = faces) {
  return allocateAcrossRoofFaces({
    panel,
    totalPanels,
    orientation: "portrait",
    faces: allowedFaces,
    mode: "automatic",
    gapMm: 0,
    preferredGutterMm: 0,
    minimumRidgeMm: 0,
  });
}

test("one authorised roof face is kept when it can hold the complete array", () => {
  const result = allocate(9);
  assert.equal(result.fits, true);
  assert.equal(result.allocations.length, 1);
  assert.equal(result.allocations[0].faceId, "A");
  assert.equal(result.allocations[0].panelCount, 9);
});

test("the allocator opens a second face only when one face is insufficient", () => {
  const result = allocate(16);
  assert.equal(result.fits, true);
  assert.deepEqual(result.allocations.map((item) => item.faceId), ["A", "B"]);
  assert.equal(result.allocations.reduce((sum, item) => sum + item.panelCount, 0), 16);
});

test("three, four or five faces are used only when the requested quantity really requires them", () => {
  assert.equal(allocate(22).allocations.length, 3);
  assert.equal(allocate(26).allocations.length, 4);
  assert.equal(allocate(30).allocations.length, 5);
});

test("unselected faces never participate even if they have more capacity", () => {
  const allowed = faces.filter((face) => ["B", "D", "E"].includes(face.id));
  const result = allocate(12, allowed);
  assert.equal(result.fits, true);
  assert.deepEqual(result.allocations.map((item) => item.faceId), ["B", "D"]);
  assert.ok(result.allocations.every((item) => ["B", "D", "E"].includes(item.faceId)));
});
