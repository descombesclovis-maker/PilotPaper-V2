import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const workspacePath = fileURLToPath(new URL("../app/workspace-client.tsx", import.meta.url));
const source = readFileSync(workspacePath, "utf8");

test("workspace resolves exact PV references through the verified catalog API", () => {
  assert.match(source, /async function resolveModuleReference/);
  assert.match(source, /\/api\/pv-modules\/resolve\?reference=/);
  assert.match(source, /setResolvedModule\(moduleSpec\)/);
  assert.match(source, /setModuleReference\(moduleSpec\.canonicalReference\)/);
});

test("module dimensions and total power are no longer editable user inputs", () => {
  assert.doesNotMatch(source, /id="module-width"/);
  assert.doesNotMatch(source, /id="module-height"/);
  assert.doesNotMatch(source, /id="power"/);
  assert.doesNotMatch(source, /htmlFor="module-width"/);
  assert.doesNotMatch(source, /htmlFor="module-height"/);
  assert.match(source, /Puissance totale calculée/);
  assert.match(source, /Dimensions réelles/);
});

test("changing the exact reference invalidates stale technical data", () => {
  const referenceHandlerStart = source.indexOf('id="module-reference"');
  assert.ok(referenceHandlerStart >= 0);
  const referenceHandler = source.slice(referenceHandlerStart, referenceHandlerStart + 1400);
  assert.match(referenceHandler, /setResolvedModule\(null\)/);
  assert.match(referenceHandler, /setModuleWidthMm\(""\)/);
  assert.match(referenceHandler, /setModuleHeightMm\(""\)/);
  assert.match(referenceHandler, /setPowerKwp\(""\)/);
  assert.match(referenceHandler, /resolveModuleReference\(moduleReference, Number\(moduleCount\)\)/);
});

test("changing quantity recalculates power from resolved module power", () => {
  const quantityHandlerStart = source.indexOf('id="modules"');
  assert.ok(quantityHandlerStart >= 0);
  const quantityHandler = source.slice(quantityHandlerStart, quantityHandlerStart + 1000);
  assert.match(quantityHandler, /resolvedModule\.powerWp \* Number\(value\)/);
  assert.doesNotMatch(quantityHandler, /setModuleWidthMm/);
  assert.doesNotMatch(quantityHandler, /setModuleHeightMm/);
});

test("layout analysis remains locked until the module is manufacturer-resolved", () => {
  assert.match(source, /disabled={!projectId \|\| isCheckingLayout \|\| !moduleCount \|\| !resolvedModule}/);
  assert.match(source, /!resolvedModule \|\|/);
});
