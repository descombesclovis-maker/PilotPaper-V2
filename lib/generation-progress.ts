import { env } from "cloudflare:workers";
import { ensureProjectSchema } from "@/lib/ensure-project-schema";
import type { DPNumber } from "@/lib/dp-ai-engine/types";

export type GenerationPieceStatus = "waiting" | "running" | "done" | "failed";
export type GenerationJobStatus = "queued" | "running" | "done" | "failed";

export type GenerationPieceProgress = {
  dp: DPNumber;
  status: GenerationPieceStatus;
  message: string;
  updatedAt: string | null;
};

export type GenerationJobProgress = {
  id: string;
  projectId: string;
  status: GenerationJobStatus;
  currentStage: string;
  progress: number;
  pieces: GenerationPieceProgress[];
  error: string;
  createdAt: string;
  updatedAt: string;
};

type GenerationJobRow = {
  id: string;
  projectId: string;
  status: string;
  currentStage: string;
  progress: number;
  piecesJson: string;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
};

function now() {
  return new Date().toISOString();
}

function initialPieces(): GenerationPieceProgress[] {
  return Array.from({ length: 8 }, (_, index) => ({
    dp: (index + 1) as DPNumber,
    status: "waiting" as const,
    message: "En attente",
    updatedAt: null,
  }));
}

function parsePieces(value: string): GenerationPieceProgress[] {
  try {
    const parsed = JSON.parse(value) as GenerationPieceProgress[];
    if (Array.isArray(parsed) && parsed.length === 8) return parsed;
  } catch {
    // Fall through to a safe complete set.
  }
  return initialPieces();
}

function progressFromPieces(pieces: GenerationPieceProgress[], stageProgress = 0) {
  const completed = pieces.filter((piece) => piece.status === "done").length;
  const running = pieces.some((piece) => piece.status === "running") ? 0.45 : 0;
  const pieceProgress = ((completed + running) / 8) * 88;
  return Math.max(0, Math.min(99, Math.round(Math.max(pieceProgress, stageProgress))));
}

export async function createGenerationJob(args: { id: string; projectId: string; ownerEmail: string }) {
  await ensureProjectSchema();
  const timestamp = now();
  await env.DB.prepare(
    `INSERT INTO generation_jobs (
      id, project_id, owner_email, status, current_stage, progress,
      pieces_json, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, 'queued', 'Préparation du dossier', 0, ?, '', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      owner_email = excluded.owner_email,
      status = 'queued',
      current_stage = 'Préparation du dossier',
      progress = 0,
      pieces_json = excluded.pieces_json,
      error_message = '',
      updated_at = excluded.updated_at`,
  ).bind(args.id, args.projectId, args.ownerEmail, JSON.stringify(initialPieces()), timestamp, timestamp).run();
}

export async function updateGenerationStage(args: {
  id: string;
  ownerEmail: string;
  stage: string;
  status?: GenerationJobStatus;
  progress?: number;
  error?: string;
}) {
  await ensureProjectSchema();
  const boundedProgress = args.progress == null ? null : Math.max(0, Math.min(100, Math.round(args.progress)));
  await env.DB.prepare(
    `UPDATE generation_jobs SET
      current_stage = ?,
      status = COALESCE(?, status),
      progress = COALESCE(?, progress),
      error_message = COALESCE(?, error_message),
      updated_at = ?
    WHERE id = ? AND owner_email = ?`,
  ).bind(
    args.stage,
    args.status ?? null,
    boundedProgress,
    args.error ?? null,
    now(),
    args.id,
    args.ownerEmail,
  ).run();
}

export async function updateGenerationPiece(args: {
  id: string;
  ownerEmail: string;
  dp: DPNumber;
  status: GenerationPieceStatus;
  message: string;
}) {
  await ensureProjectSchema();
  const row = await env.DB.prepare(
    `SELECT pieces_json AS piecesJson, progress
    FROM generation_jobs WHERE id = ? AND owner_email = ? LIMIT 1`,
  ).bind(args.id, args.ownerEmail).first<{ piecesJson: string; progress: number }>();
  if (!row) return;

  const pieces = parsePieces(row.piecesJson);
  const timestamp = now();
  const next = pieces.map((piece) => piece.dp === args.dp
    ? { ...piece, status: args.status, message: args.message, updatedAt: timestamp }
    : piece);
  const progress = progressFromPieces(next, Number(row.progress) || 0);
  await env.DB.prepare(
    `UPDATE generation_jobs SET
      status = CASE WHEN status = 'queued' THEN 'running' ELSE status END,
      current_stage = ?, progress = ?, pieces_json = ?, updated_at = ?
    WHERE id = ? AND owner_email = ?`,
  ).bind(`DP${args.dp} · ${args.message}`, progress, JSON.stringify(next), timestamp, args.id, args.ownerEmail).run();
}

export async function readGenerationJob(args: { id: string; projectId: string; ownerEmail: string }): Promise<GenerationJobProgress | null> {
  await ensureProjectSchema();
  const row = await env.DB.prepare(
    `SELECT id, project_id AS projectId, status, current_stage AS currentStage,
      progress, pieces_json AS piecesJson, error_message AS errorMessage,
      created_at AS createdAt, updated_at AS updatedAt
    FROM generation_jobs
    WHERE id = ? AND project_id = ? AND owner_email = ? LIMIT 1`,
  ).bind(args.id, args.projectId, args.ownerEmail).first<GenerationJobRow>();
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status as GenerationJobStatus,
    currentStage: row.currentStage,
    progress: Number(row.progress) || 0,
    pieces: parsePieces(row.piecesJson),
    error: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
