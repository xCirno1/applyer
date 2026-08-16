CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text,
	`level` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL,
	`meta` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` integer NOT NULL,
	`kind` text NOT NULL,
	`original_filename` text NOT NULL,
	`stored_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`extracted_text` text,
	`is_encrypted_at_rest` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `failure_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`is_builtin` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_details_cache` (
	`url_hash` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`payload` text NOT NULL,
	`detected_ats` text,
	`requires_login` integer DEFAULT false NOT NULL,
	`apply_method` text,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` text,
	`source` text,
	`title` text NOT NULL,
	`company` text NOT NULL,
	`location` text,
	`url` text NOT NULL,
	`description` text,
	`salary_range` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`match_score` integer,
	`match_reasons` text,
	`application_url` text,
	`apply_method` text,
	`screenshot_path` text,
	`failure_tag` text,
	`failure_message` text,
	`blocking_reason` text,
	`blocking_task_id` text,
	`queued_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`filled_at` text,
	`submitted_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_url_unique` ON `jobs` (`url`);--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`full_name` text,
	`email` text,
	`phone` text,
	`location` text,
	`linkedin_url` text,
	`github_url` text,
	`portfolio_url` text,
	`work_authorization` text,
	`desired_roles` text,
	`desired_locations` text,
	`remote_preference` text,
	`salary_min` integer,
	`salary_max` integer,
	`salary_currency` text,
	`years_experience` integer,
	`summary` text,
	`skills` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
