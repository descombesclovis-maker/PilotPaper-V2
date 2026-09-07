import { env } from "cloudflare:workers";
import { getRequestUser } from "@/lib/request-user";
import { normalizeSiret, validateSiret } from "@/lib/siret";
import { normalizeFrenchVat, validateFrenchVat } from "@/lib/vat";
import { ensureProjectSchema } from "@/lib/ensure-project-schema";

type ProjectPayload = {
  requester?: {
    kind?: "company" | "person";
    vat?: string;
    siret?: string;
    siren?: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    address?: string;
    ape?: string | null;
    source?: string;
    checkedAt?: string;
    active?: boolean;
  };
};

export async function GET(request: Request) {
  const user = getRequestUser(request.headers);
  if (!user) {
    return Response.json({ error: "Authentification requise." }, { status: 401 });
  }
  await ensureProjectSchema();

  const result = await env.DB.prepare(
    `SELECT
      id, status, current_step AS currentStep,
      requester_kind AS requesterKind,
      requester_vat AS requesterVat,
      requester_siret AS requesterSiret,
      requester_siren AS requesterSiren,
      requester_name AS requesterName,
      requester_first_name AS requesterFirstName,
      requester_last_name AS requesterLastName,
      requester_address AS requesterAddress,
      requester_ape AS requesterApe,
      requester_source AS requesterSource,
      requester_verified_at AS requesterVerifiedAt,
      site_address AS siteAddress,
      support_type AS supportType,
      power_kwp AS powerKwp,
      module_count AS moduleCount,
      module_reference AS moduleReference,
      injection_mode AS injectionMode,
      form_data AS formData,
      validation_data AS validationData,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM projects
    WHERE owner_email = ?
    ORDER BY updated_at DESC
    LIMIT 30`,
  )
    .bind(user.email)
    .all();

  return Response.json({ projects: result.results ?? [] });
}

export async function POST(request: Request) {
  const user = getRequestUser(request.headers);
  if (!user) {
    return Response.json({ error: "Authentification requise." }, { status: 401 });
  }
  await ensureProjectSchema();

  const payload = (await request.json()) as ProjectPayload;
  const requester = payload.requester;
  const kind = requester?.kind === "person" ? "person" : "company";
  const siret = normalizeSiret(requester?.siret ?? "");
  const vat = normalizeFrenchVat(requester?.vat ?? "");
  const firstName = requester?.firstName?.trim() ?? "";
  const lastName = requester?.lastName?.trim() ?? "";
  const address = requester?.address?.trim() ?? "";

  const companyIsVerified =
    kind === "company" &&
    validateFrenchVat(vat) &&
    validateSiret(siret) &&
    requester?.active &&
    requester.name?.trim() &&
    requester.checkedAt;
  const personIsComplete =
    kind === "person" && firstName.length > 1 && lastName.length > 1 && address.length > 5;

  if (!requester || (!companyIsVerified && !personIsComplete)) {
    return Response.json(
      { error: "L’identité du demandeur doit être complète et vérifiée avant la création du dossier." },
      { status: 400 },
    );
  }

  const requesterName =
    kind === "person"
      ? `${firstName} ${lastName}`.trim()
      : requester.name?.trim() ?? "";
  const verifiedAt = requester.checkedAt ?? new Date().toISOString();

  const id = crypto.randomUUID();
  const row = await env.DB.prepare(
    `INSERT INTO projects (
      id, owner_email, owner_name, requester_kind, requester_vat,
      requester_siret, requester_siren, requester_name, requester_first_name,
      requester_last_name, requester_address, requester_ape, requester_source,
      requester_identity_status, requester_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING
      id, status, current_step AS currentStep,
      requester_kind AS requesterKind,
      requester_vat AS requesterVat,
      requester_siret AS requesterSiret,
      requester_name AS requesterName,
      requester_address AS requesterAddress,
      created_at AS createdAt, updated_at AS updatedAt`,
  )
    .bind(
      id,
      user.email,
      user.displayName,
      kind,
      kind === "company" ? vat : "",
      kind === "company" ? siret : "",
      kind === "company" ? requester.siren ?? siret.slice(0, 9) : "",
      requesterName,
      kind === "person" ? firstName : "",
      kind === "person" ? lastName : "",
      address,
      kind === "company" ? requester.ape ?? null : null,
      kind === "company"
        ? requester.source?.trim() ?? ""
        : "Identité déclarée par le demandeur",
      "verified",
      verifiedAt,
    )
    .first();

  return Response.json({ project: row }, { status: 201 });
}
