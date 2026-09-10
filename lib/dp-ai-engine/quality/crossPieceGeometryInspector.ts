import type { GeneratedAsset, ProjectContext, QualityIssue } from "../types";
import { allPanelPolygonsForRole } from "../geometry/panelProjection";

export interface CrossPieceGeometryInspection {
  passed: boolean;
  issues: QualityIssue[];
  physicalModuleCount: number;
}

function fatal(code: string, message: string, correction: string): QualityIssue {
  return { code, severity: "fatal", message, correction };
}

function countOccurrences(text: string, needle: string) {
  let count = 0;
  let offset = 0;
  while (true) {
    const found = text.indexOf(needle, offset);
    if (found < 0) return count;
    count++;
    offset = found + needle.length;
  }
}

/**
 * Independent cross-piece geometry inspector. It never interprets pixels with AI:
 * all three project representations must be traceable to the same persisted
 * physical module identities before the visual cross-piece judge is allowed to run.
 */
export function inspectCrossPieceGeometry(
  context: ProjectContext,
  assets: GeneratedAsset[],
): CrossPieceGeometryInspection {
  const issues: QualityIssue[] = [];
  const placements = context.facePlacements ?? [];
  const physicalModules = placements.flatMap((placement) => placement.modulePlacementsMm ?? []);

  if (!placements.length || physicalModules.length !== context.exactPanelCount) {
    issues.push(fatal(
      "PHYSICAL_LAYOUT_NOT_AUTHORITATIVE",
      `Cross-piece inspection found ${physicalModules.length} persisted physical modules for ${context.exactPanelCount} expected.`,
      "Recompute and persist the complete physical layout before generating DP4/DP5/DP6.",
    ));
  }

  const indices = physicalModules.map((placedPanel) => placedPanel.index);
  const uniqueIndices = new Set(indices);
  if (uniqueIndices.size !== indices.length || indices.some((index) => !Number.isInteger(index) || index < 0)) {
    issues.push(fatal(
      "PHYSICAL_MODULE_IDENTITY_INVALID",
      "Physical photovoltaic module indices are duplicated or invalid.",
      "Rebuild the layout with one stable unique index per physical module.",
    ));
  }
  if (physicalModules.length === context.exactPanelCount) {
    const expected = Array.from({ length: context.exactPanelCount }, (_, index) => index);
    const actual = [...uniqueIndices].sort((a, b) => a - b);
    if (expected.some((value, index) => actual[index] !== value)) {
      issues.push(fatal(
        "PHYSICAL_MODULE_IDENTITY_INCOMPLETE",
        "Physical module indices are not the complete canonical 0..N-1 project identity set.",
        "Reindex the deterministic project layout before any DP rendering.",
      ));
    }
  }

  const dp5 = assets.find((asset) => asset.dp === 5);
  if (!dp5?.text) {
    issues.push(fatal(
      "DP5_GEOMETRY_TRACE_MISSING",
      "DP5 has no deterministic geometry representation available for cross-piece inspection.",
      "Regenerate DP5 from the authoritative physical module set.",
    ));
  } else {
    for (const placedPanel of physicalModules) {
      const marker = `data-module-index="${placedPanel.index}"`;
      if (countOccurrences(dp5.text, marker) !== 1) {
        issues.push(fatal(
          "DP5_MODULE_IDENTITY_MISMATCH",
          `DP5 does not contain exactly one representation of physical module ${placedPanel.index}.`,
          "Reject DP5 and render it directly from the persisted physical module polygons.",
        ));
      }
    }
  }

  for (const dp of [4, 6] as const) {
    const asset = assets.find((candidate) => candidate.dp === dp);
    if (!asset?.sourceRole) {
      issues.push(fatal(
        `DP${dp}_SOURCE_TRACE_MISSING`,
        `DP${dp} has no source photograph role for deterministic projection traceability.`,
        `Regenerate DP${dp} from a traceable project photograph.`,
      ));
      continue;
    }
    const polygons = allPanelPolygonsForRole(context, asset.sourceRole);
    if (!polygons || polygons.length !== context.exactPanelCount) {
      issues.push(fatal(
        `DP${dp}_PROJECTED_MODULE_SET_MISMATCH`,
        `DP${dp} source view exposes ${polygons?.length ?? 0} projected modules for ${context.exactPanelCount} expected.`,
        `Reject DP${dp} and project the complete canonical physical module set into its source photograph.`,
      ));
    }
  }

  return {
    passed: issues.length === 0,
    issues: [...new Map(issues.map((issue) => [`${issue.code}:${issue.message}`, issue])).values()],
    physicalModuleCount: physicalModules.length,
  };
}
