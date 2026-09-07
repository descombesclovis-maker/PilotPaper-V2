import { env } from "cloudflare:workers";
import { getRequestUser } from "@/lib/request-user";
import { ensureProjectSchema } from "@/lib/ensure-project-schema";

const allowedKinds = new Set([
  "near",
  "far",
  "context",
  "roof",
]);
const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);
const maxFileSize = 20 * 1024 * 1024;

function safeFileName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function ownsProject(projectId: string, email: string) {
  return env.DB.prepare(
    "SELECT id FROM projects WHERE id = ? AND owner_email = ? LIMIT 1",
  )
    .bind(projectId, email)
    .first<{ id: string }>();
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = getRequestUser(request.headers);
  if (!user) {
    return Response.json({ error: "Authentification requise." }, { status: 401 });
  }
  await ensureProjectSchema();

  const { id: projectId } = await context.params;
  if (!(await ownsProject(projectId, user.email))) {
    return Response.json({ error: "Dossier introuvable." }, { status: 404 });
  }

  const result = await env.DB.prepare(
    `SELECT id, kind, file_name AS fileName, mime_type AS mimeType,
      size_bytes AS sizeBytes, sha256, status, created_at AS createdAt
    FROM project_files
    WHERE project_id = ? AND owner_email = ?
    ORDER BY created_at DESC`,
  )
    .bind(projectId, user.email)
    .all();

  return Response.json({ files: result.results ?? [] });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = getRequestUser(request.headers);
  if (!user) {
    return Response.json({ error: "Authentification requise." }, { status: 401 });
  }
  await ensureProjectSchema();

  const { id: projectId } = await context.params;
  if (!(await ownsProject(projectId, user.email))) {
    return Response.json({ error: "Dossier introuvable." }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const kind = String(formData.get("kind") ?? "");

  if (!(file instanceof File) || !allowedKinds.has(kind)) {
    return Response.json(
      { error: "Fichier ou type de pièce invalide." },
      { status: 400 },
    );
  }
  if (!allowedMimeTypes.has(file.type)) {
    return Response.json(
      { error: "Format refusé. Utilisez PDF, JPEG ou PNG." },
      { status: 415 },
    );
  }
  if (["near", "far"].includes(kind) && !["image/jpeg", "image/png"].includes(file.type)) {
    return Response.json(
      { error: "Les deux photographies doivent être au format JPEG ou PNG." },
      { status: 415 },
    );
  }
  if (file.size <= 0 || file.size > maxFileSize) {
    return Response.json(
      { error: "Le fichier doit peser moins de 20 Mo." },
      { status: 413 },
    );
  }

  const bytes = await file.arrayBuffer();
  const sha256 = toHex(await crypto.subtle.digest("SHA-256", bytes));
  const fileId = crypto.randomUUID();
  const objectKey = `projects/${projectId}/sources/${kind}/${fileId}-${safeFileName(file.name)}`;

  await env.BUCKET.put(objectKey, bytes, {
    httpMetadata: { contentType: file.type },
    customMetadata: {
      projectId,
      ownerEmail: user.email,
      kind,
      sha256,
      originalFileName: file.name,
    },
  });

  try {
    const row = await env.DB.prepare(
      `INSERT INTO project_files (
        id, project_id, owner_email, kind, file_name, mime_type,
        size_bytes, sha256, object_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id, kind, file_name AS fileName, mime_type AS mimeType,
        size_bytes AS sizeBytes, sha256, status, created_at AS createdAt`,
    )
      .bind(
        fileId,
        projectId,
        user.email,
        kind,
        file.name,
        file.type,
        file.size,
        sha256,
        objectKey,
      )
      .first();

    return Response.json({ file: row }, { status: 201 });
  } catch (error) {
    await env.BUCKET.delete(objectKey);
    throw error;
  }
}
