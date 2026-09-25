import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { assignments, rubrics, grades, gradeEntries, rubricCriteria, rubricLevels } from "@/db/schema";
import type { GradeStatus } from "@/types/grading";
import { computeScore, criterionPoints, toNormalRubric, toSelections } from "@/lib/rubric";
import type { DbCriterionRow } from "@/lib/rubric";

/**
 * A timestamp strictly later than `prev`. `updated_at` doubles as the version
 * the grading UI sends back as `baseUpdatedAt`, so two writes landing in the
 * same millisecond must still produce different values — otherwise a stale
 * save could slip past the conflict check. `prev` may be an ISO string or
 * SQLite's `datetime('now')` form (UTC, space-separated).
 */
export function nextUpdatedAt(prev: string | null | undefined): string {
  const now = Date.now();
  const prevMs = prev ? Date.parse(prev.includes("T") ? prev : `${prev.replace(" ", "T")}Z`) : NaN;
  return new Date(Number.isNaN(prevMs) ? now : Math.max(now, prevMs + 1)).toISOString();
}

// Lives outside src/actions/ on purpose: every export of a "use server" file
// must be an async server action, and this has to stay synchronous to run
// inside a better-sqlite3 transaction callback.

/**
 * The transaction handle `db.transaction(...)` passes to its callback.
 * Extracted rather than hand-written so it always matches whatever
 * drizzle-orm/better-sqlite3 actually passes in.
 */
export type GradeTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ─── Recompute a grade's total/status from everything stored for it ──────────

/**
 * The single source of truth for `grades.totalScore`/`status`: reads back
 * every stored `grade_entries` row for `gradeId` (never just the entries a
 * particular request happened to submit) and rescoures with `computeScore`.
 *
 * This is what makes concurrent partial saves safe — device A grading
 * criterion 1 and device B grading criterion 2 both end up recomputing from
 * the union of what's actually stored, instead of either one clobbering the
 * total with a score derived from only its own request. Also refreshes each
 * entry's informational `score` column so it stays consistent with the
 * current rubric (criteria may have been archived since the entry was
 * written), but never touches `feedback` — callers own that separately.
 *
 * Synchronous and side-effect-only within `tx`, so it can run inside the same
 * `db.transaction` as the entry upserts that precede it. Callable with just
 * `gradeId` — `assignmentId` is read off the grade row — so a later rubric-edit
 * rescore pass can call this per grade without carrying extra context around.
 */
export function recomputeGrade(tx: GradeTx, gradeId: number): { status: GradeStatus; totalScore: number } {
  const gradeRow = tx.select().from(grades).where(eq(grades.id, gradeId)).get();
  if (!gradeRow) throw new Error(`recomputeGrade: grade ${gradeId} not found`);

  const assignmentRow = tx
    .select({ rubricId: assignments.rubricId, pointsPossible: assignments.pointsPossible })
    .from(assignments)
    .where(eq(assignments.id, gradeRow.assignmentId))
    .get();

  if (!assignmentRow?.rubricId) {
    // No rubric attached (or since detached) — nothing to score against.
    tx.update(grades)
      .set({ totalScore: null, status: "ungraded", gradedAt: null, updatedAt: nextUpdatedAt(gradeRow.updatedAt) })
      .where(eq(grades.id, gradeId))
      .run();
    return { status: "ungraded", totalScore: 0 };
  }

  const rubricRecord = tx.select().from(rubrics).where(eq(rubrics.id, assignmentRow.rubricId)).get();
  if (!rubricRecord) throw new Error(`recomputeGrade: rubric ${assignmentRow.rubricId} not found`);

  const criteriaRows = tx
    .select()
    .from(rubricCriteria)
    .where(and(eq(rubricCriteria.rubricId, assignmentRow.rubricId), eq(rubricCriteria.archived, 0)))
    .orderBy(rubricCriteria.sortOrder)
    .all();

  const criteria: DbCriterionRow[] = criteriaRows.map((c) => {
    const levels = tx
      .select()
      .from(rubricLevels)
      .where(eq(rubricLevels.criteriaId, c.id))
      .orderBy(rubricLevels.level)
      .all();
    return { id: c.id, name: c.name, description: c.description, share: c.weight, levels };
  });

  const normal = toNormalRubric({
    name: rubricRecord.name,
    description: rubricRecord.description,
    settings: rubricRecord.settings ? JSON.parse(rubricRecord.settings) : null,
    criteria,
  });

  const storedEntries = tx.select().from(gradeEntries).where(eq(gradeEntries.gradeId, gradeId)).all();
  const selections = toSelections(criteria, storedEntries);
  const result = computeScore(normal, selections, assignmentRow.pointsPossible);
  const outcomeByCriterionIndex = new Map(result.perCriterion.map((o) => [o.criterionIndex, o]));

  // Refresh each stored entry's informational score. Entries whose criterion
  // has since been archived (or has no level chosen) are left/scored null.
  for (const entry of storedEntries) {
    const criterionIndex = criteria.findIndex((c) => c.id === entry.criteriaId);
    const outcome = criterionIndex >= 0 ? outcomeByCriterionIndex.get(criterionIndex) : undefined;
    const score = outcome ? criterionPoints(normal, outcome, assignmentRow.pointsPossible) : null;
    if (entry.score !== score) {
      tx.update(gradeEntries).set({ score }).where(eq(gradeEntries.id, entry.id)).run();
    }
  }

  const status: GradeStatus = result.scored === 0 ? "ungraded" : result.complete ? "graded" : "in_progress";
  const totalScore = result.points ?? 0;

  tx.update(grades)
    .set({
      totalScore,
      status,
      gradedAt: status === "graded" ? new Date().toISOString() : null,
      updatedAt: nextUpdatedAt(gradeRow.updatedAt),
    })
    .where(eq(grades.id, gradeId))
    .run();

  return { status, totalScore };
}
