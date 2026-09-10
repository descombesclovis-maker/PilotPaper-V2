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

const modulePromise = vite.ssrLoadModule("/lib/dp-ai-engine/quality/sourceBindingInspector.ts");

function evidence() {
  return {
    geometry: {
      source_sha256: {
        near: "near-sha",
        roof: "roof-sha",
      },
    },
  };
}

const sources = [
  { kind: "near", sha256: "near-sha" },
  { kind: "roof", sha256: "roof-sha" },
];

const rendered = [
  { kind: "dp4_project", sourceKind: "near", sha256: "dp4-sha" },
  { kind: "dp6_project", sourceKind: "roof", sha256: "dp6-sha" },
];

test("accepts DP4 and DP6 only when their exact source bytes match geometric provenance", async () => {
  const { inspectRenderedSourceBindings } = await modulePromise;
  assert.deepEqual(inspectRenderedSourceBindings(evidence(), sources, rendered), []);
});

test("rejects a source replaced after geometry was calculated", async () => {
  const { inspectRenderedSourceBindings } = await modulePromise;
  const changed = sources.map((source) => source.kind === "near" ? { ...source, sha256: "new-near-sha" } : source);
  const issues = inspectRenderedSourceBindings(evidence(), changed, rendered);
  assert.ok(issues.some((issue) => issue.code === "SOURCE_SHA_MISMATCH" && issue.field === "dp4_project"));
});

test("rejects a rendered project view with no source provenance", async () => {
  const { inspectRenderedSourceBindings } = await modulePromise;
  const withoutRoofProvenance = evidence();
  delete withoutRoofProvenance.geometry.source_sha256.roof;
  const issues = inspectRenderedSourceBindings(withoutRoofProvenance, sources, rendered);
  assert.ok(issues.some((issue) => issue.code === "SOURCE_PROVENANCE_MISSING" && issue.field === "dp6_project"));
});

test("requires both V1 project visuals before export", async () => {
  const { inspectRenderedSourceBindings } = await modulePromise;
  const issues = inspectRenderedSourceBindings(evidence(), sources, rendered.filter((view) => view.kind !== "dp4_project"));
  assert.ok(issues.some((issue) => issue.code === "RENDERED_VIEW_MISSING" && issue.field === "dp4_project"));
});
