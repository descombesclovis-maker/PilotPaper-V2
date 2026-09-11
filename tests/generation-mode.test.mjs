import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});
after(async () => { await vite.close(); });

const modePromise = vite.ssrLoadModule("/lib/generation-mode.ts");

test("production strict mode is the default when DP_TEST_EXPORT is absent", async () => {
  const { isExplicitTestExportEnabled } = await modePromise;
  assert.equal(isExplicitTestExportEnabled(undefined), false);
  assert.equal(isExplicitTestExportEnabled(null), false);
  assert.equal(isExplicitTestExportEnabled(""), false);
  assert.equal(isExplicitTestExportEnabled("0"), false);
  assert.equal(isExplicitTestExportEnabled("false"), false);
});

test("test export can only be enabled by an explicit affirmative value", async () => {
  const { isExplicitTestExportEnabled } = await modePromise;
  for (const value of ["1", "true", "TRUE", " yes ", "on"]) {
    assert.equal(isExplicitTestExportEnabled(value), true, `expected ${JSON.stringify(value)} to enable test export`);
  }
});
