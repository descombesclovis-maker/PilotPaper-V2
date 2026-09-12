import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const module = await vite.ssrLoadModule("/lib/dp-ai-engine/site-model/googleSolarAutomaticRoof.ts");
const parcel = await vite.ssrLoadModule("/lib/dp-ai-engine/context/officialParcel.ts");

const origin = { latitude: 46.30, longitude: 4.75 };
const earth = 6_378_137;

function latLngFromLocal(east, north) {
  const lat0 = origin.latitude * Math.PI / 180;
  return {
    latitude: origin.latitude + (north / earth) * 180 / Math.PI,
    longitude: origin.longitude + (east / (earth * Math.cos(lat0))) * 180 / Math.PI,
  };
}

// Segment azimuth 180° => down-slope points South and along-ridge points West.
// Google portrait reference panel: 1.0 m wide × 2.0 m long on a 30° roof.
function panelCenter(u, v) {
  return latLngFromLocal(-u, -v);
}

function fakeInsights() {
  const panels = [];
  const slopeGroundStep = 2 * Math.cos(Math.PI / 6);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const u = (column - 1.5) * 1.0;
      const v = (row - 1) * slopeGroundStep;
      panels.push({
        center: panelCenter(u, v),
        orientation: "PORTRAIT",
        segmentIndex: 0,
        yearlyEnergyDcKwh: 500 - row * 10 - column,
      });
    }
  }
  return {
    center: origin,
    imageryQuality: "HIGH",
    solarPotential: {
      panelWidthMeters: 1.0,
      panelHeightMeters: 2.0,
      roofSegmentStats: [{
        pitchDegrees: 30,
        azimuthDegrees: 180,
        center: origin,
        stats: { areaMeters2: 80 },
      }],
      solarPanels: panels,
    },
  };
}

function frame(widthMeters = 40) {
  const center = parcel.toWebMercator(origin.longitude, origin.latitude);
  const heightMeters = widthMeters * (1000 / 1400);
  return {
    longitude: origin.longitude,
    latitude: origin.latitude,
    widthMeters,
    heightMeters,
    minX: center.x - widthMeters / 2,
    maxX: center.x + widthMeters / 2,
    minY: center.y - heightMeters / 2,
    maxY: center.y + heightMeters / 2,
  };
}

test("Google Solar candidate cells can automatically host an exact manufacturer 2x3 portrait field", () => {
  const result = module.automaticRoofDesignFromGoogleSolar({
    insights: fakeInsights(),
    frame: frame(),
    requestedRows: 2,
    requestedColumns: 3,
    requestedOrientation: "portrait",
    moduleWidthMeters: 1.134,
    moduleHeightMeters: 1.762,
    interPanelGapMeters: 0.020,
    placement: "centered",
  });

  assert.equal(result.segmentIndex, 0);
  assert.equal(result.design.slopeDeg, 30);
  assert.equal(result.design.quadNormalized.length, 4);
  assert.equal(result.design.keepouts.length, 0);
  assert.ok(result.googlePanelCountUsedAsSafeArea >= 6);
  assert.ok(result.safeAreaWidthMeters >= result.requestedArrayWidthMeters);
  assert.ok(result.safeAreaSlopeLengthMeters >= result.requestedArraySlopeLengthMeters);
  assert.ok(result.design.quadNormalized.every((point) => point.x > 0 && point.x < 1 && point.y > 0 && point.y < 1));
});

test("requested landscape can use a portrait Google grid purely as a geometric safe area", () => {
  const result = module.automaticRoofDesignFromGoogleSolar({
    insights: fakeInsights(),
    frame: frame(),
    requestedRows: 1,
    requestedColumns: 2,
    requestedOrientation: "landscape",
    moduleWidthMeters: 1.134,
    moduleHeightMeters: 1.762,
    interPanelGapMeters: 0.020,
    placement: "centered",
  });

  assert.equal(result.googleCandidateOrientation, "PORTRAIT");
  assert.ok(result.safeAreaWidthMeters >= result.requestedArrayWidthMeters);
  assert.ok(result.safeAreaSlopeLengthMeters >= result.requestedArraySlopeLengthMeters);
});

test("automatic Google Solar layout fails closed when the real module field is larger than every safe cell block", () => {
  assert.throws(() => module.automaticRoofDesignFromGoogleSolar({
    insights: fakeInsights(),
    frame: frame(),
    requestedRows: 3,
    requestedColumns: 4,
    requestedOrientation: "portrait",
    moduleWidthMeters: 1.75,
    moduleHeightMeters: 2.45,
    interPanelGapMeters: 0.030,
    placement: "centered",
  }), /aucun bloc sûr/i);
});

test("a missing cell breaks contiguity instead of being silently crossed", () => {
  const insights = fakeInsights();
  insights.solarPotential.solarPanels = insights.solarPotential.solarPanels.filter((panel, index) => index !== 5);
  assert.throws(() => module.automaticRoofDesignFromGoogleSolar({
    insights,
    frame: frame(),
    requestedRows: 3,
    requestedColumns: 4,
    requestedOrientation: "portrait",
    moduleWidthMeters: 0.90,
    moduleHeightMeters: 1.70,
    interPanelGapMeters: 0.010,
    placement: "centered",
  }), /aucun bloc sûr/i);
});
