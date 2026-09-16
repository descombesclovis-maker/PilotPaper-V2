import type { DpPieceInput, DpPieceOutput } from "@/lib/pilotpaper-image2-types";
import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";
import {
  assertPiecesShareContext,
  createDocumentContext,
  receiptForPiece,
  type SiteTwinDocumentContext,
} from "./documentContext";
import { SiteTwinError } from "./errors";
import { buildPvLayout } from "./pvLayoutEngine";
import { renderDp2FromSiteTwin } from "./renderers/dp2";
import { renderDp3FromSiteTwin } from "./renderers/dp3";
import { getOrBuildSiteTwin } from "./siteTwinCache";

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} doit être un entier positif.`);
  return parsed;
}

function finite(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function point(point: { x: number; y: number }) {
  return `(${point.x.toFixed(2)},${point.y.toFixed(2)})`;
}

function assertReferenceGeometry(input: DpPieceInput, context: SiteTwinDocumentContext) {
  const references = input.references ?? [];
  const receipts = references.flatMap((reference) => reference.geometryReceipt ? [reference.geometryReceipt] : []);
  if (receipts.length) assertPiecesShareContext(context, receipts);

  if (input.dp >= 3 && input.dp <= 6) {
    const dp2Reference = references.find((reference) => reference.dp === 2);
    if (dp2Reference && !dp2Reference.geometryReceipt) {
      throw new SiteTwinError(
        "CROSS_PIECE_INCONSISTENCY",
        "La référence DP2 ne contient pas d'empreinte géométrique V2. Régénérez DP2 avant de poursuivre le dossier.",
        { recoverable: true },
      );
    }
  }
}

export async function buildSiteTwinDocumentContext(input: DpPieceInput): Promise<SiteTwinDocumentContext> {
  const address = input.address?.trim() ?? "";
  if (address.length < 8) throw new Error("Adresse exacte requise pour construire le Site Twin métrique.");

  const moduleSpec = requireVerifiedPvModule(input.moduleReference ?? "");
  const panelCount = positiveInteger(input.panelCount, "Le nombre de panneaux");
  const rows = positiveInteger(input.rows, "Le nombre de rangées");
  const columns = positiveInteger(input.columns, "Le nombre de colonnes");
  if (rows * columns !== panelCount) {
    throw new Error(`${rows} × ${columns} ne correspond pas à ${panelCount} panneaux.`);
  }

  const twin = await getOrBuildSiteTwin(address);
  const layout = buildPvLayout({
    twin,
    configuration: {
      moduleReference: moduleSpec.canonicalReference,
      moduleWidthMm: moduleSpec.widthMm,
      moduleHeightMm: moduleSpec.heightMm,
      panelCount,
      rows,
      columns,
      orientation: input.orientation === "landscape" ? "landscape" : "portrait",
      interPanelGapMm: Math.max(0, finite(input.interPanelGapMm, 20)),
      preferredGutterClearanceMm: Math.max(0, finite(input.gutterClearanceMm, 300)),
      placement: input.placement ?? "centered",
    },
  });
  const context = createDocumentContext(twin, layout);
  assertReferenceGeometry(input, context);
  return context;
}

export function siteTwinVisualConstraintPrompt(context: SiteTwinDocumentContext) {
  const faceId = context.layout.selectedFaceIds[0];
  const face = context.siteTwin.roof.faces.find((candidate) => candidate.id === faceId);
  if (!face) throw new Error("Le pan sélectionné du Site Twin est introuvable.");
  const eligibility = context.layout.eligibility.find((candidate) => candidate.faceId === face.id);
  const moduleRows = context.layout.modules.map((module) => (
    `M${module.moduleIndex + 1}: ${module.polygonLocalM.map(point).join(" ")}`
  ));
  const advanced = context.siteTwin.sources.advancedRoofFacetCount;

  return [
    "PILOTPAPER SITE TWIN METRIC LOCK — HIDDEN GEOMETRY CONSTRAINT.",
    `Canonical context: ${context.contextId}.`,
    `Layout digest: ${context.layoutDigest}.`,
    `Target roof plane: ${face.displayLabel} / ${face.id}; building ${face.buildingId}.`,
    `Measured roof plane: slope ${face.slopeDeg.toFixed(2)}°, azimuth ${face.azimuthDeg.toFixed(2)}°, usable physical area ${face.areaM2.toFixed(2)} m².`,
    `Roof-plane polygon in PilotPaper local metric XY coordinates: ${face.polygonLocalM.map(point).join(" ")}.`,
    `Locked PV layout: EXACTLY ${context.layout.configuration.panelCount} modules, ${context.layout.configuration.rows} rows × ${context.layout.configuration.columns} columns, ${context.layout.configuration.orientation}.`,
    `Resolved lower/gutter clearance: ${eligibility?.resolvedGutterClearanceMm ?? context.layout.configuration.preferredGutterClearanceMm} mm. Inter-module gap: ${context.layout.configuration.interPanelGapMm} mm.`,
    `The deterministic layout contains ${context.layout.modules.length} metric module rectangles on that one roof plane.`,
    ...moduleRows,
    advanced
      ? `Independent advanced roof model also reports ${advanced} roof facet(s). Use it only as a cross-check; the PilotPaper metric layout above remains the coordinate authority.`
      : "No independent advanced roof facet count is currently available; do not invent one.",
    "These XY coordinates are metric roof-local coordinates, NOT image pixels. Preserve their topology, count, relative spacing and one-plane relationship when projecting onto the supplied photograph/aerial image.",
    "Do not let visual convenience override this layout. If the image evidence conflicts with the metric lock, preserve the real building and flag/correct the projection rather than changing panel count, matrix, module size or roof plane.",
  ].join("\n");
}

export async function resolveSiteTwinVisualConstraint(input: DpPieceInput) {
  try {
    const context = await buildSiteTwinDocumentContext(input);
    return {
      usable: true as const,
      context,
      promptContext: siteTwinVisualConstraintPrompt(context),
      warning: "",
    };
  } catch (error) {
    return {
      usable: false as const,
      context: null,
      promptContext: "",
      warning: error instanceof Error ? error.message : "Site Twin métrique indisponible.",
    };
  }
}

function svgOutput(args: {
  dp: 2 | 3;
  title: string;
  svg: string;
  context: SiteTwinDocumentContext;
}): DpPieceOutput {
  const face = args.context.siteTwin.roof.faces.find((candidate) => (
    candidate.id === args.context.layout.selectedFaceIds[0]
  ));
  const eligibility = args.context.layout.eligibility.find((candidate) => candidate.faceId === face?.id);
  return {
    dp: args.dp,
    title: args.title,
    validationStatus: "test_unverified",
    mimeType: "image/svg+xml",
    base64: Buffer.from(args.svg, "utf8").toString("base64"),
    text: args.svg,
    sourceSummary: [
      `DP${args.dp} calculée depuis le Site Twin métrique ${args.context.siteTwin.id} rev. ${args.context.siteTwin.revision}.`,
      `Empreinte géométrique : ${args.context.layoutDigest.slice(0, 16)}.`,
      `${args.context.layout.modules.length} panneaux positionnés par calcul déterministe sur le pan ${face?.displayLabel ?? face?.id ?? "sélectionné"}.`,
      `Pente ${face?.slopeDeg.toFixed(1) ?? "?"}° · azimut ${face?.azimuthDeg.toFixed(1) ?? "?"}° · recul bas résolu ${eligibility?.resolvedGutterClearanceMm ?? args.context.layout.configuration.preferredGutterClearanceMm} mm.`,
      "Aucune IA générative n'a choisi les coordonnées des panneaux.",
    ],
    inspector: {
      passed: true,
      score: 1,
      checks: [
        `Site Twin unique : ${args.context.contextId}`,
        `Empreinte exacte : ${args.context.layoutDigest.slice(0, 16)}`,
        `Quantité exacte : ${args.context.layout.modules.length}/${args.context.layout.configuration.panelCount}`,
        `Pan physique verrouillé : ${face?.displayLabel ?? face?.id ?? "oui"}`,
        "Coordonnées des modules déterministes : oui",
      ],
      issues: [],
    },
    geometryReceipt: receiptForPiece(args.context, args.dp),
  };
}

export async function generateDeterministicSiteTwinPiece(input: DpPieceInput & { dp: 2 | 3 }): Promise<DpPieceOutput> {
  const context = await buildSiteTwinDocumentContext(input);
  if (input.dp === 2) {
    const rendered = renderDp2FromSiteTwin(context);
    return svgOutput({ dp: 2, title: "DP2 — Plan de masse", svg: rendered.text, context });
  }
  const rendered = await renderDp3FromSiteTwin(context);
  return svgOutput({ dp: 3, title: "DP3 — Plan en coupe", svg: rendered.text, context });
}
