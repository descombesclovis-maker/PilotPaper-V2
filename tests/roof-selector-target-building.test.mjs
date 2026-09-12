import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const targetRoof = await vite.ssrLoadModule("/lib/dp-ai-engine/site-model/targetRoofContext.ts");
const route = await readFile(new URL("../app/api/dp-piece/roof-faces/route.ts", import.meta.url), "utf8");
const workbench = await readFile(new URL("../components/dp-piece-workbench.tsx", import.meta.url), "utf8");

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
    coordinates: [[[4.6998, 46.3998], [4.7002, 46.3998], [4.7002, 46.4002], [4.6998, 46.4002], [4.6998, 46.3998]]],
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

test("roof-face centers must belong to the cadastral target building, not merely the nearby parcel", () => {
  assert.equal(targetRoof.pointBelongsToTargetProperty({ longitude: 4.7, latitude: 46.4 }, { parcel, building }), true);
  assert.equal(targetRoof.pointBelongsToTargetProperty({ longitude: 4.70016, latitude: 46.4 }, { parcel, building }), false);
  assert.equal(targetRoof.pointBelongsToTargetProperty({ longitude: 4.701, latitude: 46.4 }, { parcel, building }), false);
});

test("a displaced Google Solar building center is accepted when roof evidence still matches the cadastral building", () => {
  const solar = solarFixture({
    centerLongitude: 4.70012,
    segmentLongitude: 4.7,
    panelLongitude: 4.7,
  });
  assert.equal(targetRoof.googleSolarMatchesTargetBuilding(solar, { parcel, building }), true);
});

test("a neighbouring Google Solar building remains rejected when its roof evidence is outside the target building", () => {
  const solar = solarFixture({
    centerLongitude: 4.70016,
    segmentLongitude: 4.70016,
    panelLongitude: 4.70016,
  });
  assert.equal(targetRoof.googleSolarMatchesTargetBuilding(solar, { parcel, building }), false);
});

test("roof selector is filtered by the exact requested PV configuration and DP3 feasibility", () => {
  assert.match(route, /moduleReference/);
  assert.match(route, /panelCount/);
  assert.match(route, /requestedRows: rows/);
  assert.match(route, /requestedColumns: columns/);
  assert.match(route, /pointBelongsToTargetProperty/);
  assert.match(route, /buildArchitecturalSectionGeometry/);
  assert.match(route, /averageNormalized\(automatic\.design\.quadNormalized\)/);
});

test("K-par-K workbench reanalyses roof faces when PV configuration changes", () => {
  assert.match(workbench, /roofAnalysisSignature/);
  assert.match(workbench, /moduleReference: snapshot\.moduleReference/);
  assert.match(workbench, /panelCount,/);
  assert.match(workbench, /rows,/);
  assert.match(workbench, /columns,/);
  assert.match(workbench, /orientation: snapshot\.orientation/);
  assert.match(workbench, /Seuls les pans capables d'accueillir cette configuration sont affichés/);
});
