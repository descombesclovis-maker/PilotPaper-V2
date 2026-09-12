export type NormalizedEvidencePhoto = {
  mimeType: "image/jpeg" | "image/png";
  widthPx: number;
  heightPx: number;
  base64: string;
  digest: string;
  originalFilename: string;
  originalMimeType: string;
};

const MAX_EDGE_PX = 4096;
const MAX_INPUT_BYTES = 24 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }
  return btoa(binary);
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function outputDimensions(width: number, height: number) {
  const edge = Math.max(width, height);
  if (edge <= MAX_EDGE_PX) return { width, height };
  const scale = MAX_EDGE_PX / edge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function canvasBlob(canvas: HTMLCanvasElement, mimeType: "image/jpeg" | "image/png") {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mimeType, mimeType === "image/jpeg" ? 0.94 : undefined);
  });
  if (!blob) throw new Error("PilotPaper n'a pas pu normaliser les pixels de la photo.");
  return blob;
}

/**
 * Decodes and re-encodes every user image before it enters vision or GPT Image.
 * This deliberately discards malformed EXIF/container metadata and guarantees
 * that base64 bytes really match the declared MIME type.
 */
export async function normalizeEvidencePhoto(file: File): Promise<NormalizedEvidencePhoto> {
  if (!(file instanceof File)) throw new Error("Fichier photo absent.");
  if (file.size <= 0) throw new Error("La photo est vide.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("Photo trop lourde : 24 Mo maximum.");

  const supportedInput = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!supportedInput.has(file.type)) {
    throw new Error("Format photo non pris en charge : utilisez JPEG, PNG ou WebP.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("La photo ne contient pas une image décodable malgré son extension.");
  }

  try {
    if (bitmap.width < 64 || bitmap.height < 64) throw new Error("La photo est trop petite pour une analyse fiable.");
    const dimensions = outputDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas indisponible pour normaliser la photo.");

    // White background avoids unexpected alpha being interpreted differently by
    // external image APIs. JPEG is our canonical DP evidence format.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const mimeType = "image/jpeg" as const;
    const normalized = await canvasBlob(canvas, mimeType);
    const bytes = new Uint8Array(await normalized.arrayBuffer());
    if (bytes.length < 1_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error("La normalisation JPEG n'a pas produit une image valide.");
    }

    const digest = hex(await crypto.subtle.digest("SHA-256", bytes));
    return {
      mimeType,
      widthPx: canvas.width,
      heightPx: canvas.height,
      base64: bytesToBase64(bytes),
      digest,
      originalFilename: file.name,
      originalMimeType: file.type,
    };
  } finally {
    bitmap.close();
  }
}
