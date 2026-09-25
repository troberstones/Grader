-- Schema groundwork for the share-model rubric editor/grading tool
-- (src/lib/rubric/), which lives alongside the existing v1/v2/v3 editors
-- rather than replacing them. Captures the full effect of what used to be
-- scripts/apply-rubric-share-model-migration.mjs (now under
-- scripts/legacy-migrations/ — it never got a paired drizzle/*.sql file
-- until now):
--
--   - rubric_criteria.archived — soft-delete for the new editor's update
--     path. A criterion with existing grade_entries can't be hard-deleted
--     (FK), so it's archived instead. Legacy (v1/v2/v3) rows never set
--     this; it defaults to 0 and their own update path is untouched.
--   - rubric_levels.points — loosened from NOT NULL to nullable. Share-model
--     levels store no points (computed from share + bandEdges); v1/v2/v3
--     always write a real number, so this is a pure widening. SQLite can't
--     ALTER COLUMN, so this is done as add/copy/drop/rename on the column
--     alone — never touches rowids, so grade_entries.level_id stays valid
--     throughout, and no foreign_keys pragma toggling is needed (same as
--     every other migration in this repo: none of them rebuild a table).
--   - grade_entries.nudge — share-model only (-1|0|1); unused, NULL, for
--     legacy entries.
--
-- Run via scripts/migrate.mjs (scripts/lib/migrations.mjs), whose baseline
-- probe for this file checks all three artifacts before deciding whether to
-- run it — see ARTIFACT_PROBES["0014_rubric_share_model.sql"]. The runner
-- also tolerates a database that already has some but not all three (e.g.
-- one built by the old hand-replayed logic in init-db.mjs/global-setup.ts,
-- which only ever replayed the first two): a "duplicate column name" error
-- on the ADD COLUMN statements below is treated as "already applied" and
-- skipped rather than aborting the migration, and the points rebuild is
-- naturally re-runnable regardless of its starting state.
ALTER TABLE `rubric_criteria` ADD COLUMN `archived` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `grade_entries` ADD COLUMN `nudge` integer;
--> statement-breakpoint
ALTER TABLE `rubric_levels` ADD COLUMN `points_new` real;
--> statement-breakpoint
UPDATE `rubric_levels` SET `points_new` = `points`;
--> statement-breakpoint
ALTER TABLE `rubric_levels` DROP COLUMN `points`;
--> statement-breakpoint
ALTER TABLE `rubric_levels` RENAME COLUMN `points_new` TO `points`;
