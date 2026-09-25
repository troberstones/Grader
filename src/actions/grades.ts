"use server";

import { db } from "@/db";
import {
  assignments,
  rubrics,
  grades,
  gradeEntries,
  students,
  courseEnrollments,
  rubricCriteria,
  rubricLevels,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { GradeStatus } from "@/types/grading";
import { requireCapability } from "@/lib/auth/require";
import { assignmentResource } from "@/lib/auth/resource-lookup";
import { computeScore, criterionPoints, toNormalRubric, toSelections } from "@/lib/rubric";
import type { DbCriterionRow } from "@/lib/rubric";
import { writeAudit } from "@/lib/audit";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GradeEntry = {
  criteriaId: number;
  levelId: number | null;
  score: number | null;
  comment: string | null;
  nudge: number | null;
};

export type StudentGrade = {
  id: number;
  totalScore: number | null;
  feedback: string | null;
  status: GradeStatus;
  gradedAt: string | null;
  exportedAt: string | null;
  entries: GradeEntry[];
};

export type StudentWithGrade = {
  id: number;
  name: string;
  sortName: string;
  netId: string | null;
  email: string | null;
  grade: StudentGrade | null;
};

/** The row shape of `grades`, handed back verbatim on a stale-write conflict. */
export type GradeRow = typeof grades.$inferSelect;

/**
 * The transaction handle `db.transaction(...)` passes to its callback.
 * Extracted rather than hand-written so it always matches whatever
 * drizzle-orm/better-sqlite3 actually passes in.
 */
type GradeTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ─── Get grade sheet data for an assignment ───────────────────────────────────

export async function getGradeSheet(assignmentId: number): Promise<StudentWithGrade[]> {
  const resource = await assignmentResource(assignmentId);
  await requireCapability("roster.view", resource);
  if (resource.kind !== "assignment") return [];
  const courseId = resource.courseId;

  const enrolled = await db
    .select({
      id: students.id,
      name: students.name,
      sortName: students.sortName,
      netId: students.netId,
      email: students.email,
    })
    .from(courseEnrollments)
    .innerJoin(students, eq(courseEnrollments.studentId, students.id))
    .where(eq(courseEnrollments.courseId, courseId))
    .orderBy(students.sortName);

  // Load grades for this assignment
  const gradeRows = await db
    .select()
    .from(grades)
    .where(eq(grades.assignmentId, assignmentId));

  // Load all grade entries for these grades
  const gradeIds = gradeRows.map((g) => g.id);
  const allEntries = gradeIds.length > 0
    ? await Promise.all(
        gradeIds.map((gid) =>
          db.select().from(gradeEntries).where(eq(gradeEntries.gradeId, gid))
        )
      ).then((results) => results.flat())
    : [];

  return enrolled.map((student) => {
    const grade = gradeRows.find((g) => g.studentId === student.id) ?? null;
    const entries = grade
      ? allEntries.filter((e) => e.gradeId === grade.id).map((e) => ({
          criteriaId: e.criteriaId,
          levelId: e.levelId,
          score: e.score,
          comment: e.comment,
          nudge: e.nudge,
        }))
      : [];
    return {
      ...student,
      grade: grade
        ? {
            id: grade.id,
            totalScore: grade.totalScore,
            feedback: grade.feedback,
            status: grade.status as GradeStatus,
            gradedAt: grade.gradedAt,
            exportedAt: grade.exportedAt,
            entries,
          }
        : null,
    };
  });
}

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
      .set({ totalScore: null, status: "ungraded", gradedAt: null, updatedAt: new Date().toISOString() })
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
      updatedAt: new Date().toISOString(),
    })
    .where(eq(grades.id, gradeId))
    .run();

  return { status, totalScore };
}

// ─── Save a grade for a share-model rubric (src/lib/rubric/) ─────────────────

export type SaveShareGradeResult =
  | { success: true; status: GradeStatus; totalScore: number }
  | { success: false; reason: "stale"; current: GradeRow };

/**
 * Re-fetches the rubric server-side rather than trusting anything
 * client-computed. Upserts only the entries this request submitted, then
 * hands off to `recomputeGrade` to derive `totalScore`/`status` from
 * everything stored for the grade — never from summing just this request's
 * entries, which is what let a second device's partial save clobber the
 * total (and, via the unconditional `feedback` write below, wipe out
 * feedback someone else had just typed).
 *
 * `feedback` is optional: omit it (`undefined`) to leave the stored value
 * untouched — pass `""` to explicitly clear it. `baseUpdatedAt`, if given, is
 * compared against the stored row's `updatedAt`; a mismatch means someone
 * else wrote to this grade since the caller last read it, and this save is
 * rejected with the fresh row instead of overwriting it. Existing callers
 * pass neither `feedback: undefined` nor `baseUpdatedAt`, so this behaves
 * exactly as before for them — wiring a real conflict UI is later work.
 */
export async function saveShareGrade({
  assignmentId,
  studentId,
  entries,
  feedback,
  baseUpdatedAt,
}: {
  assignmentId: number;
  studentId: number;
  entries: { criteriaId: number; levelId: number; nudge?: number }[];
  feedback?: string;
  baseUpdatedAt?: string;
}): Promise<SaveShareGradeResult> {
  const actor = await requireCapability("grade.write", await assignmentResource(assignmentId));

  const assignmentRow = await db
    .select({ rubricId: assignments.rubricId, pointsPossible: assignments.pointsPossible })
    .from(assignments)
    .where(eq(assignments.id, assignmentId));
  const a = assignmentRow[0];
  if (!a?.rubricId) throw new Error("This assignment has no rubric attached.");

  const outcome = db.transaction((tx) => {
    const existing = tx
      .select()
      .from(grades)
      .where(and(eq(grades.assignmentId, assignmentId), eq(grades.studentId, studentId)))
      .get();

    if (existing && baseUpdatedAt !== undefined && existing.updatedAt !== baseUpdatedAt) {
      return { success: false as const, reason: "stale" as const, current: existing };
    }

    let gradeId: number;
    if (existing) {
      gradeId = existing.id;
    } else {
      const created = tx
        .insert(grades)
        .values({ assignmentId, studentId, status: "ungraded" })
        .returning()
        .get();
      gradeId = created.id;
    }

    for (const entry of entries) {
      const nudge = entry.nudge ?? 0;
      const existingEntry = tx
        .select({ id: gradeEntries.id })
        .from(gradeEntries)
        .where(and(eq(gradeEntries.gradeId, gradeId), eq(gradeEntries.criteriaId, entry.criteriaId)))
        .get();

      if (existingEntry) {
        tx.update(gradeEntries).set({ levelId: entry.levelId, nudge }).where(eq(gradeEntries.id, existingEntry.id)).run();
      } else {
        tx.insert(gradeEntries).values({ gradeId, criteriaId: entry.criteriaId, levelId: entry.levelId, nudge }).run();
      }
    }

    const { status, totalScore } = recomputeGrade(tx, gradeId);

    if (feedback !== undefined) {
      tx.update(grades)
        .set({ feedback: feedback || null, updatedAt: new Date().toISOString() })
        .where(eq(grades.id, gradeId))
        .run();
    }

    return { success: true as const, status, totalScore, gradeId };
  });

  revalidatePath(`/assignments/${assignmentId}`);

  if (!outcome.success) {
    return outcome;
  }

  await writeAudit(actor, {
    action: "grade.save",
    targetType: "grade",
    targetId: outcome.gradeId,
    detail: { assignmentId, studentId, totalScore: outcome.totalScore, status: outcome.status },
  });

  return { success: true, status: outcome.status, totalScore: outcome.totalScore };
}

/**
 * Distinct from a criterion graded at level 0: nothing was submitted at all.
 * A nonzero band floor is only defensible if these two states read
 * differently — see docs/rubric-authoring.md. Model-agnostic: works
 * regardless of which editor authored the rubric.
 */
export async function markMissing(assignmentId: number, studentId: number) {
  const actor = await requireCapability("grade.write", await assignmentResource(assignmentId));
  const existing = await db
    .select({ id: grades.id })
    .from(grades)
    .where(and(eq(grades.assignmentId, assignmentId), eq(grades.studentId, studentId)));

  let gradeId: number;
  if (existing.length > 0) {
    gradeId = existing[0].id;
    await db.delete(gradeEntries).where(eq(gradeEntries.gradeId, gradeId));
    await db
      .update(grades)
      .set({ totalScore: 0, feedback: null, status: "missing", gradedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(grades.id, gradeId));
  } else {
    const [created] = await db
      .insert(grades)
      .values({ assignmentId, studentId, totalScore: 0, status: "missing", gradedAt: new Date().toISOString() })
      .returning();
    gradeId = created.id;
  }

  await writeAudit(actor, {
    action: "grade.mark_missing",
    targetType: "grade",
    targetId: gradeId,
    detail: { assignmentId, studentId },
  });

  revalidatePath(`/assignments/${assignmentId}`);
}

// ─── Clear a student's grade (reset to ungraded) ──────────────────────────────

export async function clearGrade(assignmentId: number, studentId: number) {
  const actor = await requireCapability("grade.write", await assignmentResource(assignmentId));
  const existing = await db
    .select({ id: grades.id })
    .from(grades)
    .where(and(eq(grades.assignmentId, assignmentId), eq(grades.studentId, studentId)));

  if (existing.length > 0) {
    // gradeEntries cascade delete via FK
    await db.delete(grades).where(eq(grades.id, existing[0].id));
    await writeAudit(actor, {
      action: "grade.clear",
      targetType: "grade",
      targetId: existing[0].id,
      detail: { assignmentId, studentId },
    });
  }
  revalidatePath(`/assignments/${assignmentId}`);
}

// ─── Export grades as CSV for Learning Suite ──────────────────────────────────

export type ExportedGrades = {
  /** The Learning Suite grades CSV — graded rows, plus missing rows at score 0. */
  grades: string;
  /** A second CSV of students marked missing for this assignment, or null if there are none. */
  missing: string | null;
};

/**
 * Only `graded` and `missing` rows go to Learning Suite — `in_progress` and
 * `ungraded` rows have no defensible score to report yet, so they're left out
 * entirely rather than exported as 0 (owner decision). A `missing` row is
 * exported as score 0, matching Learning Suite's own convention for
 * unsubmitted work. `exportedAt` is stamped only on the rows actually
 * exported, not on every grade for the assignment.
 *
 * Also produces a second, informational CSV listing everyone currently
 * marked missing, so the instructor can chase down submissions without
 * cross-referencing the grade sheet by hand.
 */
export async function exportGradesCSV(assignmentId: number): Promise<ExportedGrades> {
  await requireCapability("grade.write", await assignmentResource(assignmentId));

  const [assignmentRow] = await db
    .select({ name: assignments.name })
    .from(assignments)
    .where(eq(assignments.id, assignmentId));
  const assignmentName = assignmentRow?.name ?? "";

  const rows = await db
    .select({
      id: grades.id,
      netId: students.netId,
      name: students.name,
      sortName: students.sortName,
      email: students.email,
      totalScore: grades.totalScore,
      feedback: grades.feedback,
      status: grades.status,
    })
    .from(grades)
    .innerJoin(students, eq(grades.studentId, students.id))
    .where(eq(grades.assignmentId, assignmentId))
    .orderBy(students.sortName);

  const escapeCsv = (val: string) => `"${val.replace(/"/g, '""')}"`;

  const exportable = rows.filter((r) => r.status === "graded" || r.status === "missing");

  const header = ["Net ID", "Student Name", "Score", "Feedback"].map(escapeCsv).join(",");
  const body = exportable
    .map((r) =>
      [
        escapeCsv(r.netId ?? ""),
        escapeCsv(r.name),
        escapeCsv(String(r.status === "missing" ? 0 : r.totalScore ?? 0)),
        escapeCsv(r.feedback ?? ""),
      ].join(",")
    )
    .join("\n");
  const gradesCsv = body.length > 0 ? `${header}\n${body}` : header;

  const missingRows = rows.filter((r) => r.status === "missing");
  let missingCsv: string | null = null;
  if (missingRows.length > 0) {
    const missingHeader = ["Student Name", "Sort Name", "Net ID", "Email", "Assignment"].map(escapeCsv).join(",");
    const missingBody = missingRows
      .map((r) =>
        [
          escapeCsv(r.name),
          escapeCsv(r.sortName),
          escapeCsv(r.netId ?? ""),
          escapeCsv(r.email ?? ""),
          escapeCsv(assignmentName),
        ].join(",")
      )
      .join("\n");
    missingCsv = `${missingHeader}\n${missingBody}`;
  }

  if (exportable.length > 0) {
    await db
      .update(grades)
      .set({ exportedAt: new Date().toISOString() })
      .where(inArray(grades.id, exportable.map((r) => r.id)));
  }

  revalidatePath(`/assignments/${assignmentId}`);
  return { grades: gradesCsv, missing: missingCsv };
}
