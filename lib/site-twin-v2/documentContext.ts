import { createHash } from "node:crypto";
import { SiteTwinError } from "./errors";
import { assertLayoutPolicy, assertTwinReadyForAutomaticDocuments } from "./policy";
import type { PvLayoutSnapshot, SiteTwin } from "./types";

export type SiteTwinDocumentContext = Readonly<{
  contextId: string;
  layoutDigest: string;
  siteTwin: SiteTwin;
  layout: PvLayoutSnapshot;
  createdAt: string;
}>;

export type SiteTwinPieceReceipt = {
  dp: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  contextId: string;
  layoutDigest: string;
  siteTwinId: string;
  siteTwinRevision: number;
  layoutPanelCount: number;
  selectedFaceIds: string[];
};

function fixed(value: number) {
  if (!Number.isFinite(value)) throw new SiteTwinError("CROSS_PIECE_INCONSISTENCY", "Coordonnée non finie dans l'empreinte géométrique du dossier.");
  return Number(value.toFixed(6));
}

function layoutDigestFor(twin: SiteTwin, layout: PvLayoutSnapshot) {
  const payload = {
    siteTwinId: twin.id,
    siteTwinRevision: twin.revision,
    selectedFaceIds: [...layout.selectedFaceIds],
    configuration: {
      moduleReference: layout.configuration.moduleReference,
      moduleWidthMm: layout.configuration.moduleWidthMm,
      moduleHeightMm: layout.configuration.moduleHeightMm,
      panelCount: layout.configuration.panelCount,
      rows: layout.configuration.rows,
      columns: layout.configuration.columns,
      orientation: layout.configuration.orientation,
      interPanelGapMm: layout.configuration.interPanelGapMm,
      preferredGutterClearanceMm: layout.configuration.preferredGutterClearanceMm,
      placement: layout.configuration.placement,
    },
    modules: [...layout.modules]
      .sort((a, b) => a.moduleIndex - b.moduleIndex)
      .map((module) => ({
        moduleIndex: module.moduleIndex,
        faceId: module.faceId,
        polygonLocalM: module.polygonLocalM.map((point) => [fixed(point.x), fixed(point.y)]),
      })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function createDocumentContext(twin: SiteTwin, layout: PvLayoutSnapshot): SiteTwinDocumentContext {
  assertTwinReadyForAutomaticDocuments(twin);
  assertLayoutPolicy(twin, layout);
  const layoutDigest = layoutDigestFor(twin, layout);
  const contextId = `${twin.id}:r${twin.revision}:${layoutDigest.slice(0, 24)}`;
  return Object.freeze({ contextId, layoutDigest, siteTwin: twin, layout, createdAt: new Date().toISOString() });
}

export function receiptForPiece(context: SiteTwinDocumentContext, dp: SiteTwinPieceReceipt["dp"]): SiteTwinPieceReceipt {
  return {
    dp,
    contextId: context.contextId,
    layoutDigest: context.layoutDigest,
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
      || receipt.layoutDigest !== context.layoutDigest
      || receipt.siteTwinId !== context.siteTwin.id
      || receipt.siteTwinRevision !== context.siteTwin.revision
    ) {
      throw new SiteTwinError(
        "CROSS_PIECE_INCONSISTENCY",
        `DP${receipt.dp} n'utilise pas exactement la même géométrie photovoltaïque que le dossier.`,
        {
          recoverable: true,
          details: {
            expectedContextId: context.contextId,
            receivedContextId: receipt.contextId,
            expectedLayoutDigest: context.layoutDigest,
            receivedLayoutDigest: receipt.layoutDigest,
          },
        },
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
