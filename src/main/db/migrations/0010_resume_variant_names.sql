CREATE TABLE `__new_resume_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`secure_payload` text NOT NULL,
	`template_id` text NOT NULL,
	`based_on_master_updated_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_resume_variants`("id", "name", "secure_payload", "template_id", "based_on_master_updated_at", "created_at", "updated_at")
SELECT
	"id",
	CASE WHEN "rank" = 1 THEN "base_name" ELSE "base_name" || ' (' || "rank" || ')' END,
	"secure_payload",
	"template_id",
	"based_on_master_updated_at",
	"created_at",
	"updated_at"
FROM (
	SELECT
		rv."id",
		rv."secure_payload",
		rv."template_id",
		rv."based_on_master_updated_at",
		rv."created_at",
		rv."updated_at",
		substr(j."title" || ' at ' || j."company", 1, 72) AS "base_name",
		ROW_NUMBER() OVER (
			PARTITION BY lower(substr(j."title" || ' at ' || j."company", 1, 72))
			ORDER BY rv."created_at", rv."id"
		) AS "rank"
	FROM `resume_variants` rv
	INNER JOIN `jobs` j ON j."id" = rv."job_id"
);--> statement-breakpoint
CREATE TEMP TABLE `resume_variant_jobs_0010` AS SELECT "id", "job_id" FROM `resume_variants`;--> statement-breakpoint
DROP TABLE `resume_variants`;--> statement-breakpoint
ALTER TABLE `__new_resume_variants` RENAME TO `resume_variants`;--> statement-breakpoint
CREATE UNIQUE INDEX `resume_variants_name_unique` ON `resume_variants` (`name`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `resume_variant_id` text REFERENCES resume_variants(id) ON DELETE SET NULL;--> statement-breakpoint
UPDATE `jobs` SET "resume_variant_id" = (SELECT m."id" FROM `resume_variant_jobs_0010` m WHERE m."job_id" = `jobs`."id");--> statement-breakpoint
DROP TABLE `resume_variant_jobs_0010`;
