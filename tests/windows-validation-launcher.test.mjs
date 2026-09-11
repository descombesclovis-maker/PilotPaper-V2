import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const devStarter = readFileSync(`${root}/scripts/start-web.ps1`, "utf8");
const validationStarter = readFileSync(`${root}/scripts/start-web-validation.ps1`, "utf8");
const restart = readFileSync(`${root}/scripts/restart-pilotpaper.ps1`, "utf8");
const packageJson = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));

test("ordinary local development remains explicitly fast and unverified", () => {
  assert.match(devStarter, /DP_TEST_EXPORT\s*=\s*"true"/);
  assert.match(devStarter, /DP_TEST_FAST\s*=\s*"true"/);
  assert.match(devStarter, /DP_MAX_RETRIES\s*=\s*"0"/);
});

test("V1 validation launcher clears all development overrides", () => {
  assert.match(validationStarter, /Remove-Item Env:DP_TEST_EXPORT/);
  assert.match(validationStarter, /Remove-Item Env:DP_TEST_FAST/);
  assert.match(validationStarter, /Remove-Item Env:DP_MAX_RETRIES/);
  assert.doesNotMatch(validationStarter, /DP_TEST_EXPORT\s*=\s*"true"/);
  assert.doesNotMatch(validationStarter, /DP_TEST_FAST\s*=\s*"true"/);
  assert.doesNotMatch(validationStarter, /DP_MAX_RETRIES\s*=\s*"0"/);
});

test("Windows restart routes ProductionValidation to the strict starter", () => {
  assert.match(restart, /\[switch\]\$ProductionValidation/);
  assert.match(restart, /start-web-validation\.ps1/);
  assert.match(packageJson.scripts["pilotpaper:validate:windows"], /start-pilotpaper-validation\.ps1/);
});
