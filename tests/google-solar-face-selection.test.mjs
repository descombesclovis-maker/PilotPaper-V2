import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const { listGoogleSolarFaces, selectGoogleSolarFace, selectGoogleSolarFaces } = await vite.ssrLoadModule("/lib/dp-ai-engine/site-model/googleSolarFaceSelection.ts");

function fakeInsights() {
  return {
    center: { latitude: 46.30, longitude: 4.75 },
    imageryQuality: "HIGH",
    solarPotential: {
      panelWidthMeters: 1.0,
      panelHeightMeters: 2.0,
      roofSegmentStats: [
        {
          pitchDegrees: 28,
          azimuthDegrees: 110,
          center: { latitude: 46.30001, longitude: 4.74996 },
          stats: { groundAreaMeters2: 55, areaMeters2: 62 },
        },
        {
          pitchDegrees: 31,
          azimuthDegrees: 290,
          center: { latitude: 46.29999, longitude: 4.75004 },
          stats: { groundAreaMeters2: 80, areaMeters2: 92 },
        },
      ],
      solarPanels: [
        { center: { latitude: 46.30001, longitude: 4.74996 }, orientation: "PORTRAIT", segmentIndex: 0, yearlyEnergyDcKwh: 900 },
        { center: { latitude: 46.30002, longitude: 4.74997 }, orientation: "PORTRAIT", segmentIndex: 0, yearlyEnergyDcKwh: 880 },
        { center: { latitude: 46.29999, longitude: 4.75004 }, orientation: "PORTRAIT", segmentIndex: 1, yearlyEnergyDcKwh: 400 },
        { center: { latitude: 46.29998, longitude: 4.75005 }, orientation: "PORTRAIT", segmentIndex: 1, yearlyEnergyDcKwh: 390 },
      ],
    },
  };
}

test("roof face A and B are stable distinct physical Google Solar segments", () => {
  const insights = fakeInsights();
  const faceA = selectGoogleSolarFace(insights, "A");
  const faceB = selectGoogleSolarFace(insights, "B");

  // Ranking is geometric: the larger physical segment is A even though the
  // smaller segment has much higher energy values in this synthetic example.
  assert.equal(faceA.originalSegmentIndex, 1);
  assert.equal(faceB.originalSegmentIndex, 0);
  assert.notEqual(faceA.originalSegmentIndex, faceB.originalSegmentIndex);
  assert.equal(faceA.segment.azimuthDegrees, 290);
  assert.equal(faceB.segment.azimuthDegrees, 110);
});

test("complete inventory exposes every physical face before the user chooses", () => {
  const faces = listGoogleSolarFaces(fakeInsights());
  assert.deepEqual(faces.map((face) => face.faceId), ["A", "B"]);
  assert.deepEqual(faces.map((face) => face.originalSegmentIndex), [1, 0]);
});

test("selected face isolates exactly one segment before automatic layout", () => {
  const faceB = selectGoogleSolarFace(fakeInsights(), "B");
  assert.equal(faceB.insights.solarPotential.roofSegmentStats.length, 1);
  assert.equal(faceB.insights.solarPotential.roofSegmentStats[0].azimuthDegrees, 110);
  assert.ok(faceB.insights.solarPotential.solarPanels.length > 0);
  assert.ok(faceB.insights.solarPotential.solarPanels.every((panel) => panel.segmentIndex === 0));
});

test("two or more user-authorised faces stay isolated from every unselected face", () => {
  const selected = selectGoogleSolarFaces(fakeInsights(), ["B", "A", "B"]);
  assert.deepEqual(selected.faceIds, ["B", "A"]);
  assert.equal(selected.faces.length, 2);
  assert.equal(selected.insights.solarPotential.roofSegmentStats.length, 2);
  assert.ok(selected.insights.solarPotential.solarPanels.every((panel) => panel.segmentIndex === 0 || panel.segmentIndex === 1));
});

test("requesting a non-existent physical face fails closed instead of silently using another pan", () => {
  assert.throws(
    () => selectGoogleSolarFace(fakeInsights(), "C"),
    /pan C n'existe pas/i,
  );
});
