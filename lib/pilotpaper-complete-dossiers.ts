"use client";

import type { DPNumber, DpPieceOutput, PiecePhotoInput, VisualReference } from "@/lib/pilotpaper-image2-types";
import { persistDpPiece } from "@/lib/pilotpaper-image2-persistence";

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

function makeReference(output: DpPieceOutput): VisualReference | null {
  if (!output.base64 || !["image/png", "image/jpeg", "image/webp"].includes(output.mimeType)) return null;
  if (![2, 3, 4, 5].includes(output.dp)) return null;
  return { dp: output.dp as 2 | 3 | 4 | 5, mimeType: output.mimeType as VisualReference["mimeType"], base64: output.base64 };
}

function projectPhotos(record: CompleteDossierRecord): PiecePhotoInput[] {
  const near = record.photos.near;
  return [
    near,
    { ...near, role: "roof", filename: `toiture-${near.filename ?? "vue-proche.jpg"}` },
    record.photos.far,
  ];
}

async function runPiece(id: string, dp: DPNumber, references: VisualReference[]) {
  const before = await getCompleteDossier(id);
  if (!before) throw new Error("Dossier introuvable.");
  if (before.pieces[dp].status === "done" && before.pieces[dp].result) return before.pieces[dp].result;

  await mutateRecord(id, (record) => {
    record.status = "generating";
    record.error = undefined;
    record.pieces[dp] = { status: "running", startedAt: Date.now() };
    record.activeDps = [...new Set([...record.activeDps, dp])].sort((a, b) => a - b) as DPNumber[];
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
    }),
  });
  const body = await response.json().catch(() => null) as DpPieceOutput | { error?: string } | null;
  if (!response.ok || !body || !("dp" in body)) {
    const message = (body as { error?: string } | null)?.error || `DP${dp} : génération interrompue.`;
    await mutateRecord(id, (record) => {
      record.pieces[dp] = { status: "error", error: message, finishedAt: Date.now() };
      record.activeDps = record.activeDps.filter((value) => value !== dp);
      record.error = message;
    });
    throw new Error(message);
  }

  await persistDpPiece(body).catch(() => undefined);
  await mutateRecord(id, (record) => {
    record.pieces[dp] = { status: "done", result: body, finishedAt: Date.now() };
    record.activeDps = record.activeDps.filter((value) => value !== dp);
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
    });

    // Independent pieces start immediately while DP2 establishes the master physical placement.
    const dp1Promise = runPiece(id, 1, []).catch(() => undefined);
    const dp7Promise = runPiece(id, 7, []).catch(() => undefined);
    const dp8Promise = runPiece(id, 8, []).catch(() => undefined);
    const dp2Result = await runPiece(id, 2, []).catch(() => undefined);
    const dp2Reference = dp2Result ? makeReference(dp2Result) : null;

    if (dp2Reference) {
      // Wave 1: DP3 and DP4 can be generated together because both depend only on the accepted DP2 anchor.
      const dp3Promise = runPiece(id, 3, [dp2Reference]).catch(() => undefined);
      const dp4Promise = runPiece(id, 4, [dp2Reference]).catch(() => undefined);
      const [, dp4Result] = await Promise.all([dp3Promise, dp4Promise]);
      const dp4Reference = dp4Result ? makeReference(dp4Result) : null;
      const closeReferences = [dp2Reference, dp4Reference].filter((reference): reference is VisualReference => Boolean(reference));

      // Wave 2: DP5 and DP6 run together, both inheriting DP2 and the accepted DP4 photographic identity when available.
      await Promise.all([
        runPiece(id, 5, closeReferences).catch(() => undefined),
        runPiece(id, 6, closeReferences).catch(() => undefined),
      ]);
    } else {
      await mutateRecord(id, (record) => {
        for (const dp of [3, 4, 5, 6] as DPNumber[]) {
          if (record.pieces[dp].status === "done") continue;
          record.pieces[dp] = { status: "error", error: "La DP2 doit être produite avant cette pièce.", finishedAt: Date.now() };
        }
      });
    }

    await Promise.allSettled([dp1Promise, dp7Promise, dp8Promise]);
    const finished = await getCompleteDossier(id);
    if (!finished) return;
    const ready = PIECES.every((dp) => finished.pieces[dp].status === "done" && finished.pieces[dp].result);
    await mutateRecord(id, (record) => {
      record.activeDps = [];
      record.status = ready ? "ready" : "error";
      if (ready) record.error = undefined;
      else record.error = record.error || "Une ou plusieurs pièces doivent être régénérées.";
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
