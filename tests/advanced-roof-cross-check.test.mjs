import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const policy = await vite.ssrLoadModule("/lib/site-twin-v2/policy.ts");

function face(id, label, azimuthDeg) {
  return {
    id,
    displayLabel: label,
    buildingId: "house",
    polygonLocalM: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }],
    plane: { a: 0.2, b: 0, c: 5 },
    slopeDeg: 25,
    azimuthDeg,
    areaM2: 24,
    centerLocalM: { x: 3, y: 2 },
    edgeIds: [],
    obstacles: [],
    evidence: [],
    confidence: 0.95,
  };
}

function twinWithCrossCheck(crossCheck) {
  return {
    version: "pilotpaper-site-twin-v2",
    id: "site-cross-check",
    address: "110 Rue Basse, 71260 Azé",
    normalizedAddress: "110 Rue Basse 71260 Azé",
    addressPoint: [4.7, 46.4],
    parcel: { reference: "OC 0212", polygonLonLat: [[4.7, 46.4], [4.71, 46.4], [4.71, 46.41]] },
    buildings: [{ id: "house", polygonLonLat: [[4.7, 46.4], [4.701, 46.4], [4.701, 46.401]], evidence: [] }],
    targetBuildingIds: ["house"],
    roof: {
      origin: [4.7, 46.4],
      edges: [],
      faces: [face("face-a", "A", 180), face("face-b", "B", 0), face("face-c", "C", 90)],
    },
    photos: [],
    cameraRegistrations: [],
    sources: { lidar: "not-checked", advancedRoofCrossCheck: crossCheck },
    evidence: [{ source: "advanced-roof-model", confidence: 0.74, notes: ["Diagnostic humain sans mots-clés de décision."] }],
    confidence: 0.92,
    revision: 1,
  };
}

function comparison(localFaceId, remoteFacetId, status) {
  return {
    localFaceId,
    localDisplayLabel: localFaceId.toUpperCase(),
    remoteFacetId,
    azimuthDeltaDeg: status === "agreement" ? 2 : 28,
    slopeDeltaDeg: status === "agreement" ? 1 : 11,
    areaRelativeError: status === "agreement" ? 0.05 : 0.42,
    metricCount: 3,
    status,
  };
}

test("structured independent roof conflict blocks automation without relying on diagnostic wording", () => {
  const comparisons = [
    comparison("face-a", "remote-a", "conflict"),
    comparison("face-b", "remote-b", "conflict"),
    comparison("face-c", "remote-c", "agreement"),
  ];
  const twin = twinWithCrossCheck({
    source: "advanced-roof-model",
    localFaceCount: 3,
    remoteFacetCount: 3,
    matchedFacetCount: 3,
    comparableFacetCount: 3,
    agreementCount: 1,
    conflictCount: 2,
    closeRatio: 1 / 3,
    blockingConflict: true,
    status: "conflict",
    comparisons,
  });

  assert.throws(
    () => policy.assertTwinReadyForAutomaticDocuments(twin),
    (error) => error?.code === "ROOF_GEOMETRY_LOW_CONFIDENCE"
      && error?.details?.conflicts === 2
      && Array.isArray(error?.details?.comparisons)
      && error.details.comparisons.length === 3,
  );
});

test("structured minority disagreement is retained diagnostically without overriding local metric geometry", () => {
  const comparisons = [
    comparison("face-a", "remote-a", "agreement"),
    comparison("face-b", "remote-b", "agreement"),
    comparison("face-c", "remote-c", "conflict"),
  ];
  const twin = twinWithCrossCheck({
    source: "advanced-roof-model",
    localFaceCount: 3,
    remoteFacetCount: 3,
    matchedFacetCount: 3,
    comparableFacetCount: 3,
    agreementCount: 2,
    conflictCount: 1,
    closeRatio: 2 / 3,
    blockingConflict: false,
    status: "conflict",
    comparisons,
  });

  assert.equal(policy.assertTwinReadyForAutomaticDocuments(twin), twin);
  assert.equal(twin.sources.advancedRoofCrossCheck.comparisons[2].status, "conflict");
});
