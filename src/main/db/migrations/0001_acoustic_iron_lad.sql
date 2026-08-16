CREATE TABLE `job_exclusions` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`company` text,
	`reason` text,
	`excluded_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_exclusions_url_unique` ON `job_exclusions` (`url`);