import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const judgePath = fileURLToPath(new URL("../lib/dp-ai-engine/providers/openaiJudge.ts", import.meta.url));
const promptPath = fileURLToPath(new URL("../lib/dp-ai-engine/prompts/judge.ts", import.meta.url));
const judge = readFileSync(judgePath, "utf8");
const prompt = readFileSync(promptPath, "utf8");

test("DP4 and DP6 share the same hard photorealism gate", () => {
  assert.match(judge, /const requiresPhotorealism = dp === 4 \|\| dp === 6/);
  assert.match(judge, /requiresPhotorealism && generated\.sourceRole/);
  assert.match(judge, /requiresPhotorealism && \(/);
  assert.doesNotMatch(judge, /dp===6 && generated\.sourceRole/);
  assert.doesNotMatch(judge, /\(dp===6 && \(/);
});

test("both project visuals receive local zoom evidence for seam and texture inspection", () => {
  assert.match(judge, /cropPngAroundPolygons\(base\.base64,polys,\.05\)/);
  assert.match(judge, /cropPngAroundPolygons\(generated\.base64,polys,\.05\)/);
  assert.match(judge, /mismatch of sharpness\/noise\/compression/);
});

test("quality prompt states photorealism is mandatory for DP4 and DP6", () => {
  assert.match(prompt, /For DP4 and DP6, photorealism is a HARD acceptance criterion/);
  assert.match(prompt, /edge integration/);
  assert.match(prompt, /photographic texture match/);
  assert.match(prompt, /distance realism/);
});
