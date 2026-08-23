CREATE TABLE `indexed_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`company` text NOT NULL,
	`location` text,
	`source` text,
	`snippet` text,
	`salary_range` text,
	`posted_at` text,
	`search_query` text NOT NULL,
	`search_location` text,
	`first_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`seen_count` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `indexed_jobs_url_unique` ON `indexed_jobs` (`url`);