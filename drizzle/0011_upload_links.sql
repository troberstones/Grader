CREATE TABLE `upload_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignment_id` integer NOT NULL,
	`student_id` integer,
	`token_hash` text NOT NULL,
	`created_by` integer,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upload_links_token_idx` ON `upload_links` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `upload_links_assignment_idx` ON `upload_links` (`assignment_id`,`student_id`);
