import { env } from "cloudflare:workers";
import { buildDpPdf, type DpProjectRecord, type DpSourceFile } from "@/lib/dp-pdf";
import { requiredSourceKinds, validateGeneratedPdf, validateGenerationInputs } from "@/lib/generation-gate";
import { getRequestUser } from "@/lib/request-user";
import { runDPAI } from "@/lib/dp-ai-gate";
import { ensureProjectSchema } from "@/lib/ensure-project-schema";
import { OFFICIAL_CERFA_FILE, OFFICIAL_CERFA_SHA256 } from "@/lib/official-cerfa";

type ProjectRow = {
  id: string;
  requesterKind: "company" | "person";
  requesterName: string;
  requesterFirstName: string;
  requesterLastName: string;
  requesterAddress: string;
  requesterVat: string;
  requesterSiret: string;
  siteAddress: string;
  supportType: string;
  powerKwp: string;
  moduleCount: number | null;
  moduleReference: string;
  injectionMode: string;
  formData: string;
  validationData: string;
};

type FileRow = {
  kind: string;
  fileName: string;
  mimeType: string;
  sha256: string;
  objectKey: string;
};

function parseRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, String(item ?? "")]));
  } catch {
    return {};
  }
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = getRequestUser(request.headers);
  if (!user) return Response.json({ error: "Authentification requise." }, { status: 401 });
  await ensureProjectSchema();

  const { id } = await context.params;
  const project = await env.DB.prepare(
    `SELECT id,
      requester_kind AS requesterKind,
      requester_name AS requesterName,
      requester_first_name AS requesterFirstName,
      requester_last_name AS requesterLastName,
      requester_address AS requesterAddress,
      requester_vat AS requesterVat,
      requester_siret AS requesterSiret,
      site_address AS siteAddress,
      support_type AS supportType,
      power_kwp AS powerKwp,
      module_count AS moduleCount,
      module_reference AS moduleReference,
      injection_mode AS injectionMode,
      form_data AS formData,
      validation_data AS validationData
    FROM projects WHERE id = ? AND owner_email = ? LIMIT 1`,
  ).bind(id, user.email).first<ProjectRow>();
  if (!project) return Response.json({ error: "Dossier introuvable." }, { status: 404 });

  const fileResult = await env.DB.prepare(
    `SELECT kind, file_name AS fileName, mime_type AS mimeType,
      sha256, object_key AS objectKey
    FROM project_files
    WHERE project_id = ? AND owner_email = ?
    ORDER BY created_at DESC`,
  ).bind(id, user.email).all<FileRow>();

  const latest = new Map<string, FileRow>();
  for (const row of fileResult.results ?? []) {
    if (requiredSourceKinds.includes(row.kind as (typeof requiredSourceKinds)[number]) && !latest.has(row.kind)) latest.set(row.kind, row);
  }

  const sources: DpSourceFile[] = [];
  for (const row of latest.values()) {
    const object = await env.BUCKET.get(row.objectKey);
    if (!object) continue;
    sources.push({ kind: row.kind, fileName: row.fileName, mimeType: row.mimeType, sha256: row.sha256, bytes: new Uint8Array(await object.arrayBuffer()) });
  }

  const details = parseRecord(project.formData);
  const validation = parseRecord(project.validationData);
  const record: DpProjectRecord = {
    ...project,
    requesterEmail: user.email,
    requesterLegalFormCode: details.companyLegalFormCode ?? "",
    moduleCount: project.moduleCount ?? 0,
    details,
  };

  const preflightIssues = validateGenerationInputs(record, sources, validation.finalAttestation === "true");
  if (preflightIssues.length) {
    return Response.json({ error: "La génération est bloquée tant que les données obligatoires ne sont pas démontrées.", issues: preflightIssues }, { status: 422 });
  }

  // NEW ENGINE ONLY. No legacy local-ai/Ollama/Depth/Google-Solar pipeline participates here.
  let aiRun: Awaited<ReturnType<typeof runDPAI>>;
  try {
    aiRun = await runDPAI(record, sources);
  } catch (error) {
    return Response.json({
      error: "Le nouveau moteur DP a rejeté la génération avant export.",
      issues: [{ code: "DP_AI_REJECTED", field: "dpAi", message: error instanceof Error ? error.message : "Échec du moteur DP." }],
    }, { status: 422 });
  }

  const cerfaResponse = await fetch(new URL(OFFICIAL_CERFA_FILE, request.url), { cache: "no-store" });
  if (!cerfaResponse.ok) return Response.json({ error: "Le Cerfa officiel embarqué est indisponible. Aucun fichier n’a été créé." }, { status: 503 });
  const officialCerfaBytes = new Uint8Array(await cerfaResponse.arrayBuffer());
  const cerfaSha256 = hex(await crypto.subtle.digest("SHA-256", officialCerfaBytes));
  if (cerfaSha256 !== OFFICIAL_CERFA_SHA256) {
    return Response.json({ error: "La version du Cerfa ne correspond pas à la référence contrôlée. Export bloqué." }, { status: 422 });
  }

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await buildDpPdf(record, sources, aiRun.evidence, officialCerfaBytes, aiRun.renderedViews);
  } catch (error) {
    return Response.json({
      error: "Le dossier n’a pas pu être assemblé à partir des preuves du nouveau moteur.",
      issues: [{ code: "DP_ASSEMBLY_REJECTED", field: "dpPdf", message: error instanceof Error ? error.message : "Assemblage impossible." }],
    }, { status: 422 });
  }

  const postflightIssues = await validateGeneratedPdf(pdfBytes);
  if (postflightIssues.length) {
    return Response.json({ error: "Le contrôle structurel du PDF final a échoué. Aucun dossier n’a été enregistré.", issues: postflightIssues }, { status: 422 });
  }

  const generatedAt = new Date().toISOString();
  const fileId = crypto.randomUUID();
  const auditFileId = crypto.randomUUID();
  const fileName = `PilotPaper-DP-${id.slice(0, 8)}.pdf`;
  const auditFileName = `PilotPaper-audit-${id.slice(0, 8)}.json`;
  const objectKey = `projects/${id}/generated/${generatedAt.slice(0, 10)}/${fileId}.pdf`;
  const auditObjectKey = `projects/${id}/audits/${generatedAt.slice(0, 10)}/${auditFileId}.json`;
  const sha256 = hex(await crypto.subtle.digest("SHA-256", pdfBytes));
  const audit = {
    generatedAt,
    projectId: id,
    engine: "DP-AI-FIRST-v0.4.3",
    correctionPolicy: "UNIVERSAL_RULES_ONLY",
    correctionPolicyExplanation: "A failed test may only produce a general rule based on an error class; no address-, building-, photo- or dossier-specific exception is allowed.",
    evidence: aiRun.evidence,
    engineAudit: aiRun.audit,
    renderedViews: aiRun.renderedViews.map((item) => ({ kind: item.kind, sourceKind: item.sourceKind, sha256: item.sha256, metrics: item.metrics })),
    structuralPdfValidation: "passed",
  };
  const auditBytes = new TextEncoder().encode(JSON.stringify(audit, null, 2));
  const auditSha256 = hex(await crypto.subtle.digest("SHA-256", auditBytes));

  await Promise.all([
    env.BUCKET.put(objectKey, pdfBytes, {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { projectId: id, ownerEmail: user.email, sha256, status: "verified", engine: "DP-AI-FIRST-v0.4.3" },
    }),
    env.BUCKET.put(auditObjectKey, auditBytes, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { projectId: id, ownerEmail: user.email, sha256: auditSha256, status: "verified", engine: "DP-AI-FIRST-v0.4.3" },
    }),
  ]);

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO project_files (
          id, project_id, owner_email, kind, file_name, mime_type,
          size_bytes, sha256, object_key, status
        ) VALUES (?, ?, ?, 'generated_dossier', ?, 'application/pdf', ?, ?, ?, 'verified')`,
      ).bind(fileId, id, user.email, fileName, pdfBytes.byteLength, sha256, objectKey),
      env.DB.prepare(
        `INSERT INTO project_files (
          id, project_id, owner_email, kind, file_name, mime_type,
          size_bytes, sha256, object_key, status
        ) VALUES (?, ?, ?, 'ai_audit', ?, 'application/json', ?, ?, ?, 'verified')`,
      ).bind(auditFileId, id, user.email, auditFileName, auditBytes.byteLength, auditSha256, auditObjectKey),
      env.DB.prepare(`UPDATE projects SET status = 'generated', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_email = ?`).bind(id, user.email),
    ]);
  } catch (error) {
    await Promise.all([env.BUCKET.delete(objectKey), env.BUCKET.delete(auditObjectKey)]);
    throw error;
  }

  return new Response(new Blob([pdfBytes], { type: "application/pdf" }), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-PilotPaper-Validation": "passed",
      "X-PilotPaper-Engine": "DP-AI-FIRST-v0.4.3",
      "X-PilotPaper-SHA256": sha256,
    },
  });
}
