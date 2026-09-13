import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const layoutEngine = await vite.ssrLoadModule("/lib/site-twin-v2/pvLayoutEngine.ts");

function face(id, areaM2, width = 8, depth = 6, azimuthDeg = 180) {
  return {
    id,
    displayLabel: id.toUpperCase(),
    buildingId: "house",
    polygonLocalM: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }],
    plane: { a: 0, b: 0.46, c: 5 },
    slopeDeg: 25,
    azimuthDeg,
    areaM2,
    centerLocalM: { x: width / 2, y: depth / 2 },
    edgeIds: [],
    obstacles: [],
    evidence: [{ source: "ign-lidar-hd", confidence: 0.96 }],
    confidence: 0.96,
  };
}

const twin = {
  version: "pilotpaper-site-twin-v2",
  id: "site-aze-layout",
  address: "110 Rue Basse, 71260 Azé",
  normalizedAddress: "110 Rue Basse 71260 Azé",
  addressPoint: [4.7, 46.4],
  parcel: { reference: "OC 0212", polygonLonLat: [[4.7, 46.4], [4.71, 46.4], [4.71, 46.41]] },
  buildings: [{ id: "house", polygonLonLat: [[4.7, 46.4], [4.701, 46.4], [4.701, 46.401]], evidence: [] }],
  targetBuildingIds: ["house"],
  roof: {
    origin: [4.7, 46.4],
    edges: [],
    faces: [
      face("a", 55),
      face("b", 45, 7.8, 5.5, 0),
      face("c", 12, 3.2, 3.5, 90),
      face("d", 10, 3.0, 3.0, 270),
    ],
  },
  photos: [],
  cameraRegistrations: [],
  sources: { lidar: "available", geometryPrimarySource: "ign-lidar" },
  evidence: [],
  confidence: 0.96,
  revision: 1,
};

const config = {
  moduleReference: "TSM-450NEG9R.28",
  moduleWidthMm: 1134,
  moduleHeightMm: 1762,
  panelCount: 12,
  rows: 2,
  columns: 6,
  orientation: "portrait",
  interPanelGapMm: 20,
  preferredGutterClearanceMm: 300,
  placement: "centered",
};

test("deterministic layout places the exact module count without AI coordinates", () => {
  const layout = layoutEngine.buildPvLayout({ twin, configuration: config, selectedFaceIds: ["a"] });
  assert.equal(layout.modules.length, 12);
  assert.equal(new Set(layout.modules.map((module) => module.faceId)).size, 1);
  assert.equal(layout.selectedFaceIds[0], "a");
  assert.equal(layout.eligibility.length, 4);
  assert.equal(layout.eligibility.find((entry) => entry.faceId === "a").fits, true);
});

test("incompatible physical faces remain explicit eligibility entries", () => {
  const layout = layoutEngine.buildPvLayout({ twin, configuration: config, selectedFaceIds: ["a"] });
  assert.equal(layout.eligibility.some((entry) => entry.faceId === "c" && entry.fits === false), true);
  assert.equal(layout.eligibility.some((entry) => entry.faceId === "d" && entry.fits === false), true);
});

test("300 mm gutter setback is preferred but never encoded as a hard global blocker", () => {
  const tightTwin = {
    ...twin,
    id: "tight-site",
    roof: { ...twin.roof, faces: [face("tight", 35, 7.4, 3.45, 180)] },
  };
  const layout = layoutEngine.buildPvLayout({ twin: tightTwin, configuration: config, selectedFaceIds: ["tight"] });
  const eligibility = layout.eligibility[0];
  assert.equal(eligibility.fits, true);
  assert.ok(eligibility.resolvedGutterClearanceMm < 300);
  assert.equal(layout.modules.length, 12);
});
