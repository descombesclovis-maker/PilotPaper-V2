import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const { googleSolarFaceCentersNormalized, matchObservedRoofFacesToGoogleSolarIds } = await vite.ssrLoadModule("/lib/dp-ai-engine/site-model/googleSolarFaceIdentity.ts");

function fakeInsights() {
  return {
    center: { latitude: 46.30, longitude: 4.75 },
    imageryQuality: "HIGH",
    solarPotential: {
      panelWidthMeters: 1,
      panelHeightMeters: 2,
      roofSegmentStats: [
        { pitchDegrees: 30, azimuthDegrees: 90, center: { latitude: 46.30000, longitude: 4.74994 }, stats: { groundAreaMeters2: 40 } },
        { pitchDegrees: 30, azimuthDegrees: 270, center: { latitude: 46.30000, longitude: 4.75006 }, stats: { groundAreaMeters2: 80 } },
      ],
      solarPanels: [
        { center: { latitude: 46.30000, longitude: 4.74994 }, orientation: "PORTRAIT", segmentIndex: 0 },
        { center: { latitude: 46.30000, longitude: 4.75006 }, orientation: "PORTRAIT", segmentIndex: 1 },
      ],
    },
  };
}

test("Google A/B anchors keep geometric ranking independent from vision IDs", () => {
  const insights = fakeInsights();
  const centers = googleSolarFaceCentersNormalized({
    insights,
    imageCenter: { longitude: 4.75, latitude: 46.30 },
    groundWidthMeters: 56,
    groundHeightMeters: 40,
  });
  assert.deepEqual(centers.map((face) => face.faceId), ["A", "B"]);
  assert.equal(centers[0].originalSegmentIndex, 1);
  assert.equal(centers[1].originalSegmentIndex, 0);

  const observedFaces = [
    {
      id: "V1",
      roofPolygonNormalized: [
        { x: centers[1].centerNormalized.x - 0.03, y: 0.45 },
        { x: centers[1].centerNormalized.x + 0.03, y: 0.45 },
        { x: centers[1].centerNormalized.x + 0.03, y: 0.55 },
        { x: centers[1].centerNormalized.x - 0.03, y: 0.55 },
      ],
    },
    {
      id: "V2",
      roofPolygonNormalized: [
        { x: centers[0].centerNormalized.x - 0.03, y: 0.45 },
        { x: centers[0].centerNormalized.x + 0.03, y: 0.45 },
        { x: centers[0].centerNormalized.x + 0.03, y: 0.55 },
        { x: centers[0].centerNormalized.x - 0.03, y: 0.55 },
      ],
    },
  ];

  const matches = matchObservedRoofFacesToGoogleSolarIds({
    insights,
    observedFaces,
    imageCenter: { longitude: 4.75, latitude: 46.30 },
    groundWidthMeters: 56,
    groundHeightMeters: 40,
  });
  const byObserved = Object.fromEntries(matches.map((match) => [match.observedId, match.faceId]));
  assert.equal(byObserved.V1, "B");
  assert.equal(byObserved.V2, "A");
});

test("one observed polygon cannot claim two stable roof identities", () => {
  const insights = fakeInsights();
  const centers = googleSolarFaceCentersNormalized({
    insights,
    imageCenter: { longitude: 4.75, latitude: 46.30 },
    groundWidthMeters: 56,
    groundHeightMeters: 40,
  });
  const center = centers[0].centerNormalized;
  const matches = matchObservedRoofFacesToGoogleSolarIds({
    insights,
    observedFaces: [{
      id: "V1",
      roofPolygonNormalized: [
        { x: center.x - 0.02, y: center.y - 0.02 },
        { x: center.x + 0.02, y: center.y - 0.02 },
        { x: center.x + 0.02, y: center.y + 0.02 },
        { x: center.x - 0.02, y: center.y + 0.02 },
      ],
    }],
    imageCenter: { longitude: 4.75, latitude: 46.30 },
    groundWidthMeters: 56,
    groundHeightMeters: 40,
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].faceId, "A");
});
