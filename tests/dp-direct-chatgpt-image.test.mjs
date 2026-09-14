import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/dp-piece/route.ts", import.meta.url), "utf8");
const direct = await readFile(new URL("../lib/dp-direct-chatgpt-image-engine.ts", import.meta.url), "utf8");
const semantic = await readFile(new URL("../lib/dp-ai-engine/providers/openaiSemanticImage.ts", import.meta.url), "utf8");
const generator = await readFile(new URL("../lib/dp-ai-engine/generators/aiVisualGenerator.ts", import.meta.url), "utf8");
const prompt = await readFile(new URL("../lib/dp-ai-engine/prompts/dpImage.ts", import.meta.url), "utf8");
const contracts = await readFile(new URL("../lib/dp-piece-contract.ts", import.meta.url), "utf8");

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

test("only DP1 and DP2 expose satellite roof selection", () => {
  assert.match(contracts, /dp: 1,[\s\S]*?fields: \["address", "roofFace"\]/);
  assert.match(contracts, /dp: 2,[\s\S]*?"roofFace"/);
  for (const dp of [3, 4, 5, 6]) {
    const section = contracts.match(new RegExp(`dp: ${dp},[\\s\\S]*?(?=\\n  \\{\\n    dp: ${dp + 1},)`))?.[0] ?? "";
    assert.ok(section.length > 0, `missing DP${dp} contract section`);
    assert.doesNotMatch(section, /"roofFace"/);
  }
});

test("photographic DP3-DP6 use one real image and never receive satellite evidence", () => {
  assert.match(direct, /if \(input\.dp === 2\) \{[\s\S]*?fetchIgnImage\("satellite_mass"/);
  assert.match(direct, /else \{\s*photos = \[\.\.\.userPhotos\];\s*\}/);
  assert.match(semantic, /if \(dp >= 3 && dp <= 6\) return \[\];/);
  assert.match(semantic, /if \(dp === 6\) return \["far", "near", "roof"/);
});

test("photo DP3-DP6 are one-shot gpt-image-2 edits followed by independent QA", () => {
  assert.match(direct, /const PHOTO_IMAGE_MODEL = "gpt-image-2"/);
  assert.match(direct, /input\.dp >= 3 && input\.dp <= 6 \? PHOTO_IMAGE_MODEL/);
  assert.match(direct, /const maxRetries = input\.dp === 2 \?[^;]+: 0;/);
  assert.match(generator, /this\.judge\.judge/);
  assert.match(semantic, /quality", "high"/);
});

test("direct roof prompt preserves exact matrix and treats visible obstacles as hard no-panel zones", () => {
  assert.match(prompt, /Add EXACTLY \$\{c\.exactPanelCount\} photovoltaic panels/);
  assert.match(prompt, /Produce EXACTLY \$\{requestedRows\} row\(s\) x \$\{requestedColumns\} column\(s\)/);
  assert.match(prompt, /Velux \/ roof window, chimney, vent, antenna/);
  assert.match(prompt, /HARD NO-PANEL ZONE/);
  assert.match(prompt, /THE SAME PHOTOGRAPH taken after installation/i);
});
