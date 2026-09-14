import type { DPNumber, DpPieceOutput } from "@/lib/pilotpaper-image2-types";

const DB_NAME = "pilotpaper-image2";
const DB_VERSION = 1;
const STORE_NAME = "generated-dp-pieces";

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "dp" });
      }
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
        for (const piece of request.result as DpPieceOutput[]) {
          result[piece.dp] = piece;
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
