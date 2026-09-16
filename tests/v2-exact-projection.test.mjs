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

test("DP2 and photo projection share the same exact local-to-geographic transform", async () => {
  const dp2 = await source("lib/site-twin-v2/constrainedDp2.ts");
  const renderer = await source("lib/site-twin-v2/constrainedPhotoEdit.ts");
  const client = await source("lib/site-twin-v2/geometryEngineClient.ts");
  const runtime = await source("geometry-engine/site_twin_projection_api.py");

  assert.match(dp2, /modulePolygonsToLonLat/);
  assert.match(dp2, /modulePolygonsLonLat/);
  assert.doesNotMatch(dp2, /localToLonLat|111_320|110_540/);

  assert.match(renderer, /modulePolygonsToLonLat/);
  assert.match(renderer, /modulePolygonsLonLat/);
  assert.match(client, /modulePolygonsLonLat: TwinLonLat\[\]\[\]/);
  assert.match(client, /module_polygons_lonlat/);
  assert.match(client, /reference_crs/);
  assert.match(client, /reference_bbox/);
  assert.doesNotMatch(client, /origin_lon|origin_lat/);

  assert.match(runtime, /_module_polygons_lonlat/);
  assert.match(runtime, /reference_crs = dataset\.crs if dataset is not None else explicit_crs/);
  assert.match(runtime, /Transformer\.from_crs\("EPSG:4326", reference_crs, always_xy=True\)/);
  assert.match(runtime, /pixel_x = \(\(float\(ref_x\) - min_x\) \/ \(max_x - min_x\)\) \* explicit_width/);
  assert.match(runtime, /pixel_y = \(\(max_y - float\(ref_y\)\) \/ \(max_y - min_y\)\) \* explicit_height/);
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

test("every V2 downstream DP carries and verifies an exact Site Twin layout fingerprint", async () => {
  const context = await source("lib/site-twin-v2/documentContext.ts");
  const types = await source("lib/pilotpaper-image2-types.ts");
  const bridge = await source("lib/site-twin-v2/dpPieceBridge.ts");
  const dp2 = await source("lib/site-twin-v2/constrainedDp2.ts");
  const photographic = await source("lib/site-twin-v2/constrainedPhotographicDp.ts");
  const dp4 = await source("lib/site-twin-v2/constrainedDp4.ts");
  const referenceOrder = await source("lib/pilotpaper-dp-reference-order.ts");
  const manualWorkbench = await source("components/dp-piece-workbench.tsx");
  const completeManager = await source("lib/pilotpaper-complete-dossiers.ts");

  assert.match(context, /createHash\("sha256"\)/);
  assert.match(context, /layoutDigestFor/);
  assert.match(context, /rows: layout\.configuration\.rows/);
  assert.match(context, /columns: layout\.configuration\.columns/);
  assert.match(context, /orientation: layout\.configuration\.orientation/);
  assert.match(context, /polygonLocalM: module\.polygonLocalM/);
  assert.match(context, /receipt\.layoutDigest !== context\.layoutDigest/);

  assert.match(types, /geometryReceipt\?: SiteTwinPieceReceipt/);
  assert.match(bridge, /assertPiecesShareContext/);
  assert.match(bridge, /receiptForPiece\(args\.context, args\.dp\)/);
  assert.match(dp2, /geometryReceipt: receiptForPiece\(context, 2\)/);
  assert.match(photographic, /geometryReceipt: receiptForPiece\(rendered\.context, input\.dp\)/);
  assert.match(dp4, /geometryReceipt: projected\.geometryReceipt/);

  assert.match(referenceOrder, /geometryReceipt: candidate\.geometryReceipt/);
  assert.match(manualWorkbench, /geometryReceipt: candidate\.geometryReceipt/);
  assert.match(completeManager, /referencesFromResults/);
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
