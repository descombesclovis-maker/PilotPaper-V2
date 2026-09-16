import { buildSiteTwin } from "./siteTwinBuilder";
import type { SiteTwin } from "./types";

const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { twin: SiteTwin; expiresAt: number }>();
const contextCache = new Map<string, { twin: SiteTwin; expiresAt: number }>();
const inflight = new Map<string, Promise<SiteTwin>>();

function keyForAddress(address: string) {
  return address.trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-FR");
}

function pruneExpiredContext(contextId: string) {
  const entry = contextCache.get(contextId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    contextCache.delete(contextId);
    return undefined;
  }
  return entry.twin;
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

/**
 * Bind one exact document context to the Site Twin that produced DP2.
 * Downstream DP3-DP6 must use this map instead of the address cache so two
 * simultaneous dossiers for the same property can never swap geometry.
 */
export function cacheSiteTwinForContext(contextId: string, twin: SiteTwin) {
  contextCache.set(contextId, { twin, expiresAt: Date.now() + TTL_MS });
  return twin;
}

export function getSiteTwinForContext(contextId: string) {
  return pruneExpiredContext(contextId);
}

export function invalidateSiteTwin(address: string) {
  cache.delete(keyForAddress(address));
}

export function cacheSiteTwinRevision(twin: SiteTwin) {
  cache.set(keyForAddress(twin.address), { twin, expiresAt: Date.now() + TTL_MS });
  return twin;
}
