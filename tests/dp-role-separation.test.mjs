import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const contract = await readFile(new URL("../lib/dp-piece-contract.ts", import.meta.url), "utf8");
const prompt = await readFile(new URL("../lib/dp-ai-engine/prompts/dpImage.ts", import.meta.url), "utf8");
const judgePrompt = await readFile(new URL("../lib/dp-ai-engine/prompts/judge.ts", import.meta.url), "utf8");
const judge = await readFile(new URL("../lib/dp-ai-engine/providers/openaiJudge.ts", import.meta.url), "utf8");
const direct = await readFile(new URL("../lib/dp-direct-chatgpt-image-engine.ts", import.meta.url), "utf8");

test("DP1 and DP2 alone expose aerial roof selection", () => {
  for (const dp of [1, 2]) {
    const start = contract.indexOf(`dp: ${dp},`);
    const end = contract.indexOf(`dp: ${dp + 1},`);
    const block = contract.slice(start, end);
    assert.match(block, /"roofFace"/);
  }
  for (const dp of [3, 4, 5, 6, 7, 8]) {
    const start = contract.indexOf(`dp: ${dp},`);
    const end = dp === 8 ? contract.length : contract.indexOf(`dp: ${dp + 1},`);
    const block = contract.slice(start, end);
    assert.doesNotMatch(block, /"roofFace"/);
  }
});

test("each generated DP has a dedicated administrative mission", () => {
  assert.match(prompt, /DP1 PLAN DE SITUATION/);
  assert.match(prompt, /DP2 PLAN DE MASSE/);
  assert.match(prompt, /DP3 PLAN EN COUPE/);
  assert.match(prompt, /DP4 PLANS DES FACADES ET DES TOITURES — ETAT INITIAL ET ETAT PROJETE/);
  assert.match(prompt, /DP5 REPRESENTATION DE L'ASPECT EXTERIEUR/);
  assert.match(prompt, /DP6 DOCUMENT GRAPHIQUE D'INSERTION/);
});

test("DP1 and DP2 receive IGN aerial evidence while DP3-DP6 receive user photos only", () => {
  assert.match(direct, /if \(input\.dp <= 2\)/);
  assert.match(direct, /fetchIgnImage\("satellite"/);
  assert.match(direct, /fetchIgnImage\("satellite_mass"/);
  assert.match(direct, /else \{\s*photos = \[\.\.\.userPhotos\];\s*\}/);
});

test("DP1-DP2 require visible white-outlined aerial panels", () => {
  assert.match(prompt, /BRIGHT WHITE OUTLINE/);
  assert.match(prompt, /selected roof zone/);
  assert.match(prompt, /correct selected building\/roof/);
});

test("DP3 forbids invented building dimensions and only dimensions verified PV facts", () => {
  assert.match(prompt, /NEVER invent a building height, terrain elevation, roof length, roof angle, setback/);
  assert.match(prompt, /exact computed field size/);
  assert.match(prompt, /existing and projected ground as unchanged\/coincident/);
});

test("DP4 requires initial and projected states while DP5 and DP6 keep different visual purposes", () => {
  assert.match(prompt, /ETAT INITIAL and ETAT PROJETE/);
  assert.match(prompt, /DP5 REPRESENTATION DE L'ASPECT EXTERIEUR/);
  assert.match(prompt, /DP6 DOCUMENT GRAPHIQUE D'INSERTION/);
  assert.match(judgePrompt, /MISSING_INITIAL_PROJECTED_STATES/);
});

test("independent Inspector fails closed on document role, required content and evidence", () => {
  assert.match(judge, /documentTypeCorrect/);
  assert.match(judge, /requiredContentPresent/);
  assert.match(judge, /sourceEvidenceSufficient/);
  assert.match(judge, /administrativeMismatch/);
  assert.match(judgePrompt, /A single false value among these three means the candidate MUST be rejected/);
});

test("DP7 and DP8 remain original photographs and are not ChatGPT Image missions", () => {
  const dp7Start = contract.indexOf("dp: 7,");
  const dp8Start = contract.indexOf("dp: 8,");
  const dp7 = contract.slice(dp7Start, dp8Start);
  const dp8 = contract.slice(dp8Start);
  assert.match(dp7, /allowsGenerativeRefinement: false/);
  assert.match(dp7, /preservesOriginalPhoto: true/);
  assert.match(dp8, /allowsGenerativeRefinement: false/);
  assert.match(dp8, /preservesOriginalPhoto: true/);
});
