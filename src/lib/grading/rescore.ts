import { inArray } from "drizzle-orm";
import { grades, gradeEntries } from "@/db/schema";
import { recomputeGrade, type GradeTx } from "@/lib/grading/recompute";

/**
 * Deliberately NOT a "use server" module — same reasoning as
 * `src/lib/grading/recompute.ts`: `recomputeGrade` is synchronous by
 * necessity (it runs inside a better-sqlite3 transaction callback, which
 * itself must be synchronous), and Next's Server Actions transform requires
 * every top-level export of a "use server" file to be an async function.
 * This file carries no directive, so nothing here is bound by that rule.
 */
type Tx = GradeTx;

export type RescoreOutcome = { rescored: number; nowInProgress: number };

/**
 * Recomputes every "live" grade on the given assignments, using the caller's
 * transaction `tx` — so a rubric edit or a pointsPossible change and the
 * resulting rescore land or roll back together (owner's decision: sidebar,
 * CSV and LS push must never disagree with the live grading panel).
 *
 * "Live" excludes:
 * - `status: "missing"` grades — they stay missing, score 0, regardless of
 *   what the rubric now looks like.
 * - `status: "ungraded"` grades with no stored `grade_entries` — there is
 *   nothing to rescore, and calling recomputeGrade on them would just
 *   restamp `updatedAt` for no reason.
 *
 * Everything else (graded, in_progress, or the edge case of an "ungraded"
 * grade that DOES have entries — e.g. every criterion it was entered against
 * has since been archived) is recomputed from scratch via `recomputeGrade`,
 * the single source of truth for `totalScore`/`status`.
 *
 * `nowInProgress` counts grades that were "graded" before this call and are
 * "in_progress" after: the case the UI needs to call out, since it means a
 * newly-added criterion has no entry yet and a previously-complete grade
 * needs the instructor's attention again.
 */
export function rescoreAssignmentGrades(tx: Tx, assignmentIds: number[]): RescoreOutcome {
  if (assignmentIds.length === 0) return { rescored: 0, nowInProgress: 0 };

  const gradeRows = tx
    .select({ id: grades.id, status: grades.status })
    .from(grades)
    .where(inArray(grades.assignmentId, assignmentIds))
    .all();
  if (gradeRows.length === 0) return { rescored: 0, nowInProgress: 0 };

  const ungradedIds = gradeRows.filter((g) => g.status === "ungraded").map((g) => g.id);
  const ungradedWithEntries = new Set<number>();
  if (ungradedIds.length > 0) {
    const entryRows = tx
      .select({ gradeId: gradeEntries.gradeId })
      .from(gradeEntries)
      .where(inArray(gradeEntries.gradeId, ungradedIds))
      .all();
    for (const row of entryRows) ungradedWithEntries.add(row.gradeId);
  }

  let rescored = 0;
  let nowInProgress = 0;
  for (const row of gradeRows) {
    if (row.status === "missing") continue;
    if (row.status === "ungraded" && !ungradedWithEntries.has(row.id)) continue;

    const { status: newStatus } = recomputeGrade(tx, row.id);
    rescored++;
    if (row.status === "graded" && newStatus === "in_progress") nowInProgress++;
  }

  return { rescored, nowInProgress };
}
