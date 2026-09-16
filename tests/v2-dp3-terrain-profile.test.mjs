import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("DP3 samples the official IGN terrain along A-A and never invents terrain slope", async () => {
  const terrain = await source("lib/site-twin-v2/ignTerrain.ts");
  const renderer = await source("lib/site-twin-v2/renderers/dp3.ts");
  const bridge = await source("lib/site-twin-v2/dpPieceBridge.ts");

  assert.match(terrain, /ign_lidar_hd_mnt_multi_wld/);
  assert.match(terrain, /sampleIgnTerrainElevations/);
  assert.match(renderer, /const sampleCount = 25/);
  assert.match(renderer, /valid\.length >= Math\.ceil\(sampleCount \* 0\.75\)/);
  assert.match(renderer, /Math\.abs\(median - args\.referenceGroundM\) <= 3/);
  assert.match(renderer, /mode: "reference-level"/);
  assert.match(renderer, /profil détaillé indisponible, aucune pente inventée/);
  assert.match(renderer, /terrainProfileMode: terrain\.mode/);
  assert.match(renderer, /<path d="\$\{terrainPath\}" class="terrain"\/>/);
  assert.match(bridge, /await renderDp3FromSiteTwin\(context\)/);
});
