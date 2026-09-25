CREATE TABLE `feedback_sends` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignment_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`sent_by` integer,
	`recipient` text NOT NULL,
	`test_mode` integer DEFAULT 0 NOT NULL,
	`include_rubric` integer DEFAULT 0 NOT NULL,
	`include_annotations` integer DEFAULT 0 NOT NULL,
	`include_link` integer DEFAULT 0 NOT NULL,
	`letter_grade` text,
	`frame_count` integer DEFAULT 0 NOT NULL,
	`grade_fingerprint` text,
	`status` text NOT NULL,
	`error` text,
	`sent_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sent_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `feedback_sends_assignment_idx` ON `feedback_sends` (`assignment_id`,`student_id`);
--> statement-breakpoint
CREATE TABLE `feedback_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignment_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` integer,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`last_viewed_at` text,
	`view_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_links_token_idx` ON `feedback_links` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `feedback_links_assignment_idx` ON `feedback_links` (`assignment_id`,`student_id`);
