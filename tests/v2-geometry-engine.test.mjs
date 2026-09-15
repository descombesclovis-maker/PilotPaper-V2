import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V2 geometry engine is optional and preserves the PilotPaper fallback", async () => {
  const resolver = await source("lib/geometry/advanced-roof-truth.ts");
  assert.match(resolver, /if \(!config\.enabled \|\| !config\.configured\)/);
  assert.match(resolver, /fallback PilotPaper/);
  assert.match(resolver, /usable: false/);
  assert.match(resolver, /catch\(\(error\) => \(\{/);
});

test("V2 never lets external geometry silently change requested photovoltaic quantity", async () => {
  const resolver = await source("lib/geometry/advanced-roof-truth.ts");
  assert.match(resolver, /Never change the requested PilotPaper panel count or matrix/);
  assert.match(resolver, /cadastral parcel and real photographs remain authoritative/);
});

test("V2 reuses one deterministic remote project per normalized address", async () => {
  const resolver = await source("lib/geometry/advanced-roof-truth.ts");
  assert.match(resolver, /createHash\("sha256"\)/);
  assert.match(resolver, /pilotpaper-v2-/);
  assert.match(resolver, /listOpenSolarProjects\(100\)/);
  assert.match(resolver, /createOpenSolarProject/);
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
