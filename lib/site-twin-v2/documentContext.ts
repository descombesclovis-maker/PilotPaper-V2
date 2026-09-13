import { SiteTwinError } from "./errors";
import { assertLayoutPolicy, assertTwinReadyForAutomaticDocuments } from "./policy";
import type { PvLayoutSnapshot, SiteTwin } from "./types";

export type SiteTwinDocumentContext = Readonly<{
  contextId: string;
  siteTwin: SiteTwin;
  layout: PvLayoutSnapshot;
  createdAt: string;
}>;

export type SiteTwinPieceReceipt = {
  dp: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  contextId: string;
  siteTwinId: string;
  siteTwinRevision: number;
  layoutPanelCount: number;
  selectedFaceIds: string[];
};

export function createDocumentContext(twin: SiteTwin, layout: PvLayoutSnapshot): SiteTwinDocumentContext {
  assertTwinReadyForAutomaticDocuments(twin);
  assertLayoutPolicy(twin, layout);
  const contextId = `${twin.id}:r${twin.revision}:${layout.configuration.moduleReference}:${layout.configuration.panelCount}`;
  return Object.freeze({ contextId, siteTwin: twin, layout, createdAt: new Date().toISOString() });
}

export function receiptForPiece(context: SiteTwinDocumentContext, dp: SiteTwinPieceReceipt["dp"]): SiteTwinPieceReceipt {
  return {
    dp,
    contextId: context.contextId,
    siteTwinId: context.siteTwin.id,
    siteTwinRevision: context.siteTwin.revision,
    layoutPanelCount: context.layout.modules.length,
    selectedFaceIds: [...context.layout.selectedFaceIds],
  };
}

export function assertPiecesShareContext(context: SiteTwinDocumentContext, receipts: SiteTwinPieceReceipt[]) {
  for (const receipt of receipts) {
    if (
      receipt.contextId !== context.contextId
      || receipt.siteTwinId !== context.siteTwin.id
      || receipt.siteTwinRevision !== context.siteTwin.revision
    ) {
      throw new SiteTwinError(
        "CROSS_PIECE_INCONSISTENCY",
        `DP${receipt.dp} n'utilise pas le même Site Twin que le dossier.`,
      );
    }
    if (receipt.layoutPanelCount !== context.layout.configuration.panelCount) {
      throw new SiteTwinError(
        "CROSS_PIECE_INCONSISTENCY",
        `DP${receipt.dp} annonce ${receipt.layoutPanelCount} panneaux au lieu de ${context.layout.configuration.panelCount}.`,
      );
    }
    if (receipt.selectedFaceIds.join("|") !== context.layout.selectedFaceIds.join("|")) {
      throw new SiteTwinError(
        "CROSS_PIECE_INCONSISTENCY",
        `DP${receipt.dp} ne cible pas les mêmes pans physiques que le dossier.`,
      );
    }
  }
  return receipts;
}
