import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dp1 = await readFile(new URL("../lib/dp1-engine.ts", import.meta.url), "utf8");
const dp2 = await readFile(new URL("../lib/dp2-v1-engine.ts", import.meta.url), "utf8");
const parcel = await readFile(new URL("../lib/dp-ai-engine/context/officialParcel.ts", import.meta.url), "utf8");
const identity = await readFile(new URL("../lib/dp-ai-engine/identity/crossViewSurfaceIdentity.ts", import.meta.url), "utf8");
const metric = await readFile(new URL("../lib/dp-ai-engine/geometry/metricSurfaceFromIdentity.ts", import.meta.url), "utf8");
const roadmap = await readFile(new URL("../V1-K-PAR-K.md", import.meta.url), "utf8");

test("DP1 and DP2 share one official parcel truth", () => {
  assert.match(dp1, /resolveOfficialParcelContext/);
  assert.match(dp2, /resolveOfficialParcelContext/);
  assert.match(parcel, /adresse -> parcelle|address|parcel/i);
  assert.doesNotMatch(dp1, /apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
  assert.doesNotMatch(dp2, /apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
});

test("DP2 consumes promoted identity and metric engines before deterministic layout", () => {
  assert.match(dp2, /resolveCrossViewSurfaceIdentity/);
  assert.match(dp2, /metricSurfaceFromIdentity/);
  assert.match(dp2, /resolveProjectLayout/);
  assert.ok(dp2.indexOf("resolveCrossViewSurfaceIdentity") < dp2.lastIndexOf("resolveProjectLayout"));
  assert.match(identity, /Fail-closed two-pass identity reconciliation/);
  assert.match(metric, /hand-off from Roof\/Surface Understanding to the Layout Engine/);
});

test("roadmap explicitly forbids document-specific copies of engine-level rules", () => {
  assert.match(roadmap, /Règle de promotion obligatoire/);
  assert.match(roadmap, /engine-level/);
  assert.match(roadmap, /Une pièce ne peut pas être déclarée validée/);
});

test("roadmap freezes launcher and updater work while the engine is under validation", () => {
  assert.match(roadmap, /Gel des sujets périphériques/);
  assert.match(roadmap, /aucune amélioration esthétique du launcher/);
  assert.match(roadmap, /aucune nouvelle fonction updater/);
  assert.match(roadmap, /La priorité est le moteur/);
});

test("roadmap defines an explicit strategy-switch trigger instead of endless patching", () => {
  assert.match(roadmap, /Critère de changement de stratégie/);
  assert.match(roadmap, /plusieurs cas V1 simples/);
  assert.match(roadmap, /on arrête les patchs du pipeline actuel/);
});
