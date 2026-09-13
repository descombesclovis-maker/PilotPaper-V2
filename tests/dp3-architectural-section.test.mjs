import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const geometry = await vite.ssrLoadModule("/lib/dp-ai-engine/geometry/architecturalSection.ts");
const route = await readFile(new URL("../app/api/dp-piece/route.ts", import.meta.url), "utf8");
const contract = await readFile(new URL("../lib/dp-piece-contract.ts", import.meta.url), "utf8");
const engine = await readFile(new URL("../lib/dp3-architectural-section-engine.ts", import.meta.url), "utf8");
const direct = await readFile(new URL("../lib/dp-direct-chatgpt-image-engine.ts", import.meta.url), "utf8");
const prompt = await readFile(new URL("../lib/dp-ai-engine/prompts/dpImage.ts", import.meta.url), "utf8");

const earth = 6_378_137;
const origin = { latitude: 46.4, longitude: 4.7 };

function latLng(east, north) {
  const lat0 = origin.latitude * Math.PI / 180;
  return {
    latitude: origin.latitude + (north / earth) * 180 / Math.PI,
    longitude: origin.longitude + (east / (earth * Math.cos(lat0))) * 180 / Math.PI,
  };
}

function lonLat(east, north) {
  const point = latLng(east, north);
  return [point.longitude, point.latitude];
}

function segment({ centerEast, azimuth, minEast, maxEast, height }) {
  return {
    pitchDegrees: 30,
    azimuthDegrees: azimuth,
    center: latLng(centerEast, 0),
    boundingBox: {
      sw: latLng(minEast, -4),
      ne: latLng(maxEast, 4),
    },
    planeHeightAtCenterMeters: height,
    stats: { areaMeters2: 46.2, groundAreaMeters2: 40 },
  };
}

test("legacy section geometry still reconstructs a real two-pitch roof from BD TOPO and roof planes", () => {
  const pitchRiseAtHalfFace = 2.5 * Math.tan(Math.PI / 6);
  const centerHeight = 105 + pitchRiseAtHalfFace;
  const building = {
    id: "test-building",
    polygon: [lonLat(-5, -4), lonLat(5, -4), lonLat(5, 4), lonLat(-5, 4), lonLat(-5, -4)],
    centroid: lonLat(0, 0),
    areaM2: 80,
    heightM: 5,
    source: "BDTOPO_V3:batiment",
  };
  const insights = {
    center: origin,
    imageryQuality: "HIGH",
    solarPotential: {
      panelWidthMeters: 1,
      panelHeightMeters: 2,
      solarPanels: [],
      roofSegmentStats: [
        segment({ centerEast: 2.5, azimuth: 90, minEast: 0, maxEast: 5, height: centerHeight }),
        segment({ centerEast: -2.5, azimuth: 270, minEast: -5, maxEast: 0, height: centerHeight }),
      ],
    },
  };

  const result = geometry.buildArchitecturalSectionGeometry({ building, insights, selectedSegmentIndex: 0 });
  assert.ok(result.widthM > 9.8 && result.widthM < 10.2);
  assert.ok(result.leftEaveHeightM > 4.7 && result.leftEaveHeightM < 5.3);
  assert.ok(result.rightEaveHeightM > 4.7 && result.rightEaveHeightM < 5.3);
  assert.ok(result.ridgeHeightM > 7.6 && result.ridgeHeightM < 8.2);
  assert.equal(result.selectedPitchDeg, 30);
});

test("an L-shaped building is cut through the selected wing instead of its bounding rectangle", () => {
  const polygon = [
    lonLat(-5, -4), lonLat(5, -4), lonLat(5, 0), lonLat(0, 0),
    lonLat(0, 5), lonLat(-5, 5), lonLat(-5, -4),
  ];
  const lowerWing = geometry.sectionIntervalForFootprint({
    polygon,
    sectionCenter: latLng(2, -2),
    azimuthDeg: 90,
  });
  const upperWing = geometry.sectionIntervalForFootprint({
    polygon,
    sectionCenter: latLng(-2, 2),
    azimuthDeg: 90,
  });
  assert.ok(lowerWing.widthM > 9.8 && lowerWing.widthM < 10.2);
  assert.ok(upperWing.widthM > 4.8 && upperWing.widthM < 5.2);
});

test("isolated DP3 now uses direct ChatGPT Image with real building photos and refuses invented dimensions", () => {
  assert.match(route, /case 3:/);
  assert.match(route, /generateDirectChatGptDp\(\{ \.\.\.input, dp: 3 \}\)/);
  assert.doesNotMatch(route, /generateDp3Piece/);

  const dp3Start = contract.indexOf("dp: 3,");
  const dp4Start = contract.indexOf("dp: 4,");
  assert.ok(dp3Start >= 0 && dp4Start > dp3Start);
  const dp3Block = contract.slice(dp3Start, dp4Start);
  assert.match(dp3Block, /roofFace/);
  assert.match(dp3Block, /"nearPhoto"/);
  assert.match(dp3Block, /"roofPhoto"/);
  assert.match(dp3Block, /output: "image"/);
  assert.match(dp3Block, /usesSiteTwin: true/);
  assert.match(dp3Block, /allowsGenerativeRefinement: true/);

  assert.match(direct, /DP3 ChatGPT Image/);
  assert.match(direct, /photo\.role === "roof" \|\| photo\.role === "near"/);
  assert.match(prompt, /Never invent a height, slope, setback or dimension/);
  assert.match(prompt, /architectural section/);

  // The old exact section geometry remains unit-tested as a metric/reference
  // helper, but it is no longer the isolated user-facing rendering route.
  assert.match(engine, /buildArchitecturalSectionGeometry/);
});
