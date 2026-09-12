import type {
  GoogleSolarBuildingInsights,
  GoogleSolarRoofSegment,
} from "../providers/googleSolar";

export type GoogleSolarFaceDescriptor = {
  faceId: string;
  faceRank: number;
  originalSegmentIndex: number;
  segment: GoogleSolarRoofSegment;
  areaMeters2: number;
  panelCount: number;
};

export type SelectedGoogleSolarFace = GoogleSolarFaceDescriptor & {
  insights: GoogleSolarBuildingInsights;
};

export type SelectedGoogleSolarFaces = {
  faceIds: string[];
  faces: GoogleSolarFaceDescriptor[];
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

export function listGoogleSolarFaces(
  insights: GoogleSolarBuildingInsights,
): GoogleSolarFaceDescriptor[] {
  const panelCountBySegment = new Map<number, number>();
  for (const panel of insights.solarPotential.solarPanels) {
    panelCountBySegment.set(panel.segmentIndex, (panelCountBySegment.get(panel.segmentIndex) ?? 0) + 1);
  }

  return insights.solarPotential.roofSegmentStats
    .map((segment, originalSegmentIndex) => ({
      segment,
      originalSegmentIndex,
      areaMeters2: segmentArea(segment),
      panelCount: panelCountBySegment.get(originalSegmentIndex) ?? 0,
    }))
    .sort((a, b) => (
      b.areaMeters2 - a.areaMeters2
      || b.panelCount - a.panelCount
      || a.originalSegmentIndex - b.originalSegmentIndex
    ))
    .map((entry, faceRank) => ({
      ...entry,
      faceRank,
      faceId: String.fromCharCode(65 + faceRank),
    }));
}

function compactInsightsForSegments(
  insights: GoogleSolarBuildingInsights,
  selected: GoogleSolarFaceDescriptor[],
) {
  const compactIndexByOriginal = new Map<number, number>();
  selected.forEach((face, compactIndex) => compactIndexByOriginal.set(face.originalSegmentIndex, compactIndex));

  const selectedPanels = insights.solarPotential.solarPanels
    .filter((panel) => compactIndexByOriginal.has(panel.segmentIndex))
    .map((panel) => ({
      ...panel,
      segmentIndex: compactIndexByOriginal.get(panel.segmentIndex)!,
    }));

  for (const face of selected) {
    if (!selectedPanels.some((panel) => panel.segmentIndex === compactIndexByOriginal.get(face.originalSegmentIndex))) {
      throw new Error(
        `Google Solar : le segment physique ${face.originalSegmentIndex + 1} existe mais ne fournit aucune cellule photovoltaïque exploitable.`,
      );
    }
  }

  return {
    ...insights,
    solarPotential: {
      ...insights.solarPotential,
      roofSegmentStats: selected.map((face) => face.segment),
      solarPanels: selectedPanels,
    },
  };
}

export function selectGoogleSolarFaces(
  insights: GoogleSolarBuildingInsights,
  faceIds: string[],
): SelectedGoogleSolarFaces {
  const requested = [...new Set(faceIds.map((id) => String(id ?? "").trim().toUpperCase()).filter(Boolean))];
  if (!requested.length) throw new Error("Google Solar : sélectionnez au moins un pan de toiture.");

  const ranked = listGoogleSolarFaces(insights);
  const selected = requested.map((faceId) => {
    const rank = requestedFaceRank(faceId);
    const face = ranked[rank];
    if (!face) {
      throw new Error(
        `Google Solar : le pan ${faceId} n'existe pas sur ce bâtiment (${ranked.length} pan(s) détecté(s)).`,
      );
    }
    return face;
  });

  return {
    faceIds: selected.map((face) => face.faceId),
    faces: selected,
    insights: compactInsightsForSegments(insights, selected),
  };
}

/**
 * Physical selector used after a user clicked a roof marker. Unlike A/B/C,
 * originalSegmentIndex never changes when irrelevant neighbour faces are
 * filtered or when the display list is re-lettered.
 */
export function selectGoogleSolarFaceBySegmentIndex(
  insights: GoogleSolarBuildingInsights,
  originalSegmentIndex: number,
): SelectedGoogleSolarFace {
  if (!Number.isInteger(originalSegmentIndex) || originalSegmentIndex < 0) {
    throw new Error("Google Solar : identité physique du pan invalide.");
  }
  const face = listGoogleSolarFaces(insights)
    .find((candidate) => candidate.originalSegmentIndex === originalSegmentIndex);
  if (!face) {
    throw new Error(`Google Solar : le segment physique ${originalSegmentIndex + 1} n'existe pas sur le bâtiment verrouillé.`);
  }
  return {
    ...face,
    insights: compactInsightsForSegments(insights, [face]),
  };
}

export function selectGoogleSolarFace(
  insights: GoogleSolarBuildingInsights,
  faceId: string,
): SelectedGoogleSolarFace {
  const selection = selectGoogleSolarFaces(insights, [faceId]);
  const face = selection.faces[0]!;
  return { ...face, insights: selection.insights };
}
