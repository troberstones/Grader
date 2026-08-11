-- Art Review module tables.
-- Idempotent so it can be applied to an existing grader.db without a reset.

CREATE TABLE IF NOT EXISTS `review_media` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `submission_id` integer NOT NULL,
  `variant` text NOT NULL,
  `idx` integer DEFAULT 0 NOT NULL,
  `path` text NOT NULL,
  `mime` text NOT NULL,
  `kind` text,
  `width` integer,
  `height` integer,
  `fps` real,
  `frame_count` integer,
  `duration` real,
  `color_primaries` text,
  `color_transfer` text,
  `status` text DEFAULT 'ready' NOT NULL,
  `warnings` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `review_media_submission_idx` ON `review_media` (`submission_id`,`variant`,`idx`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_strokes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `item_id` text NOT NULL,
  `seq` integer NOT NULL,
  `local_id` text NOT NULL,
  `frame_in` integer DEFAULT 0 NOT NULL,
  `frame_out` integer DEFAULT 0 NOT NULL,
  `author_id` text NOT NULL,
  `data` blob NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `deleted_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `review_strokes_item_frame_idx` ON `review_strokes` (`item_id`,`frame_in`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `review_strokes_item_seq_idx` ON `review_strokes` (`item_id`,`seq`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `review_strokes_local_idx` ON `review_strokes` (`item_id`,`local_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_prefs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `context_id` text NOT NULL,
  `data` text NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `review_prefs_context_idx` ON `review_prefs` (`context_id`);
