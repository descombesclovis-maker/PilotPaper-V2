import { getOpenSolarOrg, getOpenSolarRuntimeConfig } from "@/lib/opensolar/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getOpenSolarRuntimeConfig();
  if (!config.configured) {
    return Response.json({
      enabled: config.enabled,
      configured: false,
      connected: false,
      orgId: config.orgId,
      message: "OpenSolar n'est pas encore configuré sur ce poste.",
    }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const org = await getOpenSolarOrg();
    return Response.json({
      enabled: config.enabled,
      configured: true,
      connected: true,
      orgId: config.orgId,
      orgName: typeof org.name === "string" ? org.name : "",
      message: config.enabled
        ? "OpenSolar est connecté et activé pour PilotPaper V2."
        : "OpenSolar est connecté mais reste en mode POC/fallback tant que OPENSOLAR_ENABLED n'est pas activé.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({
      enabled: config.enabled,
      configured: true,
      connected: false,
      orgId: config.orgId,
      message: error instanceof Error ? error.message : "Connexion OpenSolar impossible.",
    }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
