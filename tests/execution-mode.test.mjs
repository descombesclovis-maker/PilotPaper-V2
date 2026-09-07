import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const modulePromise = vite.ssrLoadModule("/lib/dp-ai-engine/executionMode.ts");

test("production remains strict by default", async () => {
  const { resolveExecutionPolicy } = await modulePromise;
  const policy = resolveExecutionPolicy(undefined);
  assert.equal(policy.mode, "production");
  assert.equal(policy.blockOnQualityFailure, true);
  assert.equal(policy.blockOnStructuralPdfFailure, true);
  assert.equal(policy.allowUnverifiedExport, false);
  assert.equal(policy.exposeGeneratedArtifactsOnQualityFailure, false);
});

test("test mode keeps imperfect artifacts visible and exportable as unverified", async () => {
  const { resolveExecutionPolicy } = await modulePromise;
  const policy = resolveExecutionPolicy("TEST");
  assert.equal(policy.mode, "test");
  assert.equal(policy.blockOnQualityFailure, false);
  assert.equal(policy.blockOnStructuralPdfFailure, false);
  assert.equal(policy.allowUnverifiedExport, true);
  assert.equal(policy.exposeGeneratedArtifactsOnQualityFailure, true);
});

test("standard mode warns without weakening structural PDF validation", async () => {
  const { resolveExecutionPolicy } = await modulePromise;
  const policy = resolveExecutionPolicy("standard");
  assert.equal(policy.mode, "standard");
  assert.equal(policy.blockOnQualityFailure, false);
  assert.equal(policy.blockOnStructuralPdfFailure, true);
  assert.equal(policy.allowUnverifiedExport, false);
  assert.equal(policy.exposeGeneratedArtifactsOnQualityFailure, true);
});

test("invalid mode falls back safely", async () => {
  const { normalizeExecutionMode } = await modulePromise;
  assert.equal(normalizeExecutionMode("anything"), "production");
  assert.equal(normalizeExecutionMode("anything", "standard"), "standard");
});
