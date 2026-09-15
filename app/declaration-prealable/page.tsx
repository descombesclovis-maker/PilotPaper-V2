import { headers } from "next/headers";
import { PilotPaperProductionShell } from "@/components/production/pilotpaper-production-shell";
import { PilotPaperUpdateButton } from "@/components/pilotpaper-update-button";
import { getRequestUser } from "@/lib/request-user";
import { WorkspaceClient } from "../workspace-client";

export const dynamic = "force-dynamic";

export default async function DeclarationPrealablePage() {
  const requestHeaders = await headers();
  const user = getRequestUser(requestHeaders);

  return (
    <PilotPaperProductionShell fullDp>
      <div className="production-dp-wrapper">
        <WorkspaceClient
          currentUser={{
            email: user?.email ?? null,
            displayName: user?.displayName ?? "Utilisateur local",
          }}
        />
      </div>
      <PilotPaperUpdateButton />
    </PilotPaperProductionShell>
  );
}
