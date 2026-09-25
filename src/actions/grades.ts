"use server";

import { db } from "@/db";
import { assignments, grades, gradeEntries, students, courseEnrollments } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { GradeStatus } from "@/types/grading";
import { requireCapability, AuthError } from "@/lib/auth/require";
import type { SessionUser } from "@/lib/auth/session";
import { assignmentResource } from "@/lib/auth/resource-lookup";
import { writeAudit } from "@/lib/audit";
import { nextUpdatedAt, recomputeGrade } from "@/lib/grading/recompute";
import { feedbackTestMode } from "@/lib/feedback/config";
import { feedbackHistory } from "@/lib/feedback/history";

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
  /**
   * `grades.updated_at` at the time this was read. The client holds onto
   * this per student and sends it back as `saveShareGrade`'s `baseUpdatedAt`
   * so a save can tell whether the row it's about to overwrite is the same
   * one it last saw — see `SaveShareGradeResult`'s "stale" branch.
   */
  updatedAt: string;
  entries: GradeEntry[];
};

export type StudentWithGrade = {
  id: number;
  name: string;
  sortName: string;
  netId: string | null;
  email: string | null;
  grade: StudentGrade | null;
  /**
   * The last feedback email that went out for this assignment (see
   * src/actions/feedback.ts), with the grade fingerprint at the time so the
   * sidebar can tell when the grade has changed since.
   */
  emailedFeedback: { sentAt: string; fingerprint: string | null } | null;
};

/** The raw row shape of `grades`. */
export type GradeRow = typeof grades.$inferSelect;


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

  const history = await feedbackHistory([assignmentId], feedbackTestMode());

  return enrolled.map((student) => {
    const grade = gradeRows.find((g) => g.studentId === student.id) ?? null;
    const lastSent = history.get(`${assignmentId}:${student.id}`)?.lastSent ?? null;
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
            updatedAt: grade.updatedAt,
            entries,
          }
        : null,
      emailedFeedback: lastSent ? { sentAt: lastSent.sentAt, fingerprint: lastSent.fingerprint } : null,
    };
  });
}

// ─── Save a grade for a share-model rubric (src/lib/rubric/) ─────────────────

export type SaveShareGradeResult =
  | { success: true; status: GradeStatus; totalScore: number; updatedAt: string }
  | { success: false; reason: "stale"; current: StudentGrade }
  | { success: false; reason: "auth" };

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
 * rejected with the full current record (entries included, so the client's
 * "Load theirs" can actually repaint the rubric) instead of overwriting it.
 * Callers that omit `baseUpdatedAt` never hit that branch, so this behaves
 * exactly as before for them.
 *
 * A missing/expired session or an insufficient capability is reported the
 * same way — `{ success:false, reason:"auth" }` — rather than thrown, so a
 * client mid-edit can keep the edit and show a retry affordance instead of a
 * toast built from whatever message a production build didn't strip.
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
  const resource = await assignmentResource(assignmentId);
  let actor: SessionUser;
  try {
    actor = await requireCapability("grade.write", resource);
  } catch (err) {
    if (err instanceof AuthError) return { success: false, reason: "auth" };
    throw err;
  }

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
      const currentEntries = tx
        .select()
        .from(gradeEntries)
        .where(eq(gradeEntries.gradeId, existing.id))
        .all();
      const current: StudentGrade = {
        id: existing.id,
        totalScore: existing.totalScore,
        feedback: existing.feedback,
        status: existing.status as GradeStatus,
        gradedAt: existing.gradedAt,
        exportedAt: existing.exportedAt,
        updatedAt: existing.updatedAt,
        entries: currentEntries.map((e) => ({
          criteriaId: e.criteriaId,
          levelId: e.levelId,
          score: e.score,
          comment: e.comment,
          nudge: e.nudge,
        })),
      };
      return { success: false as const, reason: "stale" as const, current };
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
      const current = tx.select({ updatedAt: grades.updatedAt }).from(grades).where(eq(grades.id, gradeId)).get();
      tx.update(grades)
        .set({ feedback: feedback || null, updatedAt: nextUpdatedAt(current?.updatedAt) })
        .where(eq(grades.id, gradeId))
        .run();
    }

    // Read back updatedAt rather than reusing a timestamp computed earlier
    // in this function — recomputeGrade and the feedback write above may
    // each have stamped their own, and this is whichever landed last.
    const finalRow = tx.select({ updatedAt: grades.updatedAt }).from(grades).where(eq(grades.id, gradeId)).get()!;

    return { success: true as const, status, totalScore, updatedAt: finalRow.updatedAt, gradeId };
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

  return { success: true, status: outcome.status, totalScore: outcome.totalScore, updatedAt: outcome.updatedAt };
}

export type MarkMissingResult =
  | { success: true; updatedAt: string }
  | { success: false; reason: "auth" };

/**
 * Distinct from a criterion graded at level 0: nothing was submitted at all.
 * A nonzero band floor is only defensible if these two states read
 * differently — see docs/rubric-authoring.md. Model-agnostic: works
 * regardless of which editor authored the rubric.
 *
 * Reports a missing/expired session or missing capability as
 * `{ success:false, reason:"auth" }` rather than throwing — see
 * `saveShareGrade` for why.
 */
export async function markMissing(assignmentId: number, studentId: number): Promise<MarkMissingResult> {
  const resource = await assignmentResource(assignmentId);
  let actor: SessionUser;
  try {
    actor = await requireCapability("grade.write", resource);
  } catch (err) {
    if (err instanceof AuthError) return { success: false, reason: "auth" };
    throw err;
  }

  const existing = await db
    .select({ id: grades.id, updatedAt: grades.updatedAt })
    .from(grades)
    .where(and(eq(grades.assignmentId, assignmentId), eq(grades.studentId, studentId)));

  const now = new Date().toISOString();
  let gradeId: number;
  // Echoed back to the client as `updatedAt` — must be the value actually
  // stored, not just `now`: the insert branch leaves `updatedAt` to the
  // column's own `datetime('now')` default, which is a different string
  // format than the explicit ISO timestamp the update branch writes.
  let updatedAt: string;
  if (existing.length > 0) {
    gradeId = existing[0].id;
    await db.delete(gradeEntries).where(eq(gradeEntries.gradeId, gradeId));
    updatedAt = nextUpdatedAt(existing[0].updatedAt);
    await db
      .update(grades)
      .set({ totalScore: 0, feedback: null, status: "missing", gradedAt: now, updatedAt })
      .where(eq(grades.id, gradeId));
  } else {
    const [created] = await db
      .insert(grades)
      .values({ assignmentId, studentId, totalScore: 0, status: "missing", gradedAt: now })
      .returning();
    gradeId = created.id;
    updatedAt = created.updatedAt;
  }

  await writeAudit(actor, {
    action: "grade.mark_missing",
    targetType: "grade",
    targetId: gradeId,
    detail: { assignmentId, studentId },
  });

  revalidatePath(`/assignments/${assignmentId}`);
  return { success: true, updatedAt };
}

// ─── Clear a student's grade (reset to ungraded) ──────────────────────────────

export type ClearGradeResult = { success: true } | { success: false; reason: "auth" };

/**
 * Reports a missing/expired session or missing capability as
 * `{ success:false, reason:"auth" }` rather than throwing — see
 * `saveShareGrade` for why.
 */
export async function clearGrade(assignmentId: number, studentId: number): Promise<ClearGradeResult> {
  const resource = await assignmentResource(assignmentId);
  let actor: SessionUser;
  try {
    actor = await requireCapability("grade.write", resource);
  } catch (err) {
    if (err instanceof AuthError) return { success: false, reason: "auth" };
    throw err;
  }

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
  return { success: true };
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
