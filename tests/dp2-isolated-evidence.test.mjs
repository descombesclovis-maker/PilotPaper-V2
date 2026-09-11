import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engine = await readFile(new URL("../lib/dp2-engine.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/dp-piece/route.ts", import.meta.url), "utf8");
const contract = await readFile(new URL("../lib/dp-piece-contract.ts", import.meta.url), "utf8");

test("DP2 isolated workshop is not governed by the complete-dossier three-photo rule", () => {
  assert.match(engine, /new OpenAIVisionAnalyzer\(config\.openaiApiKey, config\.analysisModel, 1\)/);
  assert.match(engine, /une seule vue oblique de toiture exploitable est requise/);
  assert.doesNotMatch(engine, /At least 3 independent user photograph/);
});

test("DP2 routes through its dedicated engine and actually requires OpenAI configuration", () => {
  assert.match(route, /generateDp2Piece/);
  assert.match(route, /input\.dp === 2/);
  assert.match(engine, /if \(!config\.openaiApiKey\) throw new Error\("OPENAI_API_KEY absente du poste local\."\)/);
  assert.match(engine, /OpenAI \$\{config\.analysisModel\} — compréhension du pan/);
});

test("DP2 separates orthophoto and cadastral WMS evidence", () => {
  assert.match(engine, /ORTHOIMAGERY\.ORTHOPHOTOS/);
  assert.match(engine, /CADASTRALPARCELS\.PARCELLAIRE_EXPRESS/);
  assert.doesNotMatch(engine, /ORTHOIMAGERY\.ORTHOPHOTOS,CADASTRALPARCELS/);
});

test("DP2 UI contract asks for roof evidence but not near or far photographs", () => {
  const dp2Start = contract.indexOf("dp: 2,");
  const dp3Start = contract.indexOf("dp: 3,");
  assert.ok(dp2Start >= 0 && dp3Start > dp2Start);
  const dp2 = contract.slice(dp2Start, dp3Start);
  assert.match(dp2, /"roofPhoto"/);
  assert.doesNotMatch(dp2, /"nearPhoto"|"farPhoto"/);
});
