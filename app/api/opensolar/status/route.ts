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
      message: "Le moteur géométrique avancé n'est pas connecté sur ce poste.",
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
        ? "Le moteur géométrique avancé est connecté et actif."
        : "Le moteur géométrique avancé est connecté mais reste en observation.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({
      enabled: config.enabled,
      configured: true,
      connected: false,
      orgId: config.orgId,
      message: error instanceof Error ? error.message : "Connexion au moteur géométrique impossible.",
    }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
