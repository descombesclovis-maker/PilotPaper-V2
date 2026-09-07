import { env } from "cloudflare:workers";

let schemaReady: Promise<void> | null = null;

/** A fresh local Miniflare database is empty, unlike the migrated hosted DB. */
export function ensureProjectSchema() {
  schemaReady ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS projects (
      id text PRIMARY KEY NOT NULL,
      owner_email text NOT NULL,
      owner_name text DEFAULT '' NOT NULL,
      agency_name text DEFAULT '' NOT NULL,
      status text DEFAULT 'draft' NOT NULL,
      current_step integer DEFAULT 1 NOT NULL,
      requester_kind text DEFAULT 'company' NOT NULL,
      requester_vat text DEFAULT '' NOT NULL,
      requester_siret text DEFAULT '' NOT NULL,
      requester_siren text DEFAULT '' NOT NULL,
      requester_name text NOT NULL,
      requester_first_name text DEFAULT '' NOT NULL,
      requester_last_name text DEFAULT '' NOT NULL,
      requester_address text DEFAULT '' NOT NULL,
      requester_ape text,
      requester_source text DEFAULT '' NOT NULL,
      requester_identity_status text DEFAULT 'verified' NOT NULL,
      requester_verified_at text NOT NULL,
      site_address text DEFAULT '' NOT NULL,
      support_type text DEFAULT '' NOT NULL,
      power_kwp text DEFAULT '' NOT NULL,
      module_count integer,
      module_reference text DEFAULT '' NOT NULL,
      injection_mode text DEFAULT '' NOT NULL,
      form_data text DEFAULT '{}' NOT NULL,
      validation_data text DEFAULT '{}' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS projects_owner_updated_idx ON projects (owner_email, updated_at)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS project_files (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL,
      owner_email text NOT NULL,
      kind text NOT NULL,
      file_name text NOT NULL,
      mime_type text NOT NULL,
      size_bytes integer NOT NULL,
      sha256 text NOT NULL,
      object_key text NOT NULL UNIQUE,
      status text DEFAULT 'uploaded' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS project_files_project_idx ON project_files (project_id, created_at)"),
  ]).then(() => undefined).catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}
