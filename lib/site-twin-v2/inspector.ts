import { SiteTwinError } from "./errors";
import { assertPiecesShareContext, type SiteTwinDocumentContext, type SiteTwinPieceReceipt } from "./documentContext";
import { assertCameraRegistrationForDp6, assertLayoutPolicy, assertTwinReadyForAutomaticDocuments } from "./policy";

export type InspectorCheck = {
  id: string;
  passed: boolean;
  critical: boolean;
  message: string;
};

export type InspectorReport = {
  passed: boolean;
  score: number;
  checks: InspectorCheck[];
};

function push(checks: InspectorCheck[], id: string, passed: boolean, critical: boolean, message: string) {
  checks.push({ id, passed, critical, message });
}

export function inspectCanonicalContext(context: SiteTwinDocumentContext): InspectorReport {
  const checks: InspectorCheck[] = [];
  try {
    assertTwinReadyForAutomaticDocuments(context.siteTwin);
    push(checks, "twin-ready", true, true, "Site Twin géométriquement exploitable.");
  } catch (error) {
    push(checks, "twin-ready", false, true, error instanceof Error ? error.message : "Site Twin invalide.");
  }

  try {
    assertLayoutPolicy(context.siteTwin, context.layout);
    push(checks, "layout-policy", true, true, "Calepinage cohérent avec le Site Twin.");
  } catch (error) {
    push(checks, "layout-policy", false, true, error instanceof Error ? error.message : "Calepinage invalide.");
  }

  const exactCount = context.layout.modules.length === context.layout.configuration.panelCount;
  push(
    checks,
    "exact-module-count",
    exactCount,
    true,
    exactCount
      ? `${context.layout.modules.length} modules exactement.`
      : `${context.layout.modules.length} modules présents au lieu de ${context.layout.configuration.panelCount}.`,
  );

  const physicalFaceIds = new Set(context.siteTwin.roof.faces.map((face) => face.id));
  const moduleFacesValid = context.layout.modules.every((module) => physicalFaceIds.has(module.faceId));
  push(checks, "module-face-identity", moduleFacesValid, true, moduleFacesValid
    ? "Tous les modules appartiennent à des pans physiques canoniques."
    : "Au moins un module cible un pan inexistant.");

  const allFacesExplicit = context.siteTwin.roof.faces.every((face) => context.layout.eligibility.some((entry) => entry.faceId === face.id));
  push(checks, "all-physical-faces-preserved", allFacesExplicit, true, allFacesExplicit
    ? "Tous les pans physiques restent présents, y compris incompatibles."
    : "Des pans physiques ont disparu de l'éligibilité PV.");

  const criticalFailures = checks.filter((check) => check.critical && !check.passed).length;
  const passedCount = checks.filter((check) => check.passed).length;
  return {
    passed: criticalFailures === 0,
    score: checks.length ? passedCount / checks.length : 0,
    checks,
  };
}

export function inspectDp6Registration(context: SiteTwinDocumentContext, photoId: string): InspectorCheck {
  try {
    const registration = assertCameraRegistrationForDp6(context.siteTwin, photoId);
    return {
      id: "dp6-camera-registration",
      passed: true,
      critical: true,
      message: `Photo recalée (${registration.reprojectionErrorPx?.toFixed(1) ?? "?"} px d'erreur).`,
    };
  } catch (error) {
    return {
      id: "dp6-camera-registration",
      passed: false,
      critical: true,
      message: error instanceof Error ? error.message : "Recalage DP6 invalide.",
    };
  }
}

export function inspectCrossPieceConsistency(
  context: SiteTwinDocumentContext,
  receipts: SiteTwinPieceReceipt[],
): InspectorReport {
  const base = inspectCanonicalContext(context);
  const checks = [...base.checks];
  try {
    assertPiecesShareContext(context, receipts);
    push(checks, "cross-piece-context", true, true, "Toutes les DP utilisent exactement la même révision Site Twin et le même calepinage.");
  } catch (error) {
    push(checks, "cross-piece-context", false, true, error instanceof Error ? error.message : "Incohérence inter-pièces.");
  }
  const criticalFailures = checks.filter((check) => check.critical && !check.passed).length;
  const passedCount = checks.filter((check) => check.passed).length;
  return { passed: criticalFailures === 0, score: checks.length ? passedCount / checks.length : 0, checks };
}

export function requireInspectorPass(report: InspectorReport) {
  const critical = report.checks.filter((check) => check.critical && !check.passed);
  if (critical.length) {
    throw new SiteTwinError(
      "CROSS_PIECE_INCONSISTENCY",
      `PilotPaper Inspector rejette la sortie : ${critical.map((check) => check.message).join(" | ")}`,
      { recoverable: true, details: { checks: report.checks } },
    );
  }
  return report;
}
