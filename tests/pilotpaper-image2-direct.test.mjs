import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("DP route uses the deterministic Site Twin pipeline for DP2-DP6", async () => {
  const route = await source("app/api/dp-piece/route.ts");
  assert.match(route, /generateOfficialDp1/);
  assert.match(route, /generateDeterministicDp2/);
  assert.match(route, /generateDeterministicSiteTwinPiece/);
  assert.match(route, /generateGeometryLockedDp4/);
  assert.match(route, /generateGeometryLockedPhotographicDp/);
  assert.match(route, /site-twin-georeferenced-plan/);
  assert.match(route, /site-twin-vector-section/);
  assert.match(route, /site-twin-before-after-composition/);
  assert.match(route, /site-twin-masked-photorealistic/);
  assert.doesNotMatch(route, /generatePreventiveDp|generateSpecializedDp3|generateSpecializedDp4/);
});

test("geometry-locked photographic insertion separates AI working halo from hard PV geometry", async () => {
  const renderer = await source("lib/site-twin-v2/constrainedPhotoEdit.ts");
  const compositor = await source("lib/dp-ai-engine/utils/pngPixels.ts");
  const projection = await source("lib/site-twin-v2/geometryEngineClient.ts");
  const runtime = await source("geometry-engine/site_twin_projection_api.py");
  assert.match(renderer, /buildSiteTwinDocumentContext/);
  assert.match(renderer, /projectSiteTwinModulesToPhoto/);
  assert.match(renderer, /buildPanelIslandsMaskForPng/);
  assert.match(renderer, /annotatePngWithPanelPolygons/);
  assert.match(renderer, /geometryLockedCompositePng/);
  assert.match(renderer, /AI_EDIT_PADDING/);
  assert.match(renderer, /COMPOSITE_FEATHER_PIXELS/);
  assert.match(renderer, /OUTSIDE_BLEND_MAX/);
  assert.match(renderer, /cropAroundPanelField/);
  assert.match(renderer, /LOCAL_RENDER_LONG_EDGE_PX = 2048/);
  assert.match(renderer, /form\.set\("size", outputSize\)/);
  assert.match(renderer, /restoreCropIntoFullImage/);
  assert.match(renderer, /high-resolution local crop/);
  assert.match(renderer, /\/v1\/images\/edits/);
  assert.match(renderer, /Everything beyond the narrow edit halo is immutable/);
  assert.match(renderer, /changedIslandRatio/);
  assert.match(compositor, /inside each exact projected module polygon/);
  assert.match(compositor, /outsideBlendMax/);
  assert.match(compositor, /every other source pixel remains byte-for-byte unchanged/);
  assert.match(projection, /\/v1\/site-twin\/project-modules/);
  assert.match(runtime, /register_images/);
  assert.match(runtime, /panelPolygonsNormalized/);
  assert.match(runtime, /registration\.inliers|registration\.matches|inlierRatio/);
});

test("DP2 projects the exact Site Twin modules on the official aerial cadastral view without generative placement", async () => {
  const route = await source("app/api/dp-piece/route.ts");
  const generator = await source("lib/site-twin-v2/constrainedDp2.ts");
  const overlay = await source("lib/site-twin-v2/planningOverlay.ts");
  assert.match(route, /if \(input\.dp === 2\) return generateDeterministicDp2/);
  assert.match(generator, /buildSiteTwinDocumentContext/);
  assert.match(generator, /HR\.ORTHOIMAGERY\.ORTHOPHOTOS,CADASTRALPARCELS\.PARCELLAIRE_EXPRESS/);
  assert.match(generator, /context\.layout\.modules/);
  assert.match(generator, /overlayPlanningPanelsPng/);
  assert.match(generator, /polygons\.length !== context\.layout\.configuration\.panelCount/);
  assert.match(overlay, /Each physical module receives its own visible border/);
  assert.doesNotMatch(generator, /OPENAI_API_KEY|gpt-image|\/v1\/images/);
});

test("DP1 is deterministic from official IGN and API Carto geometry and does not spend an image-generation call", async () => {
  const route = await source("app/api/dp-piece/route.ts");
  const generator = await source("lib/pilotpaper-dp1-generator.ts");
  assert.match(route, /if \(input\.dp === 1\) return assertGeneratedVisualPiece\(await generateOfficialDp1/);
  assert.match(generator, /apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
  assert.match(generator, /PilotPaper refuse de deviner la parcelle/);
  assert.match(generator, /DP1 déterministe : aucune IA générative utilisée/);
  assert.match(generator, /Contour cible issu directement de l'API Carto Cadastre/);
  assert.doesNotMatch(generator, /\/v1\/images|gpt-image|OPENAI_API_KEY/);
});

test("DP3 is a metric vector section perpendicular to a proven ridge, not an AI-generated house image", async () => {
  const route = await source("app/api/dp-piece/route.ts");
  const bridge = await source("lib/site-twin-v2/dpPieceBridge.ts");
  const renderer = await source("lib/site-twin-v2/renderers/dp3.ts");
  assert.match(route, /if \(input\.dp === 3\) return generateDeterministicSiteTwinPiece/);
  assert.match(bridge, /renderDp3FromSiteTwin/);
  assert.match(renderer, /edge\.kind === "ridge"/);
  assert.match(renderer, /sectionDirectionFromRidge/);
  assert.match(renderer, /Coupe A-A perpendiculaire au faîtage/);
  assert.match(renderer, /terrainElevationM/);
  assert.match(renderer, /context\.layout\.modules/);
  assert.match(renderer, /aucune épaisseur de fixation ni hauteur de surimposition non vérifiée n'est cotée/);
  assert.doesNotMatch(renderer, /OPENAI_API_KEY|gpt-image|\/v1\/images/);
});

test("DP4 is composed from the immutable real photo and the same geometry-locked projected state", async () => {
  const route = await source("app/api/dp-piece/route.ts");
  const generator = await source("lib/site-twin-v2/constrainedDp4.ts");
  assert.match(route, /if \(input\.dp === 4\) return generateGeometryLockedDp4/);
  assert.match(generator, /generateGeometryLockedPhotographicDp/);
  assert.match(generator, /ÉTAT INITIAL/);
  assert.match(generator, /ÉTAT PROJETÉ/);
  assert.match(generator, /pixels hors champ photovoltaïque sont restaurés/i);
  assert.match(generator, /Mise en page état initial \/ état projeté réalisée par PilotPaper/);
  assert.doesNotMatch(route, /generateSpecializedDp4/);
});

test("DP5 and DP6 keep geometry fixed while visual QA may retry panel material only", async () => {
  const route = await source("app/api/dp-piece/route.ts");
  const generator = await source("lib/site-twin-v2/constrainedPhotographicDp.ts");
  assert.match(route, /generateGeometryLockedPhotographicDp/);
  assert.match(generator, /MAX_VISUAL_ATTEMPTS = 3/);
  assert.match(generator, /same immutable islands/);
  assert.match(generator, /Improve only panel material, reflections, local lighting, contact shadows and edge integration/);
  assert.match(generator, /Do not alter geometry or module locations/);
  assert.match(generator, /judge\.score >= 0\.88/);
  assert.match(generator, /Pixels hors insertion préservés : oui/);
});

test("DP2 remains the persistent master reference through the K-par-k chain", async () => {
  const engine = await source("lib/pilotpaper-vision-engine.ts");
  const ui = await source("components/dp-piece-workbench.tsx");
  const persistence = await source("lib/pilotpaper-image2-persistence.ts");
  assert.match(engine, /3: \[2\]/);
  assert.match(engine, /4: \[2\]/);
  assert.match(engine, /5: \[2, 4\]/);
  assert.match(engine, /6: \[2, 4, 5\]/);
  assert.match(ui, /resultsByDp/);
  assert.match(ui, /resultsRef/);
  assert.match(ui, /persistDpPiece/);
  assert.match(ui, /loadPersistedDpPieces/);
  assert.match(persistence, /indexedDB\.open/);
  assert.match(persistence, /generated-dp-pieces/);
});

test("visible forms ask only for minimum project facts and required photos", async () => {
  const contract = await source("lib/dp-piece-contract.ts");
  const commonBlock = contract.match(/const commonPvFields:[\s\S]*?\];/)?.[0] ?? "";
  assert.match(commonBlock, /"address"/);
  assert.match(commonBlock, /"moduleReference"/);
  assert.match(commonBlock, /"panelCount"/);
  assert.match(commonBlock, /"rows"/);
  assert.match(commonBlock, /"columns"/);
  assert.match(commonBlock, /"orientation"/);
  assert.doesNotMatch(commonBlock, /instructions|roofWidthMm|roofSlopeLengthMm|roofSlopeDeg|gutterClearanceMm|interPanelGapMm|placement/);
  assert.match(contract, /fields: \[\.\.\.commonPvFields, "nearPhoto"\]/);
  assert.match(contract, /fields: \[\.\.\.commonPvFields, "roofPhoto"\]/);
  assert.match(contract, /fields: \[\.\.\.commonPvFields, "farPhoto"\]/);
});

test("provider wording is removed case-insensitively from the visible interface", async () => {
  const client = await source("components/dp-piece-workbench-client.tsx");
  assert.match(client, /sanitizeVisibleProviderWording/);
  assert.match(client, /PilotPaper Vision/);
  assert.equal(client.includes(".replace(/chatgpt"), true);
  assert.equal(client.includes("/gi"), true);
  assert.equal(client.includes(".replace(/openai/gi"), true);
});

test("visual generations stay sequential, persistent and reopenable without covering finished documents", async () => {
  const ui = await source("components/dp-piece-workbench.tsx");
  const generationUi = await source("components/solar-generation-ui.tsx");
  assert.match(ui, /queueRef/);
  assert.match(ui, /processingRef/);
  assert.match(ui, /async function processQueue/);
  assert.match(ui, /queueRef\.current\.shift\(\)/);
  assert.match(ui, /GenerationDock/);
  assert.match(ui, /SolarGenerationStage/);
  assert.match(ui, /Effacer et recommencer/);
  assert.match(generationUi, /PILOTPAPER LIVE/);
  assert.match(generationUi, /FILE D’ATTENTE/);
  assert.match(generationUi, /Aucun faux pourcentage/);
  assert.match(generationUi, /const collapsed = !running && !expanded/);
  assert.match(generationUi, /Ouvrir PilotPaper Live/);
});

test("DP7 and DP8 preserve original photos", async () => {
  const pieceEngine = await source("lib/dp-piece-engine.ts");
  assert.match(pieceEngine, /photographie originale conservée sans génération/i);
  assert.match(pieceEngine, /Aucune retouche générative/);
});

test("frozen V1 Windows build remains free of the V2 metric engine", async () => {
  const workflow = await source(".github/workflows/build-v1-k-par-k-windows.yml");
  const launcher = await source("desktop/PilotPaperLauncher/Program.cs");
  const installer = await source("desktop/PilotPaperInstaller.iss");
  assert.doesNotMatch(workflow, /Build bundled Geometry Engine|Smoke-test bundled Geometry Engine|PilotPaper-GeometryEngine/);
  assert.doesNotMatch(launcher, /GeometryHealthUrl|StartGeometryEngine|PILOTPAPER_GEOMETRY_ENGINE_URL|GOOGLE_SOLAR_API_KEY/);
  assert.match(installer, /\[InstallDelete\]/);
  assert.match(installer, /\{app\}\\geometry-engine/);
  assert.match(installer, /\{app\}\\app\\current/);
});
