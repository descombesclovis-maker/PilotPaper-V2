import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engine = await readFile(new URL("../lib/dp1-engine.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/dp-piece/route.ts", import.meta.url), "utf8");

test("DP1 never composes orthophoto and cadastral layers in one WMS request", () => {
  assert.doesNotMatch(engine, /LAYERS:\s*"[^"]*,[^"]*"/);
  assert.doesNotMatch(engine, /CADASTRALPARCELS\.PARCELLAIRE_EXPRESS/);
  assert.match(engine, /ORTHOIMAGERY\.ORTHOPHOTOS/);
  assert.match(engine, /HR\.ORTHOIMAGERY\.ORTHOPHOTOS/);
});

test("DP1 has independent IGN WMS endpoint and layer fallbacks", () => {
  assert.match(engine, /https:\/\/data\.geopf\.fr\/wms-r\/wms/);
  assert.match(engine, /https:\/\/data\.geopf\.fr\/wms-r/);
  assert.match(engine, /buildDp1IgnWmsCandidates/);
  assert.match(engine, /contentType\.startsWith\("image\/"\)/);
});

test("DP1 uses cadastral reverse geocoding independently from the raster", () => {
  assert.match(engine, /geocodage\/reverse/);
  assert.match(engine, /index", "parcel"/);
  assert.match(engine, /cadastre vérifié séparément/);
});

test("isolated API routes DP1 through the hardened engine", () => {
  assert.match(route, /input\.dp === 1/);
  assert.match(route, /generateDp1Piece/);
  assert.match(route, /generateDpPiece/);
});
