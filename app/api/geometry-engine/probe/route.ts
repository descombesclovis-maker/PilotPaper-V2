import { resolveAdvancedRoofTruth } from "@/lib/geometry/advanced-roof-truth";

export const dynamic = "force-dynamic";

function neutralWarnings(warnings: string[]) {
  return warnings.map((warning) => warning
    .replace(/OpenSolar/gi, "moteur géométrique avancé")
    .replace(/Raw Data API/gi, "API géométrique avancée"));
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { address?: string };
    const address = body.address?.trim() ?? "";
    if (address.length < 8) {
      return Response.json({ error: "Adresse de chantier invalide." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    const truth = await resolveAdvancedRoofTruth(address);
    return Response.json({
      available: truth.available,
      usable: truth.usable,
      projectId: truth.projectId,
      roofFacetCount: truth.roofFacetCount,
      autoDesignAvailable: truth.autoDesignAvailable,
      warnings: neutralWarnings(truth.warnings),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analyse géométrique impossible.";
    return Response.json({
      available: false,
      usable: false,
      error: neutralWarnings([message])[0],
    }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
