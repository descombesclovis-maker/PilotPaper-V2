import { buildSiteTwin } from "./siteTwinBuilder";
import type { SiteTwin } from "./types";

const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { twin: SiteTwin; expiresAt: number }>();
const inflight = new Map<string, Promise<SiteTwin>>();

function keyForAddress(address: string) {
  return address.trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-FR");
}

export async function getOrBuildSiteTwin(address: string, options: { force?: boolean } = {}) {
  const key = keyForAddress(address);
  if (!options.force) {
    const existing = cache.get(key);
    if (existing && existing.expiresAt > Date.now()) return existing.twin;
    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const promise = buildSiteTwin(address)
    .then((twin) => {
      cache.set(key, { twin, expiresAt: Date.now() + TTL_MS });
      return twin;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

export function invalidateSiteTwin(address: string) {
  cache.delete(keyForAddress(address));
}

export function cacheSiteTwinRevision(twin: SiteTwin) {
  cache.set(keyForAddress(twin.address), { twin, expiresAt: Date.now() + TTL_MS });
  return twin;
}
