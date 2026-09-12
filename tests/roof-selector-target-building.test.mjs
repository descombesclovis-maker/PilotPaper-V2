import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const targetRoof = await vite.ssrLoadModule("/lib/dp-ai-engine/site-model/targetRoofContext.ts");
const faceSelection = await vite.ssrLoadModule("/lib/dp-ai-engine/site-model/googleSolarFaceSelection.ts");
const route = await readFile(new URL("../app/api/dp-piece/roof-faces/route.ts", import.meta.url), "utf8");
const pieceRoute = await readFile(new URL("../app/api/dp-piece/route.ts", import.meta.url), "utf8");
const workbench = await readFile(new URL("../components/dp-piece-workbench.tsx", import.meta.url), "utf8");
const addressProperty = await readFile(new URL("../lib/dp-ai-engine/site-model/addressPropertyResolver.ts", import.meta.url), "utf8");
const targetPropertyResolver = await readFile(new URL("../lib/dp-ai-engine/site-model/targetPropertyResolver.ts", import.meta.url), "utf8");
const architecturalSection = await readFile(new URL("../lib/dp-ai-engine/geometry/architecturalSection.ts", import.meta.url), "utf8");

const parcel = {
  normalizedAddress: "1 rue Test",
  longitude: 4.7,
  latitude: 46.4,
  municipality: "Test",
  cityCode: "00000",
  section: "AA",
  parcelNumber: "1",
  parcelReference: "AA 1",
  parcelAreaM2: 500,
  parcelGeometry: {
    type: "Polygon",
    coordinates: [[[4.6998, 46.3998], [4.70035, 46.3998], [4.70035, 46.4002], [4.6998, 46.4002], [4.6998, 46.3998]]],
  },
};

const building = {
  id: "target",
  polygon: [[4.69994, 46.39994], [4.70006, 46.39994], [4.70006, 46.40006], [4.69994, 46.40006], [4.69994, 46.39994]],
  centroid: [4.7, 46.4],
  areaM2: 100,
  heightM: 5,
  source: "BDTOPO_V3:batiment",
};

const wing = {
  id: "target-wing",
  polygon: [[4.70007, 46.39994], [4.70019, 46.39994], [4.70019, 46.40006], [4.70007, 46.40006], [4.70007, 46.39994]],
  centroid: [4.70013, 46.4],
  areaM2: 95,
  heightM: 5.4,
  source: "BDTOPO_V3:batiment",
};

function solarFixture({ centerLongitude, segmentLongitude, panelLongitude }) {
  return {
    center: { longitude: centerLongitude, latitude: 46.4 },
    solarPotential: {
      panelHeightMeters: 1.75,
      panelWidthMeters: 1.13,
      roofSegmentStats: [
        { pitchDegrees: 25, azimuthDegrees: 180, center: { longitude: segmentLongitude, latitude: 46.4 } },
        { pitchDegrees: 25, azimuthDegrees: 0, center: { longitude: segmentLongitude, latitude: 46.40002 } },
      ],
      solarPanels: Array.from({ length: 6 }, (_, index) => ({
        center: { longitude: panelLongitude, latitude: 46.39998 + index * 0.000006 },
        orientation: "PORTRAIT",
        segmentIndex: index < 3 ? 0 : 1,
      })),
    },
  };
}

test("roof evidence must remain on the cadastral target building cluster", () => {
  assert.equal(targetRoof.pointBelongsToTargetProperty({ longitude: 4.7, latitude: 46.4 }, { parcel, building, buildings: [building, wing] }), true);
  assert.equal(targetRoof.pointBelongsToTargetProperty({ longitude: 4.70013, latitude: 46.4 }, { parcel, building, buildings: [building, wing] }), true);
  assert.equal(targetRoof.pointBelongsToTargetProperty({ longitude: 4.70032, latitude: 46.4 }, { parcel, building, buildings: [building, wing] }), false);
});

test("a displaced Google Solar building center is accepted when roof evidence still matches the target house", () => {
  const solar = solarFixture({ centerLongitude: 4.70027, segmentLongitude: 4.70013, panelLongitude: 4.70013 });
  assert.equal(targetRoof.googleSolarMatchesTargetBuilding(solar, { parcel, building, buildings: [building, wing] }), true);
  assert.equal(targetRoof.buildingForGoogleSolarFace(solar, 0, { parcel, building, buildings: [building, wing] }).id, "target-wing");
});

test("a neighbouring Google Solar building remains rejected", () => {
  const solar = solarFixture({ centerLongitude: 4.70032, segmentLongitude: 4.70032, panelLongitude: 4.70032 });
  assert.equal(targetRoof.googleSolarMatchesTargetBuilding(solar, { parcel, building, buildings: [building, wing] }), false);
});

test("roof selector filters by the requested PV configuration without using DP3 as an eligibility gate", () => {
  assert.match(route, /moduleReference/);
  assert.match(route, /panelCount/);
  assert.match(route, /requestedRows: rows/);
  assert.match(route, /requestedColumns: columns/);
  assert.match(route, /buildingForGoogleSolarFace/);
  assert.match(route, /normalizedGeoPoint\(face\.segment\.center, frame\)/);
  assert.match(route, /encodeRoofFaceSelectionToken/);
  assert.doesNotMatch(route, /buildArchitecturalSectionGeometry/);
});

test("physical roof-face tokens survive display re-lettering", () => {
  const token = faceSelection.encodeRoofFaceSelectionToken({
    displayFaceId: "C",
    originalSegmentIndex: 9,
    buildingId: "target-wing",
  });
  assert.deepEqual(faceSelection.decodeRoofFaceSelectionToken(token), {
    displayFaceId: "C",
    originalSegmentIndex: 9,
    buildingId: "target-wing",
  });
  assert.match(pieceRoute, /decodeRoofFaceSelectionToken/);
  assert.match(pieceRoute, /roofSegmentIndex: token\.originalSegmentIndex/);
  assert.match(pieceRoute, /roofBuildingId: token\.buildingId/);
});

test("addressed property resolution starts from the exact address building and forbids recursive neighbour absorption", () => {
  assert.match(addressProperty, /selectAddressBuilding/);
  assert.match(addressProperty, /parcelForBuilding/);
  assert.match(addressProperty, /distanceBetweenBuildingsM\(building, candidate\) <= 0\.45/);
  assert.doesNotMatch(addressProperty, /while \(changed\)/);
  assert.match(targetRoof.toString(), /resolveAddressPropertyContext/);
});

test("DP3 geometry can still resolve the selected face on a compound BD TOPO building", () => {
  assert.match(architecturalSection, /args\.building\.components/);
  assert.match(architecturalSection, /closestBuildingToPoint/);
  assert.match(architecturalSection, /const gutterHeightM = Number\(building\.heightM\)/);
});

test("Google Solar can never replace the parcel fixed by the project property", () => {
  assert.match(targetPropertyResolver, /insideOriginalParcel/);
  assert.match(targetPropertyResolver, /return args\.addressContext/);
  assert.doesNotMatch(targetPropertyResolver, /geocodage\/reverse/);
  assert.doesNotMatch(targetPropertyResolver, /APICARTO/);
});

test("K-par-K workbench reanalyses roof faces when PV configuration changes", () => {
  assert.match(workbench, /roofAnalysisSignature/);
  assert.match(workbench, /moduleReference: snapshot\.moduleReference/);
  assert.match(workbench, /panelCount,/);
  assert.match(workbench, /rows,/);
  assert.match(workbench, /columns,/);
  assert.match(workbench, /orientation: snapshot\.orientation/);
});
