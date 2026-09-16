import type { DPNumber, DpPieceOutput } from "@/lib/pilotpaper-image2-types";

const DB_NAME = "pilotpaper-image2";
// V2 deliberately invalidates the old generated-piece cache: prior builds were
// allowed to persist diagnostic/raw-photo candidates that must never reappear.
const DB_VERSION = 2;
const STORE_NAME = "generated-dp-pieces";

function isPersistablePiece(value: unknown): value is DpPieceOutput {
  if (!value || typeof value !== "object") return false;
  const piece = value as Partial<DpPieceOutput>;
  if (!Number.isInteger(piece.dp) || Number(piece.dp) < 1 || Number(piece.dp) > 8) return false;
  if (piece.validationStatus !== "test_unverified") return false;
  if (!piece.mimeType || !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(piece.mimeType)) return false;
  if (!piece.base64 || piece.base64.length < 500) return false;
  if (piece.inspector?.passed !== true) return false;
  if (!Array.isArray(piece.sourceSummary)) return false;
  if (piece.sourceSummary.some((line) => /MODE DIAGNOSTIC|diagnostic fallback|photo source brute/i.test(line))) return false;
  if (Number(piece.dp) >= 2 && Number(piece.dp) <= 6 && !piece.geometryReceipt) return false;
  return true;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (database.objectStoreNames.contains(STORE_NAME)) {
        database.deleteObjectStore(STORE_NAME);
      }
      database.createObjectStore(STORE_NAME, { keyPath: "dp" });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB indisponible."));
  });
}

export async function loadPersistedDpPieces(): Promise<Partial<Record<DPNumber, DpPieceOutput>>> {
  const database = await openDatabase();
  if (!database) return {};

  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => {
        const result: Partial<Record<DPNumber, DpPieceOutput>> = {};
        for (const candidate of request.result as unknown[]) {
          if (!isPersistablePiece(candidate)) continue;
          result[candidate.dp] = candidate;
        }
        resolve(result);
      };
      request.onerror = () => reject(request.error ?? new Error("Lecture des DP sauvegardées impossible."));
    });
  } finally {
    database.close();
  }
}

export async function persistDpPiece(piece: DpPieceOutput): Promise<void> {
  if (!isPersistablePiece(piece)) {
    throw new Error(`DP${piece.dp} refusée : une pièce non validée ne peut pas être sauvegardée localement.`);
  }
  const database = await openDatabase();
  if (!database) return;

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(piece);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Sauvegarde de la DP impossible."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Sauvegarde de la DP interrompue."));
    });
  } finally {
    database.close();
  }
}

export async function deletePersistedDpPiece(dp: DPNumber): Promise<void> {
  const database = await openDatabase();
  if (!database) return;

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(dp);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Suppression de la DP impossible."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Suppression de la DP interrompue."));
    });
  } finally {
    database.close();
  }
}
