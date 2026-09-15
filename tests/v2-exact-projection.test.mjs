import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("local roof coordinates are converted from real face correspondences with a strict residual gate", async () => {
  const transform = await source("lib/site-twin-v2/localGeoTransform.ts");
  assert.match(transform, /bestTriangle/);
  assert.match(transform, /solve3/);
  assert.match(transform, /polygonLocalM/);
  assert.match(transform, /polygonLonLat/);
  assert.match(transform, /rmsErrorMeters/);
  assert.match(transform, /rmsErrorMeters > 0\.12/);
  assert.match(transform, /modulePolygonsToLonLat/);
});

test("DP photo projection sends exact module lon-lat corners instead of approximating metres as degrees", async () => {
  const renderer = await source("lib/site-twin-v2/constrainedPhotoEdit.ts");
  const client = await source("lib/site-twin-v2/geometryEngineClient.ts");
  const runtime = await source("geometry-engine/site_twin_projection_api.py");

  assert.match(renderer, /modulePolygonsToLonLat/);
  assert.match(renderer, /modulePolygonsLonLat/);
  assert.match(client, /modulePolygonsLonLat: TwinLonLat\[\]\[\]/);
  assert.match(client, /module_polygons_lonlat/);
  assert.doesNotMatch(client, /origin_lon|origin_lat/);

  assert.match(runtime, /_module_polygons_lonlat/);
  assert.match(runtime, /Transformer\.from_crs\("EPSG:4326", dataset\.crs, always_xy=True\)/);
  assert.match(runtime, /module_polygons_lonlat: str = Form/);
  assert.doesNotMatch(runtime, /_local_to_lonlat/);
  assert.doesNotMatch(runtime, /111_320|110_540|origin_lon|origin_lat/);
});

test("visual integration cannot enlarge module geometry outside a tiny feather ring", async () => {
  const renderer = await source("lib/site-twin-v2/constrainedPhotoEdit.ts");
  const compositor = await source("lib/dp-ai-engine/utils/pngPixels.ts");
  assert.match(renderer, /geometryLockedCompositePng/);
  assert.match(renderer, /COMPOSITE_FEATHER_PIXELS = 4/);
  assert.match(renderer, /OUTSIDE_BLEND_MAX = 0\.18/);
  assert.match(compositor, /inside each exact projected module polygon/);
  assert.match(compositor, /outsideBlendMax\?\?\.20/);
  assert.match(compositor, /Math\.min\(\.35,options\.outsideBlendMax/);
  assert.match(compositor, /every other source pixel remains byte-for-byte unchanged/);
});

test("Windows packaging smoke-test requires the Site Twin photo projection endpoint", async () => {
  const workflow = await source(".github/workflows/build-v2-windows.yml");
  const runtime = await source("geometry-engine/run.py");
  const health = await source("geometry-engine/main.py");
  assert.match(runtime, /site_twin_projection_api/);
  assert.match(health, /site-twin-photo-projection/);
  assert.match(workflow, /site-twin-photo-projection/);
  assert.match(workflow, /\/v1\/site-twin\/project-modules/);
});
