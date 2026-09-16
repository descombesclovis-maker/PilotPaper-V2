import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowUrl = new URL("../.github/workflows/validate-v2-installer.yml", import.meta.url);

async function workflow() {
  return readFile(workflowUrl, "utf8");
}

test("the exact Windows installer artifact is installed before PilotPaper V2 is considered validated", async () => {
  const source = await workflow();
  assert.match(source, /Wait for matching Windows build/);
  assert.match(source, /Download exact installer artifact/);
  assert.match(source, /Verify installer checksum/);
  assert.match(source, /Install exact V2 artifact silently/);
  assert.match(source, /PILOTPAPER-BUILD\.txt/);
  assert.match(source, /Installed build SHA mismatch/);
});

test("the Geometry Engine is smoke-tested from the installed payload and the installation is removable", async () => {
  const source = await workflow();
  assert.match(source, /app\/current\/runtime\/PilotPaperGeometryEngine\.exe/);
  assert.match(source, /http:\/\/127\.0\.0\.1:8765\/health/);
  assert.match(source, /site-twin-photo-projection/);
  assert.match(source, /\/v1\/site-twin\/project-modules/);
  assert.match(source, /Get-Process -Name "PilotPaperGeometryEngine"/);
  assert.match(source, /process tree did not stop cleanly/);
  assert.match(source, /Uninstall V2 silently and verify cleanup/);
  assert.match(source, /unins000\.exe/);
});
