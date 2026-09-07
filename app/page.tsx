import { headers } from "next/headers";
import { WorkspaceClient } from "./workspace-client";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

export default async function Home() {
  const requestHeaders = await headers();
  const user = getRequestUser(requestHeaders);

  return (
    <WorkspaceClient
      currentUser={{
        email: user?.email ?? null,
        displayName: user?.displayName ?? "Utilisateur interne",
      }}
    />
  );
}
