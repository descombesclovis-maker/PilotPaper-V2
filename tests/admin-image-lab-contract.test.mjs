import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const routePath = path.join(
  root,
  "app/api/projects/[id]/admin-image-test/route.ts",
);
const route = await readFile(routePath, "utf8");

test("admin image lab enforces server-side administrator authorization", () => {
  assert.match(route, /isPilotPaperAdmin\(user\.email/);
  assert.match(route, /status:\s*403/);
});

test("admin image lab accepts only DP4 or DP6", () => {
  assert.match(route, /input\.dp\s*!==\s*4\s*&&\s*input\.dp\s*!==\s*6/);
  assert.doesNotMatch(route, /buildDpPdf/);
  assert.doesNotMatch(route, /generated_dossier/);
});

test("admin image lab loads only near and roof user photos", () => {
  assert.match(route, /kind IN \('near', 'roof'\)/);
  assert.match(route, /\["near",\s*"roof"\]/);
  assert.doesNotMatch(route, /kind IN \('near', 'roof', 'far'\)/);
});

test("admin image lab obtains both official IGN views automatically", () => {
  assert.match(route, /SITUATION_GROUND_WIDTH_METERS/);
  assert.match(route, /MASS_GROUND_WIDTH_METERS/);
  assert.match(
    route,
    /Promise\.all\(\[\s*fetchIgnPng\(situationUrl\),\s*fetchIgnPng\(massUrl\),?\s*\]\)/,
  );
});

test("admin image lab uses projective panel geometry without changing production defaults", () => {
  assert.match(
    route,
    /new OpenAIImageEditor\(apiKey,\s*imageModel,\s*"projective"\)/,
  );
  assert.match(route, /allPanelPolygonsForRoleProjective/);
  assert.match(route, /planar-homography-v1/);
});

test("admin image lab makes exactly one image-generation call", () => {
  const edits = route.match(/await editor\.edit\(/g) ?? [];
  assert.equal(edits.length, 1);
  assert.doesNotMatch(route, /visual\.generate\(/);
  assert.doesNotMatch(route, /editor\.edit\([\s\S]*editor\.edit\(/);
});

test("admin image lab persists deterministic geometry and outside-mask audit", () => {
  assert.match(route, /auditDeterministicImage/);
  assert.match(route, /deterministicAuditPassed/);
  assert.match(route, /auditObjectKey/);
  assert.match(route, /X-PilotPaper-Outside-Mask/);
  assert.match(route, /X-PilotPaper-Overlap-Pairs/);
});

test("admin image lab distinguishes strict vision from test fallback geometry", () => {
  assert.match(route, /TEST_UNVERIFIED_VISION_FALLBACK/);
  assert.match(route, /visionFallbackUsed/);
  assert.match(route, /X-PilotPaper-Vision/);
  assert.match(route, /needs_confirmation/);
});

test("admin image lab runs non-blocking visual QA on the already generated image", () => {
  assert.match(route, /new OpenAIQualityJudge\(/);
  assert.match(route, /"projective"/);
  assert.match(route, /qualityAuditError/);
  assert.match(route, /X-PilotPaper-AI-QA/);
  assert.match(route, /X-PilotPaper-Photorealism-Score/);
  assert.match(route, /qualityAudit:\s*qualityAudit\s*\?\?\s*null/);
});

test("admin image lab exposes resolved physical clearances for diagnostics", () => {
  assert.match(route, /X-PilotPaper-Gutter-MM/);
  assert.match(route, /X-PilotPaper-Ridge-MM/);
  assert.match(route, /X-PilotPaper-Left-MM/);
  assert.match(route, /X-PilotPaper-Right-MM/);
  assert.match(route, /X-PilotPaper-Field-Width-MM/);
  assert.match(route, /X-PilotPaper-Field-Height-MM/);
});

test("admin image lab persists output as test_unverified", () => {
  assert.match(route, /status:\s*"test_unverified"/);
  assert.match(route, /'test_unverified'/);
  assert.match(route, /admin-tests/);
});
