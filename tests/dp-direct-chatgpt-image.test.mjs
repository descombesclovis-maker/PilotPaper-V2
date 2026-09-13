import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/dp-piece/route.ts", import.meta.url), "utf8");
const direct = await readFile(new URL("../lib/dp-direct-chatgpt-image-engine.ts", import.meta.url), "utf8");
const semantic = await readFile(new URL("../lib/dp-ai-engine/providers/openaiSemanticImage.ts", import.meta.url), "utf8");
const generator = await readFile(new URL("../lib/dp-ai-engine/generators/aiVisualGenerator.ts", import.meta.url), "utf8");
const prompt = await readFile(new URL("../lib/dp-ai-engine/prompts/dpImage.ts", import.meta.url), "utf8");

test("isolated DP2 through DP6 use the direct ChatGPT Image route", () => {
  for (const dp of [2, 3, 4, 5, 6]) {
    assert.match(route, new RegExp(`case ${dp}:[\\s\\S]*?generateDirectChatGptDp\\(\\{ \\.\\.\\.input, dp: ${dp} \\}\\)`));
  }
  assert.match(route, /X-PilotPaper-Image-Path/);
  assert.match(route, /chatgpt-direct/);
});

test("direct editor sends the complete image without a module mask", () => {
  assert.match(semantic, /readonly mode = "semantic-direct"/);
  assert.match(semantic, /https:\/\/api\.openai\.com\/v1\/images\/edits/);
  assert.doesNotMatch(semantic, /data\.(?:set|append)\("mask"/);
  assert.doesNotMatch(semantic, /buildPanelIslandsMask/);
});

test("DP2 sees IGN mass context and DP6 edits the far environment photograph", () => {
  assert.match(direct, /fetchIgnImage\("satellite_mass"/);
  assert.match(semantic, /if \(dp === 2\) return \["satellite_mass", "satellite"/);
  assert.match(semantic, /if \(dp === 6\) return \["far", "near", "roof"/);
});

test("direct ChatGPT edits bypass only the legacy outside-mask pixel audit", () => {
  assert.match(generator, /semanticDirect/);
  assert.match(generator, /semanticDirect \? \[\.\.\.photos\] : prioritizePhotos/);
  assert.match(generator, /if \(!semanticDirect\) \{/);
  assert.match(generator, /this\.judge\.judge/);
});

test("direct roof prompt preserves exact quantity and every visible obstacle", () => {
  assert.match(prompt, /Add EXACTLY \$\{c\.exactPanelCount\} photovoltaic panels/);
  assert.match(prompt, /roof window \/ Velux, chimney, vent, antenna/);
  assert.match(prompt, /DO NOT place a panel outside the physical roof surface/);
  assert.match(prompt, /same photograph taken after installation/i);
});
