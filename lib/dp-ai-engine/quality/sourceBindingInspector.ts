import type { ArchitecturalEvidence } from "@/lib/architectural-evidence";
import type { DpRenderedView, DpSourceFile } from "@/lib/dp-pdf";

export type SourceBindingIssue = {
  code: "RENDERED_VIEW_MISSING" | "SOURCE_KIND_MISSING" | "SOURCE_MISSING" | "SOURCE_PROVENANCE_MISSING" | "SOURCE_SHA_MISMATCH";
  field: string;
  message: string;
};

const REQUIRED_V1_PROJECT_VIEWS = ["dp4_project", "dp6_project"] as const;

/**
 * Cryptographically bind every rendered visual to the exact source evidence
 * used by the geometry engine. A stale/replaced photo must never be combined
 * with geometry calculated from another byte sequence.
 */
export function inspectRenderedSourceBindings(
  evidence: ArchitecturalEvidence,
  sources: DpSourceFile[],
  renderedViews: DpRenderedView[],
): SourceBindingIssue[] {
  const issues: SourceBindingIssue[] = [];
  const sourceByKind = new Map(sources.map((source) => [source.kind, source]));
  const renderedByKind = new Map(renderedViews.map((view) => [view.kind, view]));

  for (const kind of REQUIRED_V1_PROJECT_VIEWS) {
    if (!renderedByKind.has(kind)) {
      issues.push({
        code: "RENDERED_VIEW_MISSING",
        field: kind,
        message: `${kind} manque au jeu de rendus V1 contrôlés.`,
      });
    }
  }

  for (const rendered of renderedViews) {
    if (!rendered.sourceKind) continue;
    const source = sourceByKind.get(rendered.sourceKind);
    if (!source) {
      issues.push({
        code: "SOURCE_MISSING",
        field: rendered.kind,
        message: `${rendered.kind} référence une source absente : ${rendered.sourceKind}.`,
      });
      continue;
    }

    const expectedSha = evidence.geometry.source_sha256[rendered.sourceKind];
    if (!expectedSha) {
      issues.push({
        code: "SOURCE_PROVENANCE_MISSING",
        field: rendered.kind,
        message: `${rendered.kind} n'a pas de provenance géométrique SHA-256 pour ${rendered.sourceKind}.`,
      });
      continue;
    }

    if (expectedSha !== source.sha256) {
      issues.push({
        code: "SOURCE_SHA_MISMATCH",
        field: rendered.kind,
        message: `${rendered.kind} ne correspond plus aux octets source ayant servi au calcul géométrique (${rendered.sourceKind}).`,
      });
    }
  }

  return issues;
}
