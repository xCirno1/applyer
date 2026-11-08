CREATE TABLE `application_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`is_builtin` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `application_stages` (`id`, `label`, `is_builtin`, `position`) VALUES
	('awaiting_response', 'Awaiting response', 1, 0),
	('interviewing', 'Interviewing', 1, 1),
	('offer', 'Offer', 1, 2),
	('rejected', 'Rejected', 1, 3),
	('withdrawn', 'Withdrawn', 1, 4);
--> statement-breakpoint
ALTER TABLE `jobs` ADD `stage_id` text REFERENCES application_stages(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `stage_changed_at` text;--> statement-breakpoint
CREATE INDEX `jobs_stage_id_idx` ON `jobs` (`stage_id`);
