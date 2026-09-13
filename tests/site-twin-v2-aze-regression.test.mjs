import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const fixture = JSON.parse(await readFile(new URL("./fixtures/site-twin/aze-001.json", import.meta.url), "utf8"));

test("AZE-001 permanently encodes the L-roof failure as ground truth", () => {
  assert.equal(fixture.id, "AZE-001");
  assert.ok(fixture.expectations.minimumPhysicalRoofFaceCount >= 4);
  assert.equal(fixture.expectations.incompatiblePhysicalFacesMustRemainVisible, true);
  assert.equal(fixture.expectations.googleBuildingInsightsMustNotDefineCanonicalFaceCount, true);
  assert.equal(fixture.expectations.pvConfigurationMustNotChangePhysicalFaceCount, true);
  assert.equal(fixture.expectations.allDpPiecesMustShareOneSiteTwinRevision, true);
  assert.equal(fixture.expectations.dp3MustUseCanonicalMetricGeometry, true);
  assert.equal(fixture.expectations.dp6MustRequireCameraRegistration, true);
  assert.equal(fixture.expectations.preferredGutterClearanceIsHardConstraint, false);
});
