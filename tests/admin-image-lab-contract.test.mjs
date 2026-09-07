import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const routePath = path.join(root, "app/api/projects/[id]/admin-image-test/route.ts");
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
  assert.match(route, /Promise\.all\(\[fetchIgnPng\(situationUrl\), fetchIgnPng\(massUrl\)\]\)/);
});

test("admin image lab persists output as test_unverified", () => {
  assert.match(route, /status:\s*"test_unverified"/);
  assert.match(route, /'test_unverified'/);
  assert.match(route, /admin-tests/);
});
