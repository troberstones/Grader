CREATE TABLE `annotation_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`annotation_id` integer NOT NULL,
	`annotation_data` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`annotation_id`) REFERENCES `annotations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `annotations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submission_id` integer NOT NULL,
	`grade_id` integer,
	`frame_number` integer,
	`annotation_data` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`grade_id`) REFERENCES `grades`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_id` integer NOT NULL,
	`rubric_id` integer,
	`name` text NOT NULL,
	`description` text,
	`due_date` text,
	`points_possible` real NOT NULL,
	`submission_type` text DEFAULT 'image' NOT NULL,
	`lms_assignment_id` text,
	`archived` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rubric_id`) REFERENCES `rubrics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `course_enrollments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`enrolled_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrollment_unique_idx` ON `course_enrollments` (`course_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`section` text,
	`semester` text NOT NULL,
	`lms_course_id` text,
	`archived` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `grade_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`grade_id` integer NOT NULL,
	`criteria_id` integer NOT NULL,
	`level_id` integer,
	`score` real,
	`comment` text,
	FOREIGN KEY (`grade_id`) REFERENCES `grades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`criteria_id`) REFERENCES `rubric_criteria`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `rubric_levels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grade_entry_unique_idx` ON `grade_entries` (`grade_id`,`criteria_id`);--> statement-breakpoint
CREATE TABLE `grades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignment_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`submission_id` integer,
	`total_score` real,
	`feedback` text,
	`status` text DEFAULT 'ungraded' NOT NULL,
	`graded_at` text,
	`exported_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grade_unique_idx` ON `grades` (`assignment_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `rubric_criteria` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rubric_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`sort_order` integer NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	FOREIGN KEY (`rubric_id`) REFERENCES `rubrics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rubric_levels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`criteria_id` integer NOT NULL,
	`level` integer NOT NULL,
	`label` text NOT NULL,
	`description` text NOT NULL,
	`points` real NOT NULL,
	FOREIGN KEY (`criteria_id`) REFERENCES `rubric_criteria`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rubrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lms_student_id` text,
	`net_id` text,
	`name` text NOT NULL,
	`sort_name` text NOT NULL,
	`email` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_net_id_idx` ON `students` (`net_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignment_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`file_path` text NOT NULL,
	`file_name` text NOT NULL,
	`file_type` text NOT NULL,
	`file_size` integer,
	`media_type` text NOT NULL,
	`thumbnail_path` text,
	`frame_count` integer,
	`fps` real,
	`duration` real,
	`submitted_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submission_unique_idx` ON `submissions` (`assignment_id`,`student_id`);