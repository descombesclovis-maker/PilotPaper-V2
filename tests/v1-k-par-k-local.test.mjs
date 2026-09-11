import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const contract = await readFile(new URL("../lib/dp-piece-contract.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const workbench = await readFile(new URL("../components/dp-piece-workbench.tsx", import.meta.url), "utf8");
const launcher = await readFile(new URL("../desktop/PilotPaperLauncher/Program.cs", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/build-v1-k-par-k-windows.yml", import.meta.url), "utf8");

test("V1 exposes exactly DP1 through DP8 as isolated contracts", () => {
  for (let dp = 1; dp <= 8; dp += 1) assert.match(contract, new RegExp(`dp: ${dp},`));
  assert.equal((contract.match(/\bdp: [1-8],/g) ?? []).length, 8);
});

test("obsolete admin DP image laboratory is no longer the application entry point", () => {
  assert.match(page, /DpPieceWorkbench/);
  assert.doesNotMatch(page, /AdminDpImageLab|admin-image-test/);
  assert.match(workbench, /MODE TEST · NON VALIDÉ/);
  assert.match(workbench, /Une pièce\. Un formulaire/);
});

test("V1 launcher is a single-instance embedded local application", () => {
  assert.match(launcher, /MutexName/);
  assert.match(launcher, /NamedPipeServerStream/);
  assert.match(launcher, /WebView2/);
  assert.match(launcher, /127\.0\.0\.1:5174/);
  assert.match(launcher, /DP_TEST_EXPORT"\] = "true"/);
  assert.match(launcher, /DP_TEST_FAST"\] = "false"/);
  assert.doesNotMatch(launcher, /Process\.Start\(new ProcessStartInfo\(AppUrl\)/);
  assert.doesNotMatch(launcher, /CheckForUpdateAsync|ReleaseApiUrl/);
});

test("V1 build produces a fixed named V1 folder and installer", () => {
  assert.match(workflow, /PilotPaper-V1-Setup\.exe/);
  assert.match(workflow, /PilotPaper-V1\.zip/);
  assert.match(workflow, /Join-Path \$PWD "V1"/);
  assert.match(workflow, /pilotpaper-v1-test-latest/);
});
