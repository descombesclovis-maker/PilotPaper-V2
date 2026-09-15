import "server-only";

const OPENSOLAR_API_BASE = "https://api.opensolar.com/api";

type JsonObject = Record<string, unknown>;

export type OpenSolarRuntimeConfig = {
  enabled: boolean;
  configured: boolean;
  orgId: number | null;
};

function readOrgId() {
  const raw = process.env.OPENSOLAR_ORG_ID?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function getOpenSolarRuntimeConfig(): OpenSolarRuntimeConfig {
  const token = process.env.OPENSOLAR_BEARER_TOKEN?.trim();
  const orgId = readOrgId();
  const enabled = process.env.OPENSOLAR_ENABLED?.trim().toLowerCase() === "true";
  return { enabled, configured: Boolean(token && orgId), orgId };
}

function requireOpenSolarCredentials() {
  const token = process.env.OPENSOLAR_BEARER_TOKEN?.trim();
  const orgId = readOrgId();
  if (!token) throw new Error("Le moteur géométrique n'est pas connecté sur ce poste.");
  if (!orgId) throw new Error("L'organisation du moteur géométrique est absente ou invalide.");
  return { token, orgId };
}

async function parseError(response: Response) {
  const body = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(body) as JsonObject;
    const detail = parsed.detail ?? parsed.error ?? parsed.message;
    return typeof detail === "string" ? detail : body.slice(0, 500);
  } catch {
    return body.slice(0, 500);
  }
}

export async function openSolarRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { token } = requireOpenSolarCredentials();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const response = await fetch(`${OPENSOLAR_API_BASE}${normalizedPath}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const detail = await parseError(response);
    if (response.status === 401 || response.status === 403) throw new Error("Le moteur géométrique doit être reconnecté.");
    if (response.status === 402) throw new Error("L'accès aux données géométriques avancées n'est pas actif pour cette organisation.");
    if (response.status === 429) throw new Error("Le moteur géométrique est temporairement saturé. Réessayez dans quelques instants.");
    throw new Error(`Moteur géométrique indisponible (${response.status})${detail ? ` : ${detail}` : ""}`);
  }

  return response.json() as Promise<T>;
}

export async function getOpenSolarOrg() {
  const { orgId } = requireOpenSolarCredentials();
  return openSolarRequest<JsonObject>(`/orgs/${orgId}/`);
}

export async function getOpenSolarProject(projectId: number) {
  const { orgId } = requireOpenSolarCredentials();
  return openSolarRequest<JsonObject>(`/orgs/${orgId}/projects/${projectId}/`);
}

export async function getOpenSolarSystemDetails(projectId: number) {
  const { orgId } = requireOpenSolarCredentials();
  return openSolarRequest<{ systems?: JsonObject[] }>(`/orgs/${orgId}/projects/${projectId}/systems/details/?exclude_parts=pricing,incentives,payment_options,bills`);
}

export async function listOpenSolarProjects(limit = 100) {
  const { orgId } = requireOpenSolarCredentials();
  return openSolarRequest<JsonObject[]>(`/orgs/${orgId}/projects/?limit=${Math.max(1, Math.min(100, limit))}&fieldset=list`);
}

export async function createOpenSolarProject(input: {
  identifier: string;
  address: string;
  locality?: string;
  zip?: string;
  countryIso2?: string;
  lat?: number;
  lon?: number;
}) {
  const { orgId } = requireOpenSolarCredentials();
  return openSolarRequest<JsonObject>(`/orgs/${orgId}/projects/`, {
    method: "POST",
    body: JSON.stringify({
      identifier: input.identifier,
      title: input.address,
      is_residential: "1",
      address: input.address,
      locality: input.locality ?? "",
      zip: input.zip ?? "",
      country_iso2: input.countryIso2 ?? "FR",
      ...(Number.isFinite(input.lat) ? { lat: input.lat } : {}),
      ...(Number.isFinite(input.lon) ? { lon: input.lon } : {}),
    }),
  });
}
