CREATE TABLE `resume_master` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`secure_payload` text NOT NULL,
	`template_id` text DEFAULT 'classic' NOT NULL,
	`page_size` text DEFAULT 'letter' NOT NULL,
	`source_document_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `resume_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`secure_payload` text NOT NULL,
	`template_id` text NOT NULL,
	`based_on_master_updated_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resume_variants_job_id_unique` ON `resume_variants` (`job_id`);