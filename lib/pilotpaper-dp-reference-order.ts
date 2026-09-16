import type { DPNumber, DpPieceOutput, VisualReference } from "@/lib/pilotpaper-image2-types";

/**
 * Single source of truth for PilotPaper project continuity.
 * Complete generation and K-par-k MUST use this exact order.
 *
 * Every reference also carries its Site Twin geometry receipt when available,
 * so downstream pieces can prove that they reuse the exact same physical
 * layout rather than merely looking visually similar. SVG pieces are retained
 * as geometry evidence even when they are not sent to a raster vision model.
 */
export function dpReferenceOrder(dp: DPNumber): Array<2 | 3 | 4 | 5> {
  if (dp === 3) return [2];
  if (dp === 4) return [2, 3];
  if (dp === 5) return [4, 2, 3];
  if (dp === 6) return [5, 4, 2];
  return [];
}

export function referencesFromResults(
  dp: DPNumber,
  source: Partial<Record<DPNumber, DpPieceOutput>>,
): VisualReference[] {
  return dpReferenceOrder(dp).flatMap((referenceDp) => {
    const candidate = source[referenceDp];
    if (!candidate?.base64) return [];
    if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(candidate.mimeType)) return [];
    return [{
      dp: referenceDp,
      mimeType: candidate.mimeType as VisualReference["mimeType"],
      base64: candidate.base64,
      geometryReceipt: candidate.geometryReceipt,
    }];
  });
}
