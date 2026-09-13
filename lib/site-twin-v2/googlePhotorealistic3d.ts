import { SiteTwinError } from "./errors";

function mapTilesApiKey() {
  return (process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_SOLAR_API_KEY || "").trim();
}

/**
 * Photorealistic 3D Tiles are deliberately VISUAL/QC evidence only.
 * PilotPaper must never derive cadastral identity or authoritative metric roof
 * geometry from this adapter. Metric geometry comes from DSM/LiDAR.
 */
export function googlePhotorealistic3dTilesReference() {
  const key = mapTilesApiKey();
  if (!key) {
    throw new SiteTwinError(
      "SOURCE_CONFLICT",
      "Google Photorealistic 3D Tiles : clé Google Maps absente.",
      { recoverable: true },
    );
  }
  return `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(key)}`;
}

export async function checkGooglePhotorealistic3dTiles() {
  try {
    const reference = googlePhotorealistic3dTilesReference();
    const response = await fetch(reference, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!response.ok) return { available: false as const, reference, reason: `HTTP ${response.status}` };
    const payload = await response.json() as { root?: unknown; asset?: unknown };
    if (!payload.root || !payload.asset) return { available: false as const, reference, reason: "tileset racine invalide" };
    return { available: true as const, reference };
  } catch (error) {
    return {
      available: false as const,
      reason: error instanceof Error ? error.message : "Google 3D Tiles indisponible",
    };
  }
}
