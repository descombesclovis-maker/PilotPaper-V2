import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V2 records unavailable independent geometry honestly instead of pretending it executed", async () => {
  const resolver = await source("lib/geometry/advanced-roof-truth.ts");
  assert.match(resolver, /if \(!config\.enabled \|\| !config\.configured\)/);
  assert.match(resolver, /attempted: false/);
  assert.match(resolver, /usable: false/);
  assert.match(resolver, /aucun contrôle distant n'a été exécuté/);
  assert.match(resolver, /attempted: Boolean\(runtime\.enabled && runtime\.configured\)/);
});

test("V2 never lets external geometry silently change requested photovoltaic quantity or metric authority", async () => {
  const resolver = await source("lib/geometry/advanced-roof-truth.ts");
  assert.match(resolver, /Never change the requested PilotPaper panel count or matrix/);
  assert.match(resolver, /PilotPaper metric Site Twin remains the coordinate authority/);
});

test("V2 reuses one deterministic remote project per normalized address", async () => {
  const resolver = await source("lib/geometry/advanced-roof-truth.ts");
  assert.match(resolver, /createHash\("sha256"\)/);
  assert.match(resolver, /pilotpaper-v2-/);
  assert.match(resolver, /listOpenSolarProjects\(100\)/);
  assert.match(resolver, /createOpenSolarProject/);
});

test("V2 advanced roof evidence is consumed by the canonical Site Twin pan-by-pan but never becomes primary geometry", async () => {
  const resolver = await source("lib/geometry/advanced-roof-truth.ts");
  const builder = await source("lib/site-twin-v2/siteTwinBuilder.ts");
  const crossCheck = await source("lib/site-twin-v2/advancedRoofCrossCheck.ts");
  const policy = await source("lib/site-twin-v2/policy.ts");

  assert.match(resolver, /export type AdvancedRoofFacet/);
  assert.match(resolver, /slopeDeg/);
  assert.match(resolver, /azimuthDeg/);
  assert.match(resolver, /areaM2/);

  assert.match(builder, /resolveAdvancedRoofTruth/);
  assert.match(builder, /compareAdvancedFacets\(geometry\.faces, advancedRoof\.facets\)/);
  assert.match(builder, /advancedRoofCrossCheck: advancedComparison\.crossCheck/);
  assert.doesNotMatch(builder, /buildAdvancedRoofMetricFallback/);
  assert.match(builder, /refuse d'utiliser le contrôle géométrique indépendant comme autorité de coordonnées/);
  assert.match(builder, /advancedRoofAttempted: advancedRoof\.attempted/);

  assert.match(crossCheck, /azimuthDeltaDeg/);
  assert.match(crossCheck, /slopeDeltaDeg/);
  assert.match(crossCheck, /areaRelativeError/);
  assert.match(crossCheck, /centroidDistanceM/);
  assert.match(crossCheck, /boundaryMeanDistanceM/);
  assert.match(crossCheck, /azimuthDelta <= 15/);
  assert.match(crossCheck, /slopeDelta <= 7/);
  assert.match(crossCheck, /areaRelativeError <= 0\.30/);
  assert.match(crossCheck, /status: best\.close \? "agreement" : "conflict"/);
  assert.match(crossCheck, /Δazimut/);
  assert.match(crossCheck, /Δpente/);
  assert.match(crossCheck, /Δsurface/);

  assert.match(policy, /twin\.sources\.advancedRoofCrossCheck/);
  assert.match(policy, /structured\.blockingConflict/);
  assert.match(policy, /comparisons: structured\.comparisons/);
  assert.match(policy, /refuse de choisir silencieusement entre deux géométries/);
});

test("embedded geometry engine really consumes sampled IGN points and reports obstacle/topology capabilities", async () => {
  const engine = await source("geometry-engine/app.py");
  const runtime = await source("geometry-engine/main.py");
  const builder = await source("lib/site-twin-v2/siteTwinBuilder.ts");
  const workflow = await source(".github/workflows/build-v2-windows.yml");
  assert.match(engine, /sampled_points: str \| None/);
  assert.match(engine, /_extract_sampled_points/);
  assert.match(engine, /_detect_metric_obstacles/);
  assert.match(engine, /_classify_shared_edge/);
  assert.match(runtime, /sampled-elevation-points/);
  assert.match(runtime, /metric-obstacles/);
  assert.match(runtime, /roof-edge-topology/);
  assert.match(builder, /sampleIgnLidarSurface/);
  assert.match(builder, /source: "ign-mns"/);
  assert.match(workflow, /sampled-elevation-points/);
  assert.match(workflow, /metric-obstacles/);
  assert.match(workflow, /roof-edge-topology/);
});

test("deterministic PV layout respects metric obstacle safety envelopes", async () => {
  const layout = await source("lib/site-twin-v2/pvLayoutEngine.ts");
  assert.match(layout, /obstacle\.keepoutMm/);
  assert.match(layout, /expandedBounds/);
  assert.match(layout, /zones de sécurité des obstacles/);
  assert.match(layout, /boundsIntersect\(moduleBounds, expandedBounds/);
});

test("camera registration rejects geometrically weak matches before DP projection", async () => {
  const policy = await source("lib/site-twin-v2/policy.ts");
  const registration = await source("lib/site-twin-v2/cameraRegistration.ts");
  assert.match(policy, /minimumAutomaticCameraInliers: 12/);
  assert.match(policy, /minimumAutomaticCameraInlierRatio: 0\.28/);
  assert.match(registration, /result\.inliers < SITE_TWIN_POLICY\.minimumAutomaticCameraInliers/);
  assert.match(registration, /inlierRatio < SITE_TWIN_POLICY\.minimumAutomaticCameraInlierRatio/);
  assert.match(registration, /Erreur médiane de reprojection/);
});

test("DP3 vector section uses proven ridge topology and never invents mounting height", async () => {
  const renderer = await source("lib/site-twin-v2/renderers/dp3.ts");
  assert.match(renderer, /edge\.kind === "ridge"/);
  assert.match(renderer, /sectionDirectionFromRidge/);
  assert.match(renderer, /sectionOriginOnRidge/);
  assert.match(renderer, /sectionIntersections/);
  assert.match(renderer, /Coupe A-A perpendiculaire au faîtage/);
  assert.match(renderer, /sectionMode: ridge \? "perpendicular-to-ridge" : "single-slope"/);
  assert.match(renderer, /aucune épaisseur de fixation ni hauteur de surimposition non vérifiée n'est cotée/);
  assert.doesNotMatch(renderer, /zAt\(face, min\.point\) - ground \+ 0\.08/);
  assert.match(renderer, /ÉCHELLE GRAPHIQUE/);
  assert.match(renderer, /marker-start="url\(#dim-arrow\)"/);
});

test("V2 route consumes one canonical Site Twin path instead of dormant legacy geometry prompts", async () => {
  const route = await source("app/api/dp-piece/route.ts");
  const bridge = await source("lib/site-twin-v2/dpPieceBridge.ts");
  const builder = await source("lib/site-twin-v2/siteTwinBuilder.ts");
  assert.match(route, /generateDeterministicDp2/);
  assert.match(route, /generateDeterministicSiteTwinPiece/);
  assert.match(route, /generateGeometryLockedDp4/);
  assert.match(route, /generateGeometryLockedPhotographicDp/);
  assert.match(bridge, /getOrBuildSiteTwin/);
  assert.match(builder, /resolveAdvancedRoofTruth/);
  assert.doesNotMatch(route, /generatePreventiveDp|generateSpecializedDp3|generateSpecializedDp4/);
});

test("every fresh dossier executes mandatory DP2 geometry and downstream pieces cannot masquerade another geometry as success", async () => {
  const route = await source("app/api/dp-piece/route.ts");
  const bridge = await source("lib/site-twin-v2/dpPieceBridge.ts");
  const builder = await source("lib/site-twin-v2/siteTwinBuilder.ts");
  const photoEdit = await source("lib/site-twin-v2/constrainedPhotoEdit.ts");

  assert.doesNotMatch(route, /generateDiagnosticFallback/);
  assert.match(route, /assertGeneratedVisualPiece/);
  assert.match(route, /result\.inspector\?\.passed !== true/);
  assert.match(route, /!result\.geometryReceipt/);
  assert.match(route, /rendu vide ou incomplet/);
  assert.match(route, /X-PilotPaper-Diagnostic": "0"/);

  assert.match(bridge, /export function requiresFreshSiteTwin/);
  assert.match(bridge, /return input\.dp === 2/);
  assert.match(bridge, /requireMasterDp2Reference\(input\)/);
  assert.match(bridge, /DP2 n'a pas produit d'empreinte géométrique V2 valide/);
  assert.match(bridge, /getOrBuildSiteTwin\(address, \{ force: requiresFreshSiteTwin\(input\) \}\)/);
  assert.match(bridge, /geometryEngineChecked !== true/);
  assert.match(bridge, /advancedRoofAttempted !== true/);

  assert.match(builder, /geometryEngineChecked: true/);
  assert.match(builder, /advancedRoofAttempted: advancedRoof\.attempted/);
  assert.match(builder, /builtAt/);
  assert.doesNotMatch(builder, /buildAdvancedRoofMetricFallback/);

  assert.match(photoEdit, /projectSiteTwinModulesToPhoto/);
  assert.match(photoEdit, /https:\/\/api\.openai\.com\/v1\/images\/edits/);
  assert.match(photoEdit, /!rawCropCandidate \|\| rawCropCandidate\.length < 1000/);
  assert.match(photoEdit, /decodePng\(rawCropCandidate\)/);
  assert.match(photoEdit, /MIN_AGGREGATE_PANEL_CHANGE_RATIO = 0\.15/);
  assert.match(photoEdit, /MIN_SINGLE_PANEL_CHANGE_RATIO = 0\.08/);
  assert.match(photoEdit, /weakestPanel < MIN_SINGLE_PANEL_CHANGE_RATIO/);
});

test("visible geometry routes use provider-neutral wording", async () => {
  const status = await source("app/api/opensolar/status/route.ts");
  const truth = await source("app/api/opensolar/project-truth/route.ts");
  const probe = await source("app/api/geometry-engine/probe/route.ts");
  const launcher = await source("desktop/PilotPaperLauncher/PilotPaperV2Program.cs");

  for (const visibleSource of [status, truth, probe, launcher]) {
    const visibleStrings = [...visibleSource.matchAll(/["`]([^"`\n]*)["`]/g)].map((match) => match[1]);
    const userFacingLeaks = visibleStrings.filter((value) => /OpenSolar/i.test(value) && !/OPENSOLAR_|\/opensolar\//i.test(value));
    assert.deepEqual(userFacingLeaks, []);
  }
  assert.match(status, /moteur géométrique avancé/);
  assert.match(probe, /Analyse géométrique impossible/);
});

test("V2 protected credential is bound to the current Windows user and setup asks only for a token", async () => {
  const credentials = await source("desktop/PilotPaperLauncher/GeometryEngineCredentials.cs");
  assert.match(credentials, /ProtectedData\.Unprotect/);
  assert.match(credentials, /ProtectedData\.Protect/);
  assert.match(credentials, /DataProtectionScope\.CurrentUser/);
  assert.match(credentials, /geometry-engine\.bin/);
  assert.match(credentials, /PromptForToken/);
  assert.match(credentials, /UseSystemPasswordChar = true/);
  assert.doesNotMatch(credentials, /PromptForPassword|Read-Host|username\s*=|email\s*=/i);
});

test("V2 startup validates visual access and rechecks the encrypted geometry session", async () => {
  const bootstrap = await source("desktop/PilotPaperLauncher/PilotPaperV2Bootstrap.cs");
  assert.match(bootstrap, /api\.openai\.com\/v1\/models/);
  assert.match(bootstrap, /gpt-image-2/);
  assert.match(bootstrap, /OPENAI_API_KEY/);
  assert.match(bootstrap, /ProtectedData\.Unprotect/);
  assert.match(bootstrap, /TryDeleteGeometryCredential/);
  assert.match(bootstrap, /token du moteur géométrique/);
});

test("V2 updater is wired from the UI to a dedicated validated release channel", async () => {
  const button = await source("components/pilotpaper-update-button.tsx");
  const shell = await source("components/production/pilotpaper-production-shell.tsx");
  const window = await source("desktop/PilotPaperLauncher/PilotPaperV2Program.cs");
  const updater = await source("desktop/PilotPaperLauncher/PilotPaperV2Updater.cs");
  const workflow = await source(".github/workflows/build-v2-windows.yml");

  assert.match(button, /CHECK_UPDATE/);
  assert.match(button, /dernière V2/);
  assert.match(shell, /<PilotPaperUpdateButton \/>/);
  assert.match(window, /WebMessageReceived \+= OnWebMessageReceived/);
  assert.match(updater, /pilotpaper-v2-latest/);
  assert.match(updater, /PilotPaper-V2-Setup\.exe\.sha256/);
  assert.match(updater, /ComputeSha256Async/);
  assert.match(workflow, /Publish validated V2 update channel/);
  assert.match(workflow, /PilotPaper-Build-SHA:/);
  assert.match(workflow, /Get-FileHash .*SHA256/);
});

test("one-time migration promotes the existing session then removes clear environment values", async () => {
  const seal = await source("scripts/seal-geometry-credential.ps1");
  assert.match(seal, /is_machine_user/);
  assert.match(seal, /ProtectedData.*Protect/s);
  assert.match(seal, /DataProtectionScope.*CurrentUser/s);
  assert.match(seal, /Where-Object \{ \$_ -notmatch '\^OPENSOLAR_'/);
  assert.match(seal, /geometry-engine\.bin/);
});

test("V2 installer is isolated from frozen V1", async () => {
  const installer = await source("desktop/PilotPaperV2Installer.iss");
  const project = await source("desktop/PilotPaperLauncher/PilotPaperLauncher.csproj");
  assert.match(installer, /DefaultDirName=\{localappdata\}\\PilotPaper\\V2/);
  assert.match(installer, /PilotPaper-V2\.exe/);
  assert.doesNotMatch(installer, /DefaultDirName=.*\\V1/);
  assert.match(project, /<AssemblyName>PilotPaper-V2<\/AssemblyName>/);
  assert.match(project, /<StartupObject>PilotPaperLauncher\.PilotPaperV2Bootstrap<\/StartupObject>/);
});
