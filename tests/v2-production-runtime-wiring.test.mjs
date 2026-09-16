import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("installed V2 wires the map geometry credential required by Site Twin and photo projection", async () => {
  const launcher = await source("desktop/PilotPaperLauncher/PilotPaperV2MapGeometryKey.cs");
  const dataLayers = await source("lib/site-twin-v2/googleSolarDataLayers.ts");
  const photoEdit = await source("lib/site-twin-v2/constrainedPhotoEdit.ts");

  assert.match(launcher, /GOOGLE_SOLAR_API_KEY/);
  assert.match(launcher, /SOLAR_API_KEY/);
  assert.match(launcher, /GOOGLE_MAPS_API_KEY/);
  assert.match(launcher, /Solar API activée/);
  assert.match(launcher, /WriteLocalVar\("GOOGLE_SOLAR_API_KEY"/);
  assert.match(dataLayers, /process\.env\.GOOGLE_SOLAR_API_KEY/);
  assert.match(dataLayers, /solar\.googleapis\.com\/v1\/dataLayers:get/);
  assert.match(photoEdit, /fetchGoogleSolarDataLayers/);
  assert.match(photoEdit, /downloadGoogleGeoTiff\(layers\.rgbUrl, "RGB"\)/);
});

test("normal complete dossiers fail closed instead of returning blank diagnostic source photos", async () => {
  const manager = await source("lib/pilotpaper-complete-dossiers.ts");
  const route = await source("app/api/dp-piece/route.ts");

  assert.doesNotMatch(manager, /testMode:\s*true/);
  assert.match(manager, /record\.pieces\[dp\] = \{ status: "error", error: message/);
  assert.match(route, /input\.testMode === true/);
  assert.doesNotMatch(route, /input\.testMode !== false/);
  assert.match(route, /status: 422/);
});

test("installed V2 preserves geometry receipts and vector references through the one-click chain", async () => {
  const complete = await source("components/production/complete-dp-experience.tsx");
  const launcher = await source("desktop/PilotPaperLauncher/PilotPaperV2Program.cs");
  const geometryMain = await source("geometry-engine/main.py");

  assert.match(complete, /image\/svg\+xml/);
  assert.match(complete, /geometryReceipt:\s*candidate\.geometryReceipt/);
  assert.match(launcher, /DP_TEST_EXPORT"\]\s*=\s*"false"/);
  assert.doesNotMatch(launcher, /DP_TEST_EXPORT"\]\s*=\s*"true"/);
  assert.match(geometryMain, /unary_union/);
  assert.match(geometryMain, /target\.covers\(Point\(x, y\)\)/);
});

test("installed DP route dispatches every V2 geometry piece to the new deterministic chain", async () => {
  const route = await source("app/api/dp-piece/route.ts");

  assert.match(route, /input\.dp === 2[\s\S]*generateDeterministicDp2/);
  assert.match(route, /input\.dp === 3[\s\S]*generateDeterministicSiteTwinPiece/);
  assert.match(route, /input\.dp === 4[\s\S]*generateGeometryLockedDp4/);
  assert.match(route, /input\.dp === 5 \|\| input\.dp === 6[\s\S]*generateGeometryLockedPhotographicDp/);
});
