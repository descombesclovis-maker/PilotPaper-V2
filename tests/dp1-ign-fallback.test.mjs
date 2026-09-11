import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engine = await readFile(new URL("../lib/dp1-engine.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/dp-piece/route.ts", import.meta.url), "utf8");

test("DP1 keeps orthophoto and cadastral context as separate WMS requests", () => {
  assert.doesNotMatch(engine, /LAYERS:\s*"[^"]*,[^"]*"/);
  assert.match(engine, /ORTHOIMAGERY\.ORTHOPHOTOS/);
  assert.match(engine, /HR\.ORTHOIMAGERY\.ORTHOPHOTOS/);
  assert.match(engine, /CADASTRALPARCELS\.PARCELLAIRE_EXPRESS/);
  assert.match(engine, /buildCadastralWmsCandidates/);
});

test("DP1 has independent IGN WMS endpoint and layer fallbacks", () => {
  assert.match(engine, /https:\/\/data\.geopf\.fr\/wms-r\/wms/);
  assert.match(engine, /https:\/\/data\.geopf\.fr\/wms-r/);
  assert.match(engine, /buildDp1IgnWmsCandidates/);
  assert.match(engine, /contentType\.startsWith\("image\/"\)/);
});

test("DP1 fetches the official target parcel vector from APICARTO Cadastre", () => {
  assert.match(engine, /https:\/\/apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
  assert.match(engine, /code_insee/);
  assert.match(engine, /section/);
  assert.match(engine, /numero/);
  assert.match(engine, /parseParcelGeometry/);
  assert.match(engine, /Polygon/);
  assert.match(engine, /MultiPolygon/);
});

test("DP1 projects official cadastral geometry onto the IGN situation map", () => {
  assert.match(engine, /projectParcelRings/);
  assert.match(engine, /toWebMercator/);
  assert.match(engine, /parcelPath/);
  assert.match(engine, /Contour vectoriel officiel APICARTO Cadastre/);
  assert.match(engine, /fill="#ff7a32"/);
  assert.match(engine, /stroke="#f15a24"/);
});

test("DP1 inspector fails closed unless official parcel geometry can be represented", () => {
  assert.match(engine, /DP1 bloquée : le contour cadastral officiel n'a pas pu être représenté/);
  assert.match(engine, /Géométrie vectorielle officielle récupérée par APICARTO Cadastre/);
  assert.match(engine, /Contour cadastral projeté mathématiquement/);
});

test("isolated API routes DP1 through the hardened engine", () => {
  assert.match(route, /input\.dp === 1/);
  assert.match(route, /generateDp1Piece/);
  assert.match(route, /generateDpPiece/);
});
