import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const contract = await readFile(new URL("../lib/dp-piece-contract.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const workbench = await readFile(new URL("../components/dp-piece-workbench.tsx", import.meta.url), "utf8");
const updateButton = await readFile(new URL("../components/pilotpaper-update-button.tsx", import.meta.url), "utf8");
const launcher = await readFile(new URL("../desktop/PilotPaperLauncher/Program.cs", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/build-v1-k-par-k-windows.yml", import.meta.url), "utf8");
const viteConfig = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

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
});

test("V1 updater is manual, build-aware, visible and verifies the downloaded installer", () => {
  assert.match(page, /PilotPaperUpdateButton/);
  assert.match(updateButton, /CHECK_UPDATE/);
  assert.match(updateButton, /pilotpaper-update-status/);
  assert.match(updateButton, /addEventListener\("message"/);
  assert.match(updateButton, /PilotPaper V1 est à jour|Vérification de la dernière V1/);
  assert.match(updateButton, /Mettre à jour PilotPaper/);
  assert.match(launcher, /CheckForUpdateAsync/);
  assert.match(launcher, /PostUpdateStatus/);
  assert.match(launcher, /PILOTPAPER-BUILD\.txt/);
  assert.match(launcher, /target_commitish/);
  assert.match(launcher, /SHA256\.HashDataAsync/);
  assert.doesNotMatch(launcher, /Shown \+= async \(_, _\) => await CheckForUpdateAsync/);
});

test("local OpenAI key is bridged into the Cloudflare worker runtime", () => {
  assert.match(launcher, /SyncDevVarsToWorkerProject/);
  assert.match(launcher, /ReadLocalVar\("OPENAI_API_KEY"\)/);
  assert.match(launcher, /WriteLocalVar\("OPENAI_API_KEY", key\)/);
  assert.match(viteConfig, /OPENAI_API_KEY: process\.env\.OPENAI_API_KEY/);
  assert.match(worker, /OPENAI_API_KEY\?: string/);
  assert.match(worker, /process\.env\[key\] = value/);
});

test("V1 build produces a fixed named V1 folder, installer and build identity", () => {
  assert.match(workflow, /PilotPaper-V1-Setup\.exe/);
  assert.match(workflow, /PilotPaper-V1\.zip/);
  assert.match(workflow, /Join-Path \$PWD "V1"/);
  assert.match(workflow, /pilotpaper-v1-test-latest/);
  assert.match(workflow, /PILOTPAPER-BUILD\.txt/);
});
