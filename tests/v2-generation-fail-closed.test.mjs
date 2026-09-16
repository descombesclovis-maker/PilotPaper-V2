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

test("DP2-DP6 endpoint fails closed instead of returning diagnostic or empty pieces", async () => {
  const route = await source("app/api/dp-piece/route.ts");
  assert.doesNotMatch(route, /generateDiagnosticFallback/);
  assert.match(route, /result\.inspector\?\.passed !== true/);
  assert.match(route, /!result\.geometryReceipt/);
  assert.match(route, /!result\.base64 \|\| result\.base64\.length < 500/);
  assert.match(route, /X-PilotPaper-Diagnostic": "0"/);
  assert.match(route, /status: 422/);
});

test("photo insertion requires projection, visual edit and changed PV pixels", async () => {
  const edit = await source("lib/site-twin-v2/constrainedPhotoEdit.ts");
  const photographic = await source("lib/site-twin-v2/constrainedPhotographicDp.ts");
  assert.match(edit, /projectSiteTwinModulesToPhoto/);
  assert.match(edit, /api\.openai\.com\/v1\/images\/edits/);
  assert.match(edit, /if \(!rawCropCandidate\)/);
  assert.match(edit, /if \(changeRatio < 0\.12\)/);
  assert.match(photographic, /photovoltaicModulesClearlyRendered/);
  assert.match(photographic, /visualPass\(judge/);
  assert.match(photographic, /throw new Error\(`DP\$\{input\.dp\} rejetée après/);
});
