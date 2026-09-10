ALTER TABLE `jobs` ADD `screenshot_paths` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
UPDATE `jobs`
SET `screenshot_paths` = json_array(`screenshot_path`)
WHERE `screenshot_path` IS NOT NULL;
