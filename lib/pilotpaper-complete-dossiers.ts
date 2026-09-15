"use client";

import type { DPNumber, DpPieceOutput, PiecePhotoInput } from "@/lib/pilotpaper-image2-types";
import { persistDpPiece } from "@/lib/pilotpaper-image2-persistence";
import { referencesFromResults } from "@/lib/pilotpaper-dp-reference-order";

export type CompleteDossierStatus = "queued" | "generating" | "ready" | "error";
export type CompletePieceStatus = "idle" | "running" | "done" | "error";

export type CompleteDossierBranding = {
  companyName: string;
  logoDataUrl: string;
  primaryColor: string;
  accentColor: string;
  paperColor: string;
};

export type CompleteDossierProject = {
  address: string;
  moduleReference: string;
  panelCount: number;
  rows: number;
  columns: number;
  orientation: "portrait" | "landscape";
  placement: "centered" | "left" | "right" | "custom";
  panelGapMm: number;
  gutterClearanceMm: number;
  mountingSystem: string;
};

export type CompleteDossierPhotos = {
  near: PiecePhotoInput;
  far: PiecePhotoInput;
};

export type CompleteDossierPiece = {
  status: CompletePieceStatus;
  result?: DpPieceOutput;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
};

export type CompleteDossierRecord = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  status: CompleteDossierStatus;
  project: CompleteDossierProject;
  branding: CompleteDossierBranding;
  photos: CompleteDossierPhotos;
  pieces: Record<DPNumber, CompleteDossierPiece>;
  activeDps: DPNumber[];
  error?: string;
};

const DB_NAME = "pilotpaper-production-dossiers";
const DB_VERSION = 1;
const STORE = "dossiers";
const PIECES: DPNumber[] = [1, 2, 3, 4, 5, 6, 7, 8];
const listeners = new Map<string, Set<(record: CompleteDossierRecord) => void>>();
const memory = new Map<string, CompleteDossierRecord>();
const running = new Set<string>();
const mutationLocks = new Map<string, Promise<void>>();

function blankPieces(): Record<DPNumber, CompleteDossierPiece> {
  return Object.fromEntries(PIECES.map((dp) => [dp, { status: "idle" }])) as Record<DPNumber, CompleteDossierPiece>;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Base Mes dossiers indisponible."));
  });
}

async function writeRecord(record: CompleteDossierRecord) {
  memory.set(record.id, record);
  const database = await openDb();
  if (database) {
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).put(record);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Sauvegarde du dossier impossible."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Sauvegarde du dossier interrompue."));
      });
    } finally {
      database.close();
    }
  }
  for (const listener of listeners.get(record.id) ?? []) listener(record);
}

async function mutateRecord(id: string, mutation: (record: CompleteDossierRecord) => CompleteDossierRecord | void) {
  const previousLock = mutationLocks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const currentLock = new Promise<void>((resolve) => { release = resolve; });
  const chain = previousLock.then(() => currentLock);
  mutationLocks.set(id, chain);
  await previousLock;
  try {
    const current = memory.get(id) ?? await getCompleteDossier(id);
    if (!current) throw new Error("Dossier PilotPaper introuvable.");
    const draft = structuredClone(current);
    const changed = mutation(draft) ?? draft;
    changed.updatedAt = Date.now();
    await writeRecord(changed);
    return changed;
  } finally {
    release();
    if (mutationLocks.get(id) === chain) mutationLocks.delete(id);
  }
}

export async function getCompleteDossier(id: string): Promise<CompleteDossierRecord | null> {
  const cached = memory.get(id);
  if (cached) return cached;
  const database = await openDb();
  if (!database) return null;
  try {
    const record = await new Promise<CompleteDossierRecord | null>((resolve, reject) => {
      const request = database.transaction(STORE, "readonly").objectStore(STORE).get(id);
      request.onsuccess = () => resolve((request.result as CompleteDossierRecord | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Lecture du dossier impossible."));
    });
    if (record) memory.set(record.id, record);
    return record;
  } finally {
    database.close();
  }
}

export async function listCompleteDossiers(): Promise<CompleteDossierRecord[]> {
  const database = await openDb();
  if (!database) return [...memory.values()].sort((a, b) => b.createdAt - a.createdAt);
  try {
    const records = await new Promise<CompleteDossierRecord[]>((resolve, reject) => {
      const request = database.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as CompleteDossierRecord[]);
      request.onerror = () => reject(request.error ?? new Error("Lecture de Mes dossiers impossible."));
    });
    for (const record of records) memory.set(record.id, record);
    return records.sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    database.close();
  }
}

export async function deleteCompleteDossier(id: string) {
  running.delete(id);
  memory.delete(id);
  listeners.delete(id);
  const database = await openDb();
  if (!database) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Suppression du dossier impossible."));
    });
  } finally {
    database.close();
  }
}

export function subscribeCompleteDossier(id: string, listener: (record: CompleteDossierRecord) => void) {
  const bucket = listeners.get(id) ?? new Set<(record: CompleteDossierRecord) => void>();
  bucket.add(listener);
  listeners.set(id, bucket);
  return () => {
    bucket.delete(listener);
    if (!bucket.size) listeners.delete(id);
  };
}

function projectPhotos(record: CompleteDossierRecord): PiecePhotoInput[] {
  const near = record.photos.near;
  return [
    near,
    { ...near, role: "roof", filename: `toiture-${near.filename ?? "vue-proche.jpg"}` },
    record.photos.far,
  ];
}

function completedResults(record: CompleteDossierRecord): Partial<Record<DPNumber, DpPieceOutput>> {
  const output: Partial<Record<DPNumber, DpPieceOutput>> = {};
  for (const dp of PIECES) {
    const result = record.pieces[dp].result;
    if (result) output[dp] = result;
  }
  return output;
}

async function runPiece(id: string, dp: DPNumber) {
  const before = await getCompleteDossier(id);
  if (!before) throw new Error("Dossier introuvable.");
  if (before.pieces[dp].status === "done" && before.pieces[dp].result) return before.pieces[dp].result;

  const references = referencesFromResults(dp, completedResults(before));

  await mutateRecord(id, (record) => {
    record.status = "generating";
    record.error = undefined;
    record.pieces[dp] = { status: "running", startedAt: Date.now() };
    record.activeDps = [dp];
  });

  const current = await getCompleteDossier(id);
  if (!current) throw new Error("Dossier introuvable.");
  const response = await fetch("/api/dp-piece", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dp,
      address: current.project.address,
      moduleReference: current.project.moduleReference,
      panelCount: current.project.panelCount,
      rows: current.project.rows,
      columns: current.project.columns,
      orientation: current.project.orientation,
      placement: current.project.placement,
      gutterClearanceMm: current.project.gutterClearanceMm,
      interPanelGapMm: current.project.panelGapMm,
      mountingSystem: current.project.mountingSystem,
      photos: projectPhotos(current),
      references,
      testMode: true,
    }),
  });
  const body = await response.json().catch(() => null) as DpPieceOutput | { error?: string } | null;
  if (!response.ok || !body || !("dp" in body)) {
    const message = (body as { error?: string } | null)?.error || `DP${dp} : génération interrompue.`;
    await mutateRecord(id, (record) => {
      record.pieces[dp] = { status: "error", error: message, finishedAt: Date.now() };
      record.activeDps = [];
      record.error = message;
    });
    throw new Error(message);
  }

  await persistDpPiece(body).catch(() => undefined);
  await mutateRecord(id, (record) => {
    record.pieces[dp] = { status: "done", result: body, finishedAt: Date.now() };
    record.activeDps = [];
    if (!body.inspector.passed) {
      record.error = `DP${dp} produite en mode diagnostic : résultat à corriger, conservé pour analyse.`;
    }
  });
  return body;
}

async function runJob(id: string) {
  if (running.has(id)) return;
  running.add(id);
  try {
    await mutateRecord(id, (record) => {
      record.status = "generating";
      record.error = undefined;
      record.activeDps = [];
    });

    // EXACTEMENT le même chemin logique que K-par-k : DP1 → DP2 → ... → DP8.
    // Les références sont calculées par la même source de vérité partagée.
    for (const dp of PIECES) {
      try {
        await runPiece(id, dp);
      } catch {
        // En mode test, on poursuit vers la pièce suivante quand c'est techniquement possible.
        // Une pièce sans résultat ne sera simplement pas disponible comme référence.
      }
    }

    const finished = await getCompleteDossier(id);
    if (!finished) return;
    const completedCount = PIECES.filter((dp) => finished.pieces[dp].status === "done" && finished.pieces[dp].result).length;
    const allProduced = completedCount === PIECES.length;
    await mutateRecord(id, (record) => {
      record.activeDps = [];
      record.status = allProduced ? "ready" : "error";
      if (allProduced) {
        const rejected = PIECES.filter((dp) => record.pieces[dp].result && !record.pieces[dp].result!.inspector.passed);
        record.error = rejected.length
          ? `Dossier test produit avec ${rejected.length} pièce${rejected.length > 1 ? "s" : ""} à corriger : ${rejected.map((dp) => `DP${dp}`).join(", ")}.`
          : undefined;
      } else {
        record.error = `Dossier test incomplet : ${completedCount}/8 pièces produites. Les sorties disponibles sont conservées pour diagnostic.`;
      }
    });
  } finally {
    running.delete(id);
  }
}

function dossierName(project: CompleteDossierProject) {
  const address = project.address.split(",")[0]?.trim() || project.address.trim();
  return address ? `DP photovoltaïque — ${address}` : "Déclaration préalable photovoltaïque";
}

export async function createCompleteDossier(input: {
  project: CompleteDossierProject;
  branding: CompleteDossierBranding;
  photos: CompleteDossierPhotos;
}) {
  const id = `dp-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();
  const record: CompleteDossierRecord = {
    id,
    name: dossierName(input.project),
    createdAt: now,
    updatedAt: now,
    status: "queued",
    project: input.project,
    branding: input.branding,
    photos: input.photos,
    pieces: blankPieces(),
    activeDps: [],
  };
  await writeRecord(record);
  void runJob(id);
  return record;
}

export async function ensureCompleteDossierRunning(id: string) {
  const record = await getCompleteDossier(id);
  if (!record) return null;
  if (record.status === "queued" || record.status === "generating") void runJob(id);
  return record;
}

export async function retryCompleteDossier(id: string) {
  const record = await mutateRecord(id, (draft) => {
    draft.status = "queued";
    draft.error = undefined;
    draft.activeDps = [];
    for (const dp of PIECES) {
      if (draft.pieces[dp].status === "error" || draft.pieces[dp].status === "running") draft.pieces[dp] = { status: "idle" };
    }
  });
  void runJob(id);
  return record;
}
