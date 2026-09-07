ALTER TABLE `projects` ADD `requester_kind` text DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `requester_vat` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `requester_first_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `requester_last_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `requester_identity_status` text DEFAULT 'verified' NOT NULL;