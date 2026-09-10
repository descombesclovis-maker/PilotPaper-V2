import type {
  GeneratedAsset,
  InputPhoto,
  ProjectContext,
  QualityIssue,
} from "../types";
import { allPanelPolygonsForRole } from "../geometry/panelProjection";
import { auditDeterministicImage, type DeterministicImageAudit } from "./deterministicImageAudit";

export interface DeterministicVisualInspection {
  passed: boolean;
  issues: QualityIssue[];
  audit?: DeterministicImageAudit;
}

function fatal(code: string, message: string, correction: string): QualityIssue {
  return { code, severity: "fatal", message, correction };
}

/**
 * Independent deterministic inspector for generated DP4/DP6 visuals.
 * It does not ask a model for an opinion: the persisted physical layout,
 * projection and source/output pixels are compared mechanically.
 */
export function inspectGeneratedVisualDeterministically(args: {
  context: ProjectContext;
  originalPhotos: InputPhoto[];
  generated: GeneratedAsset;
}): DeterministicVisualInspection {
  const { context, originalPhotos, generated } = args;
  if (![4, 6].includes(generated.dp)) return { passed: true, issues: [] };

  if (!generated.base64 || !generated.sourceRole) {
    return {
      passed: false,
      issues: [fatal(
        "DETERMINISTIC_VISUAL_AUDIT_UNAVAILABLE",
        `DP${generated.dp} has no generated pixels or source-role traceability.`,
        "Regenerate from a traceable source photograph before production export.",
      )],
    };
  }

  const source = originalPhotos.find((photo) => photo.role === generated.sourceRole);
  if (!source) {
    return {
      passed: false,
      issues: [fatal(
        "SOURCE_PHOTO_NOT_FOUND",
        `DP${generated.dp} refers to source role ${generated.sourceRole}, but that source is absent.`,
        "Restore the exact source photograph used for the generation and rerun the inspector.",
      )],
    };
  }

  if (source.mimeType !== "image/png" || generated.mimeType !== "image/png") {
    return {
      passed: false,
      issues: [fatal(
        "DETERMINISTIC_PIXEL_AUDIT_REQUIRES_PNG",
        `DP${generated.dp} cannot receive exact outside-mask pixel verification because source/output are not both PNG.`,
        "Use the PNG production image-edit path so exact pixel preservation can be proven.",
      )],
    };
  }

  const polygons = allPanelPolygonsForRole(context, generated.sourceRole);
  if (!polygons || polygons.length !== context.exactPanelCount) {
    return {
      passed: false,
      issues: [fatal(
        "PROJECTED_MODULE_SET_INCOMPLETE",
        `DP${generated.dp} exposes ${polygons?.length ?? 0} projected module polygons for ${context.exactPanelCount} expected modules.`,
        "Reject the output and rebuild projection from the authoritative physical module placements.",
      )],
    };
  }

  let audit: DeterministicImageAudit;
  try {
    audit = auditDeterministicImage({
      sourceBase64: source.base64,
      outputBase64: generated.base64,
      panelPolygons: polygons,
      expectedPanelCount: context.exactPanelCount,
    });
  } catch (error) {
    return {
      passed: false,
      issues: [fatal(
        "DETERMINISTIC_PIXEL_AUDIT_ERROR",
        error instanceof Error ? error.message : `DP${generated.dp} deterministic pixel audit failed.`,
        "Reject the output and rerun deterministic inspection from valid PNG inputs.",
      )],
    };
  }

  const issues: QualityIssue[] = [];
  if (!audit.exactPanelCount) {
    issues.push(fatal(
      "PANEL_COUNT_PROJECTION_MISMATCH",
      `Projected module count is ${audit.panelCountProjected}, expected ${audit.panelCountExpected}.`,
      "Rebuild projection from the authoritative physical module set.",
    ));
  }
  if (!audit.allCoordinatesFinite || !audit.allPanelsInsideImage || !audit.allPanelsNonDegenerate) {
    issues.push(fatal(
      "INVALID_PROJECTED_PANEL_GEOMETRY",
      "At least one projected photovoltaic polygon is invalid, degenerate or outside the image.",
      "Reject projection and recompute the view homography from validated roof evidence.",
    ));
  }
  if (audit.overlapPairs > 0) {
    issues.push(fatal(
      "PROJECTED_PANELS_OVERLAP",
      `${audit.overlapPairs} projected panel pair(s) overlap in the generated view.`,
      "Reject the projection and preserve the authoritative physical spacing.",
    ));
  }
  if (!audit.exactOutsideMaskPreservation) {
    issues.push(fatal(
      "BUILDING_PIXELS_CHANGED_OUTSIDE_MASK",
      audit.changedOutsidePixels >= 0
        ? `${audit.changedOutsidePixels} pixel(s) changed outside the authorized photovoltaic islands.`
        : "Source and generated image dimensions differ, so exact outside-mask preservation cannot be proven.",
      "Reject the output. Restore source pixels everywhere outside the authorized panel mask.",
    ));
  }

  return { passed: issues.length === 0, issues, audit };
}
