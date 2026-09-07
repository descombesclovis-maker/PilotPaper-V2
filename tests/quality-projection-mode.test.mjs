import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const judge = await readFile(
  path.join(root, "lib/dp-ai-engine/providers/openaiJudge.ts"),
  "utf8",
);
const labRoute = await readFile(
  path.join(root, "app/api/projects/[id]/admin-image-test/route.ts"),
  "utf8",
);

test("quality judge keeps historical production projection as its default", () => {
  assert.match(
    judge,
    /private projectionMode:\s*QualityProjectionMode\s*=\s*"legacy-bilinear"/,
  );
});

test("quality judge can inspect projective panel crops without replacing legacy behavior", () => {
  assert.match(judge, /allPanelPolygonsForRoleProjective/);
  assert.match(judge, /this\.projectionMode\s*===\s*"projective"/);
  assert.match(judge, /allPanelPolygonsForRole\(context, generated\.sourceRole\)/);
});

test("only the isolated admin laboratory opts its visual QA into projective geometry", () => {
  assert.match(
    labRoute,
    /new OpenAIQualityJudge\([\s\S]*?"projective",?\s*\)/,
  );
});
