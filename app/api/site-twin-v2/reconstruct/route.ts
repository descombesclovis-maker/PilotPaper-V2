import { buildSiteTwin } from "@/lib/site-twin-v2/siteTwinBuilder";
import { SiteTwinError } from "@/lib/site-twin-v2/errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { address?: unknown };
    const address = String(body.address ?? "").trim();
    if (address.length < 8) {
      return Response.json({ error: "Adresse exacte requise pour construire le Site Twin." }, { status: 400 });
    }
    const twin = await buildSiteTwin(address);
    return Response.json({
      siteTwin: twin,
      validationStatus: "test_unverified",
      architecture: "site-twin-v2",
    }, {
      headers: {
        "Cache-Control": "no-store",
        "X-PilotPaper-Mode": "test_unverified",
      },
    });
  } catch (error) {
    const status = error instanceof SiteTwinError && error.recoverable ? 422 : 500;
    console.error("[site-twin-v2] reconstruction failed", error);
    return Response.json({
      error: error instanceof Error ? error.message : "La reconstruction Site Twin a échoué.",
      code: error instanceof SiteTwinError ? error.code : "GEOMETRY_RECONSTRUCTION_FAILED",
      recoverable: error instanceof SiteTwinError ? error.recoverable : false,
      details: error instanceof SiteTwinError ? error.details : undefined,
      validationStatus: "test_unverified",
    }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
