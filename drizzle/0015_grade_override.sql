-- A professor-set letter grade that takes the place of the rubric's result,
-- with an optional reason ("Late 2 days", "Incomplete"). Both nullable and
-- NULL for every existing grade, so nothing changes until one is set. See
-- recomputeGrade (src/lib/grading/recompute.ts) for how it becomes a score.
ALTER TABLE grades ADD COLUMN override_letter TEXT;
--> statement-breakpoint
ALTER TABLE grades ADD COLUMN override_reason TEXT;
