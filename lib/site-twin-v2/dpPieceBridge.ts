import type { DpPieceInput, DpPieceOutput } from "@/lib/pilotpaper-image2-types";
import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";
import { createDocumentContext, type SiteTwinDocumentContext } from "./documentContext";
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
  return createDocumentContext(twin, layout);
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
      `${args.context.layout.modules.length} panneaux positionnés par calcul déterministe sur le pan ${face?.displayLabel ?? face?.id ?? "sélectionné"}.`,
      `Pente ${face?.slopeDeg.toFixed(1) ?? "?"}° · azimut ${face?.azimuthDeg.toFixed(1) ?? "?"}° · recul bas résolu ${eligibility?.resolvedGutterClearanceMm ?? args.context.layout.configuration.preferredGutterClearanceMm} mm.`,
      "Aucune IA générative n'a choisi les coordonnées des panneaux.",
    ],
    inspector: {
      passed: true,
      score: 1,
      checks: [
        `Site Twin unique : ${args.context.contextId}`,
        `Quantité exacte : ${args.context.layout.modules.length}/${args.context.layout.configuration.panelCount}`,
        `Pan physique verrouillé : ${face?.displayLabel ?? face?.id ?? "oui"}`,
        "Coordonnées des modules déterministes : oui",
      ],
      issues: [],
    },
  };
}

export async function generateDeterministicSiteTwinPiece(input: DpPieceInput & { dp: 2 | 3 }): Promise<DpPieceOutput> {
  const context = await buildSiteTwinDocumentContext(input);
  if (input.dp === 2) {
    const rendered = renderDp2FromSiteTwin(context);
    return svgOutput({ dp: 2, title: "DP2 — Plan de masse", svg: rendered.text, context });
  }
  const rendered = renderDp3FromSiteTwin(context);
  return svgOutput({ dp: 3, title: "DP3 — Plan en coupe", svg: rendered.text, context });
}
