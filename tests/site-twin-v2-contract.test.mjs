import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const invariants = await vite.ssrLoadModule("/lib/site-twin-v2/invariants.ts");

const twin = {
  version: "pilotpaper-site-twin-v2",
  id: "site-aze",
  address: "110 Rue Basse, 71260 Azé",
  normalizedAddress: "110 Rue Basse 71260 Azé",
  addressPoint: [4.7, 46.4],
  parcel: { reference: "OC 0212", polygonLonLat: [[4.7, 46.4], [4.71, 46.4], [4.71, 46.41]] },
  buildings: [{ id: "house", polygonLonLat: [[4.7, 46.4], [4.701, 46.4], [4.701, 46.401]], evidence: [] }],
  targetBuildingIds: ["house"],
  roof: {
    origin: [4.7, 46.4],
    edges: [],
    faces: ["A", "B", "C", "D"].map((label, index) => ({
      id: `physical-face-${index + 1}`,
      displayLabel: label,
      buildingId: "house",
      polygonLocalM: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }],
      plane: { a: 0.2, b: 0, c: 5 },
      slopeDeg: 25,
      azimuthDeg: index * 90,
      areaM2: 20,
      centerLocalM: { x: 2.5, y: 1.5 },
      edgeIds: [],
      obstacles: [],
      evidence: [],
      confidence: 0.95,
    })),
  },
  photos: [],
  cameraRegistrations: [],
  sources: { lidar: "not-checked" },
  evidence: [],
  confidence: 0.95,
  revision: 1,
};

test("Site Twin preserves every physical face independently of PV compatibility", () => {
  invariants.assertSiteTwinGeometry(twin);
  const eligibility = twin.roof.faces.map((face, index) => ({
    faceId: face.id,
    fits: index < 2,
    maximumPanelCount: index < 2 ? 12 : 8,
    reasons: index < 2 ? [] : ["2x6 does not fit"],
  }));
  assert.equal(invariants.assertEligibilityDoesNotRedefineRoof(twin, eligibility).length, 4);
  assert.equal(eligibility.filter((entry) => entry.fits).length, 2);
});

test("PV eligibility cannot hide incompatible physical roof faces", () => {
  assert.throws(
    () => invariants.assertEligibilityDoesNotRedefineRoof(twin, [
      { faceId: "physical-face-1", fits: true, maximumPanelCount: 12, reasons: [] },
      { faceId: "physical-face-2", fits: true, maximumPanelCount: 12, reasons: [] },
    ]),
    /pans incompatibles ne doivent jamais disparaître/,
  );
});

test("all documents must use the exact Site Twin revision used by PV layout", () => {
  const layout = {
    siteTwinId: twin.id,
    siteTwinRevision: twin.revision,
    configuration: {
      moduleReference: "TSM-NEG9R.28-450",
      moduleWidthMm: 1134,
      moduleHeightMm: 1762,
      panelCount: 12,
      rows: 2,
      columns: 6,
      orientation: "portrait",
      interPanelGapMm: 20,
      preferredGutterClearanceMm: 300,
      placement: "centered",
    },
    selectedFaceIds: ["physical-face-1"],
    eligibility: twin.roof.faces.map((face) => ({ faceId: face.id, fits: true, maximumPanelCount: 12, reasons: [] })),
    modules: Array.from({ length: 12 }, (_, index) => ({
      moduleIndex: index,
      faceId: "physical-face-1",
      polygonLocalM: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
    })),
  };

  assert.equal(invariants.assertLayoutUsesOneTwin(twin, layout).modules.length, 12);
  assert.throws(
    () => invariants.assertLayoutUsesOneTwin(twin, { ...layout, siteTwinRevision: 2 }),
    /révision du Site Twin/,
  );
});
