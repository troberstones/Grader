CREATE TABLE `course_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text NOT NULL,
	`added_at` text DEFAULT (datetime('now')) NOT NULL,
	`added_by` integer,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_members_unique_idx` ON `course_members` (`course_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `course_members_user_idx` ON `course_members` (`user_id`);
--> statement-breakpoint
ALTER TABLE `courses` ADD COLUMN `visibility` text DEFAULT 'department' NOT NULL;
--> statement-breakpoint
ALTER TABLE `courses` ADD COLUMN `lineage_id` integer;
--> statement-breakpoint
ALTER TABLE `courses` ADD COLUMN `copied_from_id` integer;
--> statement-breakpoint
ALTER TABLE `courses` ADD COLUMN `start_date` text;
--> statement-breakpoint
ALTER TABLE `assignments` ADD COLUMN `sort_order` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `can_view_archive` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `students` ADD COLUMN `user_id` integer REFERENCES `users`(`id`);
--> statement-breakpoint
UPDATE `courses` SET `lineage_id` = `id` WHERE `lineage_id` IS NULL;
