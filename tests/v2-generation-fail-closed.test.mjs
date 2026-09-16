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

test("photo insertion uses a supported image edit size and rejects weak camera registrations", async () => {
  const edit = await source("lib/site-twin-v2/constrainedPhotoEdit.ts");
  assert.match(edit, /return "auto"/);
  assert.doesNotMatch(edit, /LOCAL_RENDER_LONG_EDGE_PX/);
  assert.match(edit, /form\.set\("output_format", "png"\)/);
  assert.match(edit, /SITE_TWIN_POLICY\.maximumAutomaticReprojectionErrorPx/);
  assert.match(edit, /SITE_TWIN_POLICY\.minimumAutomaticCameraInliers/);
  assert.match(edit, /SITE_TWIN_POLICY\.minimumAutomaticCameraInlierRatio/);
  assert.match(edit, /assertProjectionUsable/);
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
  assert.match(dp4, /imageCount/);
});

test("DP1 refuses blank official maps and off-canvas cadastral geometry", async () => {
  const dp1 = await source("lib/pilotpaper-dp1-generator.ts");
  assert.match(dp1, /assertOfficialMapUsable/);
  assert.match(dp1, /visuellement vide ou uniforme/);
  assert.match(dp1, /pixelPolygonArea/);
  assert.match(dp1, /visibleRings/);
  assert.match(dp1, /hors cadrage ou trop petit/);
});
