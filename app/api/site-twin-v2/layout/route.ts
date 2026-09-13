import { getOrBuildSiteTwin } from "@/lib/site-twin-v2/siteTwinCache";
import { buildPvLayout } from "@/lib/site-twin-v2/pvLayoutEngine";
import { SiteTwinError } from "@/lib/site-twin-v2/errors";
import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";

export const dynamic = "force-dynamic";

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} doit être un entier positif.`);
  return parsed;
}

function finite(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const address = String(body.address ?? "").trim();
    if (address.length < 8) return Response.json({ error: "Adresse exacte requise." }, { status: 400 });

    const moduleSpec = requireVerifiedPvModule(String(body.moduleReference ?? ""));
    const panelCount = positiveInteger(body.panelCount, "Le nombre de panneaux");
    const rows = positiveInteger(body.rows, "Le nombre de rangées");
    const columns = positiveInteger(body.columns, "Le nombre de colonnes");
    if (rows * columns !== panelCount) {
      return Response.json({ error: `${rows} × ${columns} ne correspond pas à ${panelCount} panneaux.` }, { status: 400 });
    }

    const twin = await getOrBuildSiteTwin(address, { force: body.forceSiteTwin === true });
    const layout = buildPvLayout({
      twin,
      selectedFaceIds: Array.isArray(body.selectedFaceIds)
        ? body.selectedFaceIds.map(String).filter(Boolean)
        : undefined,
      configuration: {
        moduleReference: moduleSpec.canonicalReference,
        moduleWidthMm: moduleSpec.widthMm,
        moduleHeightMm: moduleSpec.heightMm,
        panelCount,
        rows,
        columns,
        orientation: body.orientation === "landscape" ? "landscape" : "portrait",
        interPanelGapMm: Math.max(0, finite(body.interPanelGapMm, 20)),
        preferredGutterClearanceMm: Math.max(0, finite(body.gutterClearanceMm, 300)),
        placement: ["centered", "left", "right", "custom"].includes(String(body.placement))
          ? String(body.placement) as "centered" | "left" | "right" | "custom"
          : "centered",
      },
    });

    return Response.json({
      siteTwin: {
        id: twin.id,
        revision: twin.revision,
        normalizedAddress: twin.normalizedAddress,
        parcelReference: twin.parcel.reference,
        targetBuildingIds: twin.targetBuildingIds,
        confidence: twin.confidence,
        sources: twin.sources,
        roof: twin.roof,
      },
      layout,
      physicalFaceCount: twin.roof.faces.length,
      compatibleFaceCount: layout.eligibility.filter((entry) => entry.fits).length,
      validationStatus: "test_unverified",
    }, {
      headers: {
        "Cache-Control": "no-store",
        "X-PilotPaper-Mode": "test_unverified",
        "X-PilotPaper-Architecture": "site-twin-v2",
      },
    });
  } catch (error) {
    console.error("[site-twin-v2/layout] failed", error);
    return Response.json({
      error: error instanceof Error ? error.message : "Le calepinage Site Twin a échoué.",
      code: error instanceof SiteTwinError ? error.code : "PV_LAYOUT_INVALID",
      recoverable: error instanceof SiteTwinError ? error.recoverable : false,
      details: error instanceof SiteTwinError ? error.details : undefined,
      validationStatus: "test_unverified",
    }, { status: error instanceof SiteTwinError && error.recoverable ? 422 : 400 });
  }
}
