import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("visual DP jobs are staggered and retried instead of immediately failing on 429", async () => {
  const route = await source("app/api/dp-piece/route.ts");
  const resilience = await source("lib/pilotpaper-openai-resilience.ts");

  assert.match(route, /pilotPaperRunVisualJob/);
  assert.match(route, /input\.dp >= 2 && input\.dp <= 6/);
  assert.match(route, /pilotPaperRunVisualJob\(`DP\$\{input\.dp\}`/);

  assert.match(resilience, /IMAGE_MIN_START_INTERVAL_MS = 8_000/);
  assert.match(resilience, /DEFAULT_MAX_ATTEMPTS = 5/);
  assert.match(resilience, /message\.includes\("\(429\)"\)/);
  assert.match(resilience, /temporairement saturé/);
  assert.match(resilience, /10_000 \* Math\.pow\(2, attempt - 1\)/);
});

test("quota failures are distinguished from temporary rate limits", async () => {
  const resilience = await source("lib/pilotpaper-openai-resilience.ts");
  assert.match(resilience, /insufficient_quota/);
  assert.match(resilience, /billing/);
  assert.match(resilience, /Quota de génération API insuffisant/);
  assert.match(resilience, /Vérifiez les crédits ou la facturation/);
});
