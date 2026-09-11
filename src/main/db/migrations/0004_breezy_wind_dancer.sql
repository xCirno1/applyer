CREATE TABLE `company_boards` (
	`id` text PRIMARY KEY NOT NULL,
	`board_key` text NOT NULL,
	`provider` text NOT NULL,
	`token` text NOT NULL,
	`host` text,
	`site` text,
	`company_name` text NOT NULL,
	`added_by` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_checked_at` text,
	`last_job_count` integer,
	`last_error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_boards_board_key_unique` ON `company_boards` (`board_key`);