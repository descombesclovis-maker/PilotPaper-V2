import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engine = await readFile(new URL("../lib/dp1-engine.ts", import.meta.url), "utf8");
const parcel = await readFile(new URL("../lib/dp-ai-engine/context/officialParcel.ts", import.meta.url), "utf8");
const raster = await readFile(new URL("../lib/dp-ai-engine/context/ignRaster.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/dp-piece/route.ts", import.meta.url), "utf8");

test("DP1 consumes the shared official parcel resolver instead of owning a separate cadastral truth", () => {
  assert.match(engine, /resolveOfficialParcelContext/);
  assert.match(engine, /parcelRings/);
  assert.match(engine, /toWebMercator/);
  assert.doesNotMatch(engine, /apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
});

test("shared parcel resolver performs IGN geocoding, reverse parcel lookup and APICARTO vector retrieval", () => {
  assert.match(parcel, /data\.geopf\.fr\/geocodage\/search/);
  assert.match(parcel, /data\.geopf\.fr\/geocodage\/reverse/);
  assert.match(parcel, /https:\/\/apicarto\.ign\.fr\/api\/cadastre\/parcelle/);
  assert.match(parcel, /parseParcelGeometry/);
  assert.match(parcel, /Polygon/);
  assert.match(parcel, /MultiPolygon/);
});

test("DP1 keeps orthophoto and cadastral context as separate reusable IGN raster requests", () => {
  assert.match(engine, /buildDp1IgnWmsCandidates/);
  assert.match(engine, /buildCadastralWmsCandidates/);
  assert.match(engine, /fetchIgnRaster/);
  assert.match(raster, /ORTHOIMAGERY\.ORTHOPHOTOS/);
  assert.match(raster, /HR\.ORTHOIMAGERY\.ORTHOPHOTOS/);
  assert.match(raster, /CADASTRALPARCELS\.PARCELLAIRE_EXPRESS/);
  assert.doesNotMatch(raster, /ORTHOIMAGERY\.ORTHOPHOTOS,CADASTRALPARCELS/);
});

test("shared IGN raster provider keeps endpoint fallbacks and validates image responses", () => {
  assert.match(raster, /https:\/\/data\.geopf\.fr\/wms-r\/wms/);
  assert.match(raster, /https:\/\/data\.geopf\.fr\/wms-r/);
  assert.match(raster, /contentType\.startsWith\("image\/"\)/);
});

test("DP1 projects official cadastral geometry onto the IGN situation map", () => {
  assert.match(engine, /projectParcelRings/);
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
