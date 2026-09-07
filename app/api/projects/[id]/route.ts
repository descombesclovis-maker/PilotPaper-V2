import { env } from "cloudflare:workers";
import { getRequestUser } from "@/lib/request-user";
import { ensureProjectSchema } from "@/lib/ensure-project-schema";

type UpdatePayload = {
  currentStep?: number;
  siteAddress?: string;
  supportType?: string;
  powerKwp?: string;
  moduleCount?: string | number;
  moduleReference?: string;
  injectionMode?: string;
  formData?: unknown;
  validationData?: unknown;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = getRequestUser(request.headers);
  if (!user) {
    return Response.json({ error: "Authentification requise." }, { status: 401 });
  }
  await ensureProjectSchema();

  const { id } = await context.params;
  const payload = (await request.json()) as UpdatePayload;
  const currentStep = Math.min(5, Math.max(1, Number(payload.currentStep) || 1));
  const parsedModuleCount = Number(payload.moduleCount);
  const moduleCount = Number.isFinite(parsedModuleCount) && parsedModuleCount > 0
    ? Math.round(parsedModuleCount)
    : null;

  const row = await env.DB.prepare(
    `UPDATE projects SET
      current_step = ?, site_address = ?, support_type = ?, power_kwp = ?,
      module_count = ?, module_reference = ?, injection_mode = ?,
      form_data = ?, validation_data = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND owner_email = ?
    RETURNING id, status, current_step AS currentStep, updated_at AS updatedAt`,
  )
    .bind(
      currentStep,
      payload.siteAddress?.trim() ?? "",
      payload.supportType?.trim() ?? "",
      payload.powerKwp?.trim() ?? "",
      moduleCount,
      payload.moduleReference?.trim() ?? "",
      payload.injectionMode?.trim() ?? "",
      JSON.stringify(payload.formData ?? {}),
      JSON.stringify(payload.validationData ?? {}),
      id,
      user.email,
    )
    .first();

  if (!row) {
    return Response.json({ error: "Dossier introuvable." }, { status: 404 });
  }

  return Response.json({ project: row });
}
