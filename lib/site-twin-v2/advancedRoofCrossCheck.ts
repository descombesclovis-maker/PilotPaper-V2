import type { AdvancedRoofFacet } from "@/lib/geometry/advanced-roof-truth";
import type { SiteTwinRoofCrossCheck, SiteTwinRoofFace } from "./types";

function angularDistance(a: number, b: number) {
  const delta = Math.abs((a - b) % 360);
  return Math.min(delta, 360 - delta);
}

function facetPair(local: SiteTwinRoofFace, remote: AdvancedRoofFacet) {
  const azimuthDelta = remote.azimuthDeg == null ? null : angularDistance(local.azimuthDeg, remote.azimuthDeg);
  const slopeDelta = remote.slopeDeg == null ? null : Math.abs(local.slopeDeg - remote.slopeDeg);
  const areaRelativeError = remote.areaM2 == null || remote.areaM2 <= 0
    ? null
    : Math.abs(local.areaM2 - remote.areaM2) / Math.max(local.areaM2, remote.areaM2);
  const components = [
    azimuthDelta == null ? null : azimuthDelta / 25,
    slopeDelta == null ? null : slopeDelta / 10,
    areaRelativeError == null ? null : areaRelativeError / 0.4,
  ].filter((value): value is number => value !== null);
  const score = components.length
    ? components.reduce((sum, value) => sum + value, 0) / components.length
    : Number.POSITIVE_INFINITY;
  const close = components.length > 0
    && (azimuthDelta == null || azimuthDelta <= 15)
    && (slopeDelta == null || slopeDelta <= 7)
    && (areaRelativeError == null || areaRelativeError <= 0.30);
  return { azimuthDelta, slopeDelta, areaRelativeError, score, close, metricCount: components.length };
}

/**
 * Independent roof evidence is a cross-check only. This matcher never mutates
 * local coordinates or lets the remote source select the PV face.
 */
export function compareAdvancedFacets(
  localFaces: SiteTwinRoofFace[],
  remoteFacets: AdvancedRoofFacet[],
): {
  notes: string[];
  matched: number;
  closeMatched: number;
  metricMatches: number;
  closeRatio: number;
  confidenceDelta: number;
  crossCheck: SiteTwinRoofCrossCheck;
} {
  const notes: string[] = [];
  const comparisons: SiteTwinRoofCrossCheck["comparisons"] = [];
  const unused = new Set(remoteFacets.map((_, index) => index));
  let matched = 0;
  let closeMatched = 0;
  let metricMatches = 0;

  for (const local of localFaces) {
    let bestIndex: number | null = null;
    let best = {
      score: Number.POSITIVE_INFINITY,
      close: false,
      metricCount: 0,
      azimuthDelta: null as number | null,
      slopeDelta: null as number | null,
      areaRelativeError: null as number | null,
    };
    for (const index of unused) {
      const candidate = facetPair(local, remoteFacets[index]!);
      if (candidate.score < best.score) {
        bestIndex = index;
        best = candidate;
      }
    }
    if (bestIndex == null || !Number.isFinite(best.score)) continue;

    unused.delete(bestIndex);
    matched += 1;
    metricMatches += 1;
    if (best.close) closeMatched += 1;
    const remote = remoteFacets[bestIndex]!;

    comparisons.push({
      localFaceId: local.id,
      localDisplayLabel: local.displayLabel,
      remoteFacetId: remote.id,
      azimuthDeltaDeg: best.azimuthDelta,
      slopeDeltaDeg: best.slopeDelta,
      areaRelativeError: best.areaRelativeError,
      metricCount: best.metricCount,
      status: best.close ? "agreement" : "conflict",
    });

    notes.push([
      `Pan ${local.displayLabel} ↔ facette distante ${remote.id}`,
      best.azimuthDelta == null ? "azimut n/a" : `Δazimut ${best.azimuthDelta.toFixed(1)}°`,
      best.slopeDelta == null ? "pente n/a" : `Δpente ${best.slopeDelta.toFixed(1)}°`,
      best.areaRelativeError == null ? "surface n/a" : `Δsurface ${(best.areaRelativeError * 100).toFixed(0)} %`,
      best.close ? "accord géométrique" : "écart à contrôler",
    ].join(" · "));
  }

  const comparable = comparisons.length;
  const agreementCount = comparisons.filter((item) => item.status === "agreement").length;
  const conflictCount = comparisons.filter((item) => item.status === "conflict").length;
  const closeRatio = comparable > 0 ? agreementCount / comparable : 0;
  const blockingConflict = comparable > 0 && conflictCount > agreementCount;
  let confidenceDelta = 0;
  if (metricMatches > 0 && localFaces.length === remoteFacets.length && closeRatio >= 0.75) confidenceDelta = 0.025;
  if (metricMatches > 0 && (Math.abs(localFaces.length - remoteFacets.length) >= 2 || closeRatio < 0.4)) confidenceDelta = -0.04;

  const crossCheck: SiteTwinRoofCrossCheck = {
    source: "advanced-roof-model",
    localFaceCount: localFaces.length,
    remoteFacetCount: remoteFacets.length,
    matchedFacetCount: matched,
    comparableFacetCount: comparable,
    agreementCount,
    conflictCount,
    closeRatio,
    blockingConflict,
    status: comparable === 0 ? "not-comparable" : conflictCount === 0 ? "consistent" : "conflict",
    comparisons,
  };

  return { notes, matched, closeMatched, metricMatches, closeRatio, confidenceDelta, crossCheck };
}
