import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const lidarModule = await vite.ssrLoadModule("/lib/dp-ai-engine/site-model/lidarAltimetry.ts");
const roofModule = await vite.ssrLoadModule("/lib/dp-ai-engine/site-model/roofGeometryEngine.ts");
const parcelModule = await vite.ssrLoadModule("/lib/dp-ai-engine/context/officialParcel.ts");
const dp2Source = await readFile(new URL("../lib/dp2-v1-engine.ts", import.meta.url), "utf8");
const buildingSource = await readFile(new URL("../lib/dp-ai-engine/site-model/buildingResolver.ts", import.meta.url), "utf8");

function lonLatFromLocal(origin, x, y) {
  const base = parcelModule.toWebMercator(origin[0], origin[1]);
  const geo = parcelModule.fromWebMercator(base.x + x, base.y + y);
  return [geo.longitude, geo.latitude];
}

test("MNX decoder identifies MNT/MNS/MNH independent of response order", () => {
  const values = lidarModule.extractMnxValues({
    measures: [
      { z: 8.2, title: "MNH issu du LiDAR HD" },
      { z: 243.4, title: "MNS LiDAR HD surface" },
      { z: 235.2, title: "MNT LiDAR HD terrain" },
    ],
  });
  assert.equal(values.surfaceZ, 243.4);
  assert.equal(values.terrainZ, 235.2);
  assert.equal(values.heightM, 8.2);
});

test("MNX decoder can recover an unlabeled surface/terrain/height triple deterministically", () => {
  const values = lidarModule.extractMnxValues({ measures: [{ z: 121.6 }, { z: 113.1 }, { z: 8.5 }] });
  assert.equal(values.surfaceZ, 121.6);
  assert.equal(values.terrainZ, 113.1);
  assert.equal(values.heightM, 8.5);
});

test("LiDAR roof geometry extracts multiple planes and keeps protrusions out of the fitted roof planes", () => {
  const origin = [4.75, 46.30];
  const footprint = [
    lonLatFromLocal(origin, -6, -5),
    lonLatFromLocal(origin, 6, -5),
    lonLatFromLocal(origin, 6, 5),
    lonLatFromLocal(origin, -6, 5),
    lonLatFromLocal(origin, -6, -5),
  ];
  const samples = [];
  for (let x = -5; x <= 5; x += 1) {
    for (let y = -4; y <= 4; y += 1) {
      const [longitude, latitude] = lonLatFromLocal(origin, x, y);
      const left = x < 0;
      let surfaceZ = left ? 220 + 0.32 * y : 220 - 0.34 * y;
      if (x === -3 && y === 1) surfaceZ += 1.1;
      samples.push({ longitude, latitude, surfaceZ, terrainZ: 212, heightM: surfaceZ - 212 });
    }
  }
  const building = { id: "test", polygon: footprint, centroid: origin, areaM2: 120, source: "BDTOPO_V3:batiment" };
  const roof = roofModule.buildRoofModelFromLidar({ building, samples, samplingStepM: 1, coverage: 1 });
  assert.ok(roof.planes.length >= 2, `expected >=2 planes, got ${roof.planes.length}`);
  assert.ok(roof.planes.every((plane) => plane.rmsErrorM < 0.30));
  assert.ok(roof.planes.every((plane) => plane.projectionQuadLocalM.length === 4));
  assert.ok(roof.obstacles.some((obstacle) => obstacle.maxHeightAbovePlaneM > 0.5));
});

test("DP2 tries official SiteModel geometry before any legacy vision fallback", () => {
  const autoIndex = dp2Source.indexOf("buildAutomaticSiteModelFromParcel(official)");
  const legacyIndex = dp2Source.indexOf("generateWithLegacyVision(input, form, official, reason)");
  assert.ok(autoIndex >= 0);
  assert.ok(legacyIndex > autoIndex);
  assert.match(dp2Source, /Aucune IA générative utilisée pour créer la géométrie métrique/);
  assert.match(dp2Source, /BD TOPO — bâtiment/);
  assert.match(dp2Source, /LiDAR HD IGN/);
});

test("building resolver uses official BD TOPO WFS around the geocoded project building", () => {
  assert.match(buildingSource, /BDTOPO_V3:batiment/);
  assert.match(buildingSource, /https:\/\/data\.geopf\.fr\/wfs\/ows/);
  assert.match(buildingSource, /EPSG:3857/);
  assert.match(buildingSource, /selectTargetBuilding/);
});
