import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    ownerName: text("owner_name").notNull().default(""),
    agencyName: text("agency_name").notNull().default(""),
    status: text("status").notNull().default("draft"),
    currentStep: integer("current_step").notNull().default(1),
    requesterKind: text("requester_kind").notNull().default("company"),
    requesterVat: text("requester_vat").notNull().default(""),
    requesterSiret: text("requester_siret").notNull(),
    requesterSiren: text("requester_siren").notNull().default(""),
    requesterName: text("requester_name").notNull(),
    requesterFirstName: text("requester_first_name").notNull().default(""),
    requesterLastName: text("requester_last_name").notNull().default(""),
    requesterAddress: text("requester_address").notNull().default(""),
    requesterApe: text("requester_ape"),
    requesterSource: text("requester_source").notNull().default(""),
    requesterIdentityStatus: text("requester_identity_status")
      .notNull()
      .default("verified"),
    requesterVerifiedAt: text("requester_verified_at").notNull(),
    siteAddress: text("site_address").notNull().default(""),
    supportType: text("support_type").notNull().default(""),
    powerKwp: text("power_kwp").notNull().default(""),
    moduleCount: integer("module_count"),
    moduleReference: text("module_reference").notNull().default(""),
    injectionMode: text("injection_mode").notNull().default(""),
    formData: text("form_data").notNull().default("{}"),
    validationData: text("validation_data").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("projects_owner_updated_idx").on(table.ownerEmail, table.updatedAt)],
);

export const projectFiles = sqliteTable(
  "project_files",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ownerEmail: text("owner_email").notNull(),
    kind: text("kind").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    objectKey: text("object_key").notNull().unique(),
    status: text("status").notNull().default("uploaded"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("project_files_project_idx").on(table.projectId, table.createdAt),
  ],
);
