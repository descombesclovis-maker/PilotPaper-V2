import type {
  GoogleSolarBuildingInsights,
  GoogleSolarRoofSegment,
} from "../providers/googleSolar";

export type SelectedGoogleSolarFace = {
  faceId: string;
  faceRank: number;
  originalSegmentIndex: number;
  segment: GoogleSolarRoofSegment;
  insights: GoogleSolarBuildingInsights;
};

function requestedFaceRank(faceId: string) {
  const normalized = String(faceId ?? "").trim().toUpperCase();
  const match = normalized.match(/^(?:PAN\s*)?([A-Z])$/);
  if (!match) {
    throw new Error(`Google Solar : pan "${faceId}" invalide. Utilisez A, B, C…`);
  }
  return match[1]!.charCodeAt(0) - 65;
}

function segmentArea(segment: GoogleSolarRoofSegment) {
  const ground = Number(segment.stats?.groundAreaMeters2);
  if (Number.isFinite(ground) && ground > 0) return ground;
  const slope = Number(segment.stats?.areaMeters2);
  return Number.isFinite(slope) && slope > 0 ? slope : 0;
}

/**
 * Assigns stable human roof-face letters to physical Google Solar segments.
 * A/B/C are geometry identities, not "best available layout" aliases.
 * The ordering never depends on requested panel count, orientation or energy.
 */
export function selectGoogleSolarFace(
  insights: GoogleSolarBuildingInsights,
  faceId: string,
): SelectedGoogleSolarFace {
  const faceRank = requestedFaceRank(faceId);
  const panelCountBySegment = new Map<number, number>();
  for (const panel of insights.solarPotential.solarPanels) {
    panelCountBySegment.set(panel.segmentIndex, (panelCountBySegment.get(panel.segmentIndex) ?? 0) + 1);
  }

  const ranked = insights.solarPotential.roofSegmentStats
    .map((segment, originalSegmentIndex) => ({
      segment,
      originalSegmentIndex,
      area: segmentArea(segment),
      panelCount: panelCountBySegment.get(originalSegmentIndex) ?? 0,
    }))
    .sort((a, b) => (
      b.area - a.area
      || b.panelCount - a.panelCount
      || a.originalSegmentIndex - b.originalSegmentIndex
    ));

  const selected = ranked[faceRank];
  if (!selected) {
    throw new Error(
      `Google Solar : le pan ${faceId.toUpperCase()} n'existe pas sur ce bâtiment (${ranked.length} pan(s) détecté(s)).`,
    );
  }

  const selectedPanels = insights.solarPotential.solarPanels
    .filter((panel) => panel.segmentIndex === selected.originalSegmentIndex)
    .map((panel) => ({ ...panel, segmentIndex: 0 }));

  if (!selectedPanels.length) {
    throw new Error(
      `Google Solar : le pan ${faceId.toUpperCase()} est bien distinct mais Google ne fournit aucune cellule photovoltaïque exploitable dessus.`,
    );
  }

  return {
    faceId: faceId.toUpperCase(),
    faceRank,
    originalSegmentIndex: selected.originalSegmentIndex,
    segment: selected.segment,
    insights: {
      ...insights,
      solarPotential: {
        ...insights.solarPotential,
        roofSegmentStats: [selected.segment],
        solarPanels: selectedPanels,
      },
    },
  };
}
