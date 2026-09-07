CREATE TABLE `project_files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`kind` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`object_key` text NOT NULL,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_files_object_key_unique` ON `project_files` (`object_key`);--> statement-breakpoint
CREATE INDEX `project_files_project_idx` ON `project_files` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`owner_name` text DEFAULT '' NOT NULL,
	`agency_name` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`current_step` integer DEFAULT 1 NOT NULL,
	`requester_siret` text NOT NULL,
	`requester_siren` text DEFAULT '' NOT NULL,
	`requester_name` text NOT NULL,
	`requester_address` text DEFAULT '' NOT NULL,
	`requester_ape` text,
	`requester_source` text DEFAULT '' NOT NULL,
	`requester_verified_at` text NOT NULL,
	`site_address` text DEFAULT '' NOT NULL,
	`support_type` text DEFAULT '' NOT NULL,
	`power_kwp` text DEFAULT '' NOT NULL,
	`module_count` integer,
	`module_reference` text DEFAULT '' NOT NULL,
	`injection_mode` text DEFAULT '' NOT NULL,
	`form_data` text DEFAULT '{}' NOT NULL,
	`validation_data` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_owner_updated_idx` ON `projects` (`owner_email`,`updated_at`);