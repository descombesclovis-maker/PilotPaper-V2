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

const catalogPromise = vite.ssrLoadModule("/lib/pv-module-catalog.ts");

test("resolves an exact manufacturer reference without fuzzy guessing", async () => {
  const { resolveVerifiedPvModule } = await catalogPromise;
  const module = resolveVerifiedPvModule("TSM-450NEG9R.28");
  assert.equal(module?.manufacturer, "Trina Solar");
  assert.equal(module?.widthMm, 1134);
  assert.equal(module?.heightMm, 1762);
  assert.equal(module?.powerWp, 450);
});

test("normalizes punctuation and spacing but not partial references", async () => {
  const { resolveVerifiedPvModule } = await catalogPromise;
  assert.equal(resolveVerifiedPvModule("JKM440N 54HL4R B")?.canonicalReference, "JKM440N-54HL4R-B");
  assert.equal(resolveVerifiedPvModule("JKM440N") ?? null, null);
});

test("keeps two 500 W modules with different real dimensions distinct", async () => {
  const { resolveVerifiedPvModule } = await catalogPromise;
  const topcon = resolveVerifiedPvModule("DS500-120M10TB-03");
  const black = resolveVerifiedPvModule("DS500-132M10-01");
  assert.equal(topcon?.powerWp, 500);
  assert.equal(black?.powerWp, 500);
  assert.equal(topcon?.widthMm, black?.widthMm);
  assert.notEqual(topcon?.heightMm, black?.heightMm);
  assert.equal(topcon?.heightMm, 1950);
  assert.equal(black?.heightMm, 2094);
});

test("every production catalog entry traces to an HTTPS manufacturer source", async () => {
  const { listVerifiedPvModules } = await catalogPromise;
  const modules = listVerifiedPvModules();
  assert.ok(modules.length >= 4);
  for (const module of modules) {
    const source = new URL(module.sourceUrl);
    assert.equal(source.protocol, "https:");
    assert.ok(module.verifiedAt);
    assert.ok(module.canonicalReference);
    assert.ok(module.widthMm > 0 && module.heightMm > 0 && module.powerWp > 0);
  }
});

test("unknown references fail closed with a precise catalog error", async () => {
  const { requireVerifiedPvModule } = await catalogPromise;
  assert.throws(
    () => requireVerifiedPvModule("UNKNOWN-999-W"),
    /MODULE_REFERENCE_UNKNOWN/,
  );
});

test("total power is derived from the resolved module and quantity", async () => {
  const { requireVerifiedPvModule, totalPowerKwp } = await catalogPromise;
  const module = requireVerifiedPvModule("TSM-450NEG9R.28");
  assert.equal(totalPowerKwp(module, 12), 5.4);
});
