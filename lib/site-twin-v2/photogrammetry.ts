import type { SiteTwinPropertyLock } from "./propertyLock";
import { SiteTwinError } from "./errors";

export type PhotogrammetryPhoto = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
  filename?: string;
};

export type PhotogrammetryCandidate = {
  status: "metric_candidate" | "candidate_requires_metric_anchor";
  metricAnchored: boolean;
  pycolmapAvailable: boolean;
  diagnostics: Record<string, unknown>;
  pairErrors: string[];
  pointFormat: "float32_xyz";
  pointCount: number;
  pointsBase64: string;
  restriction: string;
};

function geometryEngineUrl() {
  return (process.env.PILOTPAPER_GEOMETRY_ENGINE_URL || "http://127.0.0.1:8765").replace(/\/$/, "");
}

export async function buildPhotogrammetryCandidate(args: {
  property: SiteTwinPropertyLock;
  photos: PhotogrammetryPhoto[];
  metricAnchor?: { confirmed: true; scaleMetersPerUnit: number };
}): Promise<PhotogrammetryCandidate> {
  if (args.photos.length < 3) {
    throw new SiteTwinError(
      "GEOMETRY_RECONSTRUCTION_FAILED",
      "Photogrammétrie : au moins trois vues différentes de la même maison sont requises.",
      { recoverable: true },
    );
  }
  const data = new FormData();
  data.set("property", JSON.stringify(args.property));
  if (args.metricAnchor) data.set("metric_anchor", JSON.stringify(args.metricAnchor));
  for (let index = 0; index < Math.min(args.photos.length, 8); index += 1) {
    const photo = args.photos[index]!;
    data.append(
      "photos",
      new Blob([Buffer.from(photo.base64, "base64")], { type: photo.mimeType }),
      photo.filename ?? `photogrammetry-${index + 1}.jpg`,
    );
  }
  const response = await fetch(`${geometryEngineUrl()}/v1/photogrammetry/reconstruct`, {
    method: "POST",
    body: data,
    signal: AbortSignal.timeout(180_000),
    cache: "no-store",
  }).catch((error) => {
    throw new SiteTwinError(
      "GEOMETRY_RECONSTRUCTION_FAILED",
      "Le moteur photogrammétrique n'a pas répondu.",
      { recoverable: true, cause: error },
    );
  });
  if (!response.ok) {
    throw new SiteTwinError(
      "GEOMETRY_RECONSTRUCTION_FAILED",
      `Photogrammétrie refusée (${response.status}) : ${(await response.text()).slice(0, 500)}`,
      { recoverable: true },
    );
  }
  const candidate = await response.json() as PhotogrammetryCandidate;
  if (!candidate.metricAnchored && args.metricAnchor?.confirmed) {
    throw new SiteTwinError(
      "GEOMETRY_RECONSTRUCTION_FAILED",
      "L'ancrage métrique photogrammétrique n'a pas été reconnu.",
      { recoverable: true },
    );
  }
  return candidate;
}
