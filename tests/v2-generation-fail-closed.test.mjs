import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("fresh dossier generation rebuilds DP2 geometry while downstream pieces reuse the exact DP2 Site Twin context", async () => {
  const bridge = await source("lib/site-twin-v2/dpPieceBridge.ts");
  const cache = await source("lib/site-twin-v2/siteTwinCache.ts");
  const builder = await source("lib/site-twin-v2/siteTwinBuilder.ts");
  const advanced = await source("lib/geometry/advanced-roof-truth.ts");

  assert.match(bridge, /return input\.dp === 2/);
  assert.match(bridge, /requireMasterDp2Reference\(input\)/);
  assert.match(bridge, /DP2 n'a pas produit d'empreinte géométrique V2 valide/);
  assert.match(bridge, /getSiteTwinForContext\(masterReceipt\.contextId\)/);
  assert.match(bridge, /cacheSiteTwinForContext\(context\.contextId, twin\)/);
  assert.match(bridge, /refuse d'en reconstruire un autre silencieusement/);
  assert.match(cache, /const contextCache = new Map/);
  assert.match(cache, /cacheSiteTwinForContext/);
  assert.match(cache, /getSiteTwinForContext/);
  assert.match(builder, /resolveAdvancedRoofTruth\(address, \{ force: true \}\)/);
  assert.match(advanced, /options: \{ force\?: boolean \} = \{\}/);
  assert.match(advanced, /if \(!options\.force\)/);
  assert.match(advanced, /resolveUncached\(address\)/);
});

test("DP endpoint fails closed instead of returning diagnostic, malformed or empty pieces", async () => {
  const route = await source("app/api/dp-piece/route.ts");
  assert.doesNotMatch(route, /generateDiagnosticFallback/);
  assert.match(route, /result\.inspector\?\.passed !== true/);
  assert.match(route, /result\.dp >= 2 && result\.dp <= 6 && !result\.geometryReceipt/);
  assert.match(route, /!result\.base64 \|\| result\.base64\.length < 500/);
  assert.match(route, /image visuellement vide ou uniforme/);
  assert.match(route, /SVG incomplet ou illisible/);
  assert.match(route, /NaN\|Infinity\|undefined/);
  assert.match(route, /DP3 refusée : la coupe ne contient aucune représentation photovoltaïque/);
  assert.match(route, /DP4 refusée : composition avant\/après incomplète/);
  assert.match(route, /JPEG source corrompu/);
  assert.match(route, /WebP source corrompu/);
  assert.match(route, /X-PilotPaper-Diagnostic": "0"/);
  assert.match(route, /status: 422/);
});

test("photo insertion uses a valid high-resolution GPT Image edit canvas and strict camera thresholds", async () => {
  const edit = await source("lib/site-twin-v2/constrainedPhotoEdit.ts");
  assert.match(edit, /LOCAL_RENDER_LONG_EDGE_PX = 2048/);
  assert.match(edit, /Math\.round\(targetWidth \/ 16\) \* 16/);
  assert.match(edit, /Math\.round\(targetHeight \/ 16\) \* 16/);
  assert.match(edit, /resolvedRatio < 1 \/ 3 \|\| resolvedRatio > 3/);
  assert.match(edit, /form\.set\("output_format", "png"\)/);
  assert.match(edit, /form\.set\("input_fidelity", "high"\)/);
  assert.match(edit, /SITE_TWIN_POLICY\.maximumAutomaticReprojectionErrorPx/);
  assert.match(edit, /SITE_TWIN_POLICY\.minimumAutomaticCameraInliers/);
  assert.match(edit, /SITE_TWIN_POLICY\.minimumAutomaticCameraInlierRatio/);
  assert.match(edit, /assertProjectionUsable/);
});

test("GPT Image edit multipart uses the canonical single image field and enforces payload limits", async () => {
  const edit = await source("lib/site-twin-v2/constrainedPhotoEdit.ts");
  assert.match(edit, /form\.set\("image", base64ToBlob\(geometryGuide/);
  assert.doesNotMatch(edit, /image\[\]/);
  assert.match(edit, /MAX_EDIT_IMAGE_BYTES = 50 \* 1024 \* 1024/);
  assert.match(edit, /MAX_EDIT_MASK_BYTES = 4 \* 1024 \* 1024/);
  assert.match(edit, /maskBytes\.length > MAX_EDIT_MASK_BYTES/);
  assert.match(edit, /geometryGuideBytes\.length > MAX_EDIT_IMAGE_BYTES/);
});

test("photo insertion requires a usable mask, a decodable image result and visible change in every panel island", async () => {
  const edit = await source("lib/site-twin-v2/constrainedPhotoEdit.ts");
  const photographic = await source("lib/site-twin-v2/constrainedPhotographicDp.ts");
  assert.match(edit, /projectSiteTwinModulesToPhoto/);
  assert.match(edit, /api\.openai\.com\/v1\/images\/edits/);
  assert.match(edit, /assertMaskUsable\(mask, crop\)/);
  assert.match(edit, /decodePng\(rawCropCandidate\)/);
  assert.match(edit, /perPanelChangedRatios/);
  assert.match(edit, /MIN_AGGREGATE_PANEL_CHANGE_RATIO/);
  assert.match(edit, /MIN_SINGLE_PANEL_CHANGE_RATIO/);
  assert.match(edit, /weakestPanel/);
  assert.match(photographic, /photovoltaicModulesClearlyRendered/);
  assert.match(photographic, /visualPass\(judge/);
  assert.match(photographic, /throw new Error\(`DP\$\{input\.dp\} rejetée après/);
});

test("photographic projection tries Google then an explicitly georeferenced IGN PNG and never invents raster georeferencing", async () => {
  const edit = await source("lib/site-twin-v2/constrainedPhotoEdit.ts");
  const ign = await source("lib/site-twin-v2/ignOrthophoto.ts");
  const client = await source("lib/site-twin-v2/geometryEngineClient.ts");
  const projectionApi = await source("geometry-engine/site_twin_projection_api.py");

  assert.match(edit, /loadRegistrationReferences/);
  assert.match(edit, /projectWithReferenceFallback/);
  assert.match(edit, /source: "google-rgb"/);
  assert.match(edit, /fetchIgnOrthophotoReference/);
  assert.match(edit, /source: ign\.source/);
  assert.match(ign, /FORMAT: "image\/png"/);
  assert.doesNotMatch(ign, /image\/geotiff/);
  assert.match(ign, /crs: "EPSG:3857"/);
  assert.match(ign, /bbox: result\.bbox/);
  assert.match(client, /data\.set\("reference_crs", args\.reference\.crs\)/);
  assert.match(client, /data\.set\("reference_bbox", JSON\.stringify\(args\.reference\.bbox\)\)/);
  assert.match(projectionApi, /reference_crs: str \| None = Form/);
  assert.match(projectionApi, /reference_bbox: str \| None = Form/);
  assert.match(projectionApi, /pixel_x = \(\(float\(ref_x\) - min_x\)/);
  assert.match(projectionApi, /pixel_y = \(\(max_y - float\(ref_y\)\)/);
});

test("geometry engine photo registration has deterministic SIFT and ORB fallbacks", async () => {
  const registration = await source("geometry-engine/registration.py");
  assert.match(registration, /def _register_sift/);
  assert.match(registration, /cv2\.SIFT_create/);
  assert.match(registration, /USAC_MAGSAC/);
  assert.match(registration, /\("SIFT", _register_sift\)/);
  assert.match(registration, /\("ORB", _register_orb\)/);
});

test("visual jobs retry transient provider and network failures but never retry invalid credentials", async () => {
  const resilience = await source("lib/pilotpaper-openai-resilience.ts");
  for (const status of [408, 409, 429, 500, 502, 503, 504]) {
    assert.match(resilience, new RegExp(`status === ${status}`));
  }
  assert.match(resilience, /message\.includes\("timeout"\)/);
  assert.match(resilience, /message\.includes\("fetch failed"\)/);
  assert.match(resilience, /message\.includes\("econnreset"\)/);
  assert.match(resilience, /invalid_api_key/);
  assert.match(resilience, /if \(!isTransientVisualError\(error\)\) throw error/);
});

test("local persistence purges legacy DP artifacts and refuses invalid pieces", async () => {
  const persistence = await source("lib/pilotpaper-image2-persistence.ts");
  assert.match(persistence, /const DB_VERSION = 2/);
  assert.match(persistence, /database\.deleteObjectStore\(STORE_NAME\)/);
  assert.match(persistence, /function isPersistablePiece/);
  assert.match(persistence, /piece\.inspector\?\.passed !== true/);
  assert.match(persistence, /Number\(piece\.dp\) >= 2 && Number\(piece\.dp\) <= 6 && !piece\.geometryReceipt/);
  assert.match(persistence, /une pièce non validée ne peut pas être sauvegardée localement/);
});

test("DP2 rejects blank map backgrounds and panel overlays that are too small to be visible", async () => {
  const dp2 = await source("lib/site-twin-v2/constrainedDp2.ts");
  const overlay = await source("lib/site-twin-v2/planningOverlay.ts");
  assert.match(dp2, /assertPlanningBaseUsable/);
  assert.match(dp2, /visuellement vide ou uniforme/);
  assert.match(dp2, /inspectProjectedModuleGeometry/);
  assert.match(dp2, /changedPixelCount/);
  assert.match(dp2, /changedPixels < context\.layout\.configuration\.panelCount \* 4/);
  assert.match(overlay, /areaPx < 8/);
  assert.match(overlay, /paintedPixels < 4/);
});

test("DP4 before and after composition is forced to use the exact same source photograph", async () => {
  const dp4 = await source("lib/site-twin-v2/constrainedDp4.ts");
  assert.match(dp4, /photos: \[source\]/);
  assert.match(dp4, /projected\.mimeType !== "image\/png"/);
  assert.match(dp4, /projected\.inspector\?\.passed !== true \|\| !projected\.geometryReceipt/);
  assert.match(dp4, /même photographie source et même cadrage/);
  assert.match(dp4, /\(svg\.match\(\/<image \/g\)\?\.length \?\? 0\) !== 2/);
});

test("DP1 refuses blank official maps and off-canvas cadastral geometry", async () => {
  const dp1 = await source("lib/pilotpaper-dp1-generator.ts");
  assert.match(dp1, /assertOfficialMapUsable/);
  assert.match(dp1, /visuellement vide ou uniforme/);
  assert.match(dp1, /pixelPolygonArea/);
  assert.match(dp1, /visibleRings/);
  assert.match(dp1, /hors cadrage ou trop petit/);
});
