export type RequestUser = {
  email: string;
  displayName: string;
};

export function getRequestUser(headers: Headers): RequestUser | null {
  const email = headers.get("oai-authenticated-user-email")?.trim();
  if (!email && process.env.NODE_ENV !== "production") {
    return {
      email: process.env.PILOTPAPER_DEV_EMAIL ?? "local@pilotpaper.test",
      displayName: process.env.PILOTPAPER_DEV_NAME ?? "Utilisateur local",
    };
  }
  if (!email) return null;

  const encodedName = headers.get("oai-authenticated-user-full-name");
  const displayName =
    encodedName &&
    headers.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedName)
      : email;

  return { email, displayName };
}

export function isPilotPaperAdmin(
  email: string | null | undefined,
  configuredAdminEmails?: string | null,
) {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;

  if (process.env.NODE_ENV !== "production") {
    const localEmail = (process.env.PILOTPAPER_DEV_EMAIL ?? "local@pilotpaper.test")
      .trim()
      .toLowerCase();
    if (normalized === localEmail) return true;
  }

  const configured =
    configuredAdminEmails ?? process.env.PILOTPAPER_ADMIN_EMAILS ?? "";
  return configured
    .split(/[;,\n]/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}
