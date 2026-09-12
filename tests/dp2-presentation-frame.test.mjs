import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../lib/dp2-roof-designer-engine.ts", import.meta.url), "utf8");

test("DP2 prefers a tighter building-centered Roof Designer frame with a wider contextual presentation frame", () => {
  assert.match(source, /resolveTargetBuilding/);
  assert.match(source, /function frameAroundBuilding/);
  assert.match(source, /minWidthMeters: 32/);
  assert.match(source, /maxWidthMeters: 72/);
  assert.match(source, /minWidthMeters: 90/);
  assert.match(source, /maxWidthMeters: 165/);
  assert.match(source, /falling back to parcel-centered framing/);
  assert.match(source, /presentationOrthophoto/);
  assert.match(source, /vue de présentation centrée sur le bâtiment/);
});

test("Roof Designer and final DP2 visually distinguish the target parcel from surrounding cadastral boundaries", () => {
  assert.match(source, /TARGET_PARCEL_STROKE/);
  assert.match(source, /designerCadastreOverlay/);
  assert.match(source, /presentationParcelPolygonNormalized/);
  assert.match(source, /buildRoofDesignerReviewSvg/);
  assert.match(source, /Parcelle cible .* contourée en turquoise/);
  assert.match(source, /Turquoise : parcelle cible/);
  assert.match(source, /<polygon points=/);
});

test("DP2 keeps the small geocoded address-access point in addition to the target-parcel outline", () => {
  assert.match(source, /addressPointNormalized: normalizedPointInFrame\(site\.longitude, site\.latitude, presentationFrame\)/);
  assert.match(source, /<circle cx=/);
  assert.match(source, /point rouge : accès\/adresse/);
});

test("panel geometry is reprojected from the metric Roof Designer frame into the wider display frame", () => {
  assert.match(source, /function reframePoint/);
  assert.match(source, /reframePoint\(point, context\.metricFrame, context\.presentationFrame\)/);
  const renderStart = source.indexOf("function buildDp2Svg");
  const render = source.slice(renderStart);
  assert.ok(render.indexOf("allPanelPolygonsForRoleProjective") < render.indexOf("reframePoint"));
  assert.ok(render.indexOf("reframePoint") < render.indexOf("panelSvg(displayPolygons"));
});
