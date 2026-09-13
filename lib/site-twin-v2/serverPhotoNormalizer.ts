import { SiteTwinError } from "./errors";

export type ServerPhotoInput = {
  role: "near" | "roof" | "far";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
  filename?: string;
};

export type ServerNormalizedPhoto = ServerPhotoInput & {
  mimeType: "image/jpeg";
  widthPx: number;
  heightPx: number;
  digest: string;
  sharpness: number;
  warning?: string | null;
};

function geometryEngineUrl() {
  return (process.env.PILOTPAPER_GEOMETRY_ENGINE_URL || "http://127.0.0.1:8765").replace(/\/$/, "");
}

function mimeExtension(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export async function normalizeServerPhoto(photo: ServerPhotoInput): Promise<ServerNormalizedPhoto> {
  const bytes = Buffer.from(photo.base64, "base64");
  if (!bytes.length) throw new SiteTwinError("PHOTO_NORMALIZATION_FAILED", `${photo.role} : photo vide.`);
  if (bytes.length > 24 * 1024 * 1024) {
    throw new SiteTwinError("PHOTO_NORMALIZATION_FAILED", `${photo.role} : photo supérieure à 24 Mo.`);
  }

  const data = new FormData();
  data.set(
    "photo",
    new Blob([bytes], { type: photo.mimeType }),
    photo.filename ?? `${photo.role}.${mimeExtension(photo.mimeType)}`,
  );
  const response = await fetch(`${geometryEngineUrl()}/v1/photo/normalize`, {
    method: "POST",
    body: data,
    signal: AbortSignal.timeout(45_000),
    cache: "no-store",
  }).catch((error) => {
    throw new SiteTwinError(
      "PHOTO_NORMALIZATION_FAILED",
      "Le normaliseur d'images PilotPaper n'a pas répondu.",
      { recoverable: true, cause: error },
    );
  });
  if (!response.ok) {
    throw new SiteTwinError(
      "PHOTO_NORMALIZATION_FAILED",
      `${photo.role} : normalisation refusée (${response.status}) : ${(await response.text()).slice(0, 300)}`,
      { recoverable: true },
    );
  }
  const normalized = await response.json() as {
    mimeType?: string;
    widthPx?: number;
    heightPx?: number;
    base64?: string;
    digest?: string;
    sharpness?: number;
    warning?: string | null;
  };
  if (
    normalized.mimeType !== "image/jpeg"
    || !normalized.base64
    || !normalized.digest
    || !Number.isFinite(normalized.widthPx)
    || !Number.isFinite(normalized.heightPx)
  ) {
    throw new SiteTwinError("PHOTO_NORMALIZATION_FAILED", `${photo.role} : réponse de normalisation invalide.`);
  }
  return {
    role: photo.role,
    mimeType: "image/jpeg",
    base64: normalized.base64,
    filename: `${photo.role}-${normalized.digest.slice(0, 12)}.jpg`,
    widthPx: Number(normalized.widthPx),
    heightPx: Number(normalized.heightPx),
    digest: normalized.digest,
    sharpness: Number(normalized.sharpness ?? 0),
    warning: normalized.warning,
  };
}

export async function normalizeServerPhotos(photos: ServerPhotoInput[] | undefined) {
  if (!photos?.length) return [];
  const seen = new Set<string>();
  const normalized: ServerNormalizedPhoto[] = [];
  for (const photo of photos) {
    const item = await normalizeServerPhoto(photo);
    if (seen.has(item.digest)) continue;
    seen.add(item.digest);
    normalized.push(item);
  }
  return normalized;
}
