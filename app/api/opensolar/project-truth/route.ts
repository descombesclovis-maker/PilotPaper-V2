import { getOpenSolarProject, getOpenSolarRuntimeConfig, getOpenSolarSystemDetails } from "@/lib/opensolar/client";
import { extractOpenSolarProjectTruth } from "@/lib/opensolar/design-truth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = Number(url.searchParams.get("projectId"));
  if (!Number.isInteger(projectId) || projectId < 1) {
    return Response.json({ error: "Identifiant de projet géométrique invalide." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const config = getOpenSolarRuntimeConfig();
  if (!config.configured) {
    return Response.json({ error: "Le moteur géométrique avancé n'est pas connecté sur ce poste." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const [project, systemDetails] = await Promise.all([
      getOpenSolarProject(projectId),
      getOpenSolarSystemDetails(projectId),
    ]);
    const truth = extractOpenSolarProjectTruth({ projectId, project, systemDetails });
    return Response.json({
      source: "geometry-engine-raw-data",
      enabledForProduction: config.enabled,
      truth,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Lecture géométrique impossible.",
    }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
