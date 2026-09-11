import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { WorkspaceClient } from "./workspace-client";
import { AdminDpImageLab } from "@/components/admin-dp-image-lab";
import { PilotPaperExperienceLayer } from "@/components/pilotpaper-experience-layer";
import { getRequestUser, isPilotPaperAdmin } from "@/lib/request-user";

export const dynamic = "force-dynamic";

export default async function Home() {
  const requestHeaders = await headers();
  const user = getRequestUser(requestHeaders);
  const workerEnv = env as unknown as Record<string, unknown>;
  const configuredAdmins = typeof workerEnv.PILOTPAPER_ADMIN_EMAILS === "string"
    ? workerEnv.PILOTPAPER_ADMIN_EMAILS
    : undefined;
  const isAdmin = isPilotPaperAdmin(user?.email, configuredAdmins);

  return (
    <>
      <WorkspaceClient
        currentUser={{
          email: user?.email ?? null,
          displayName: user?.displayName ?? "Utilisateur interne",
        }}
      />
      {isAdmin ? <AdminDpImageLab /> : null}
      <PilotPaperExperienceLayer />
    </>
  );
}
