import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../lib/dp2-roof-designer-engine.ts", import.meta.url), "utf8");

test("DP2 keeps a close metric frame separate from the wider human-readable presentation frame", () => {
  assert.match(source, /const metricFrame = metricFrameForParcel/);
  assert.match(source, /const presentationFrame = metricFrameForParcel/);
  assert.match(source, /minWidthMeters: 45/);
  assert.match(source, /minWidthMeters: 130/);
  assert.match(source, /presentationOrthophoto/);
  assert.match(source, /contexte cadastral élargi/);
});

test("DP2 uses only a small geocoded address-access point instead of a target-parcel highlight", () => {
  assert.match(source, /addressPointNormalized: normalizedPointInFrame\(site\.longitude, site\.latitude, presentationFrame\)/);
  assert.match(source, /<circle cx=/);
  assert.match(source, /Point rouge : accès\/adresse du projet/);
});

test("panel geometry is reprojected from the metric Roof Designer frame into the wider display frame", () => {
  assert.match(source, /function reframePoint/);
  assert.match(source, /reframePoint\(point, context\.metricFrame, context\.presentationFrame\)/);
  const renderStart = source.indexOf("function buildDp2Svg");
  const render = source.slice(renderStart);
  assert.ok(render.indexOf("allPanelPolygonsForRoleProjective") < render.indexOf("reframePoint"));
  assert.ok(render.indexOf("reframePoint") < render.indexOf("panelSvg(displayPolygons"));
});
