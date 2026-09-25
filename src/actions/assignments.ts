"use server";

import { db } from "@/db";
import {
  assignments,
  courses,
  courseMembers,
  rubrics,
  rubricCriteria,
  rubricLevels,
  grades,
  gradeEntries,
  submissions,
  annotations,
  reviewStrokes,
} from "@/db/schema";
import { eq, desc, and, inArray, isNotNull, ne, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require";
import { writeAudit } from "@/lib/audit";
import { removeAssignmentStorage } from "@/lib/file-storage";
import { feedbackTestMode } from "@/lib/feedback/config";
import { feedbackHistory } from "@/lib/feedback/history";
import type { Term } from "@/lib/terms";

// ─── Deletion guards ────────────────────────────────────────────────────────

/** `{ ok: true }` on success, or a refusal with a message safe to show the caller. */
export type DeleteOutcome = { ok: true } | { ok: false; reason: "has_grades" | "not_found"; message: string };

/**
 * Distinct students, across the given assignments, with a grade that means
 * more than "row exists": a status other than "ungraded", or at least one
 * grade_entries row. This is the bar deleteAssignment()/deleteCourse() use to
 * refuse a destructive delete — see the owner's decision in the task brief.
 */
export async function gradedStudentCount(assignmentIds: number[]): Promise<number> {
  if (assignmentIds.length === 0) return 0;
  const rows = await db
    .selectDistinct({ studentId: grades.studentId })
    .from(grades)
    .leftJoin(gradeEntries, eq(gradeEntries.gradeId, grades.id))
    .where(and(inArray(grades.assignmentId, assignmentIds), or(ne(grades.status, "ungraded"), isNotNull(gradeEntries.id))));
  return rows.length;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AssignmentWithCourse = {
  id: number;
  name: string;
  description: string | null;
  dueDate: string | null;
  pointsPossible: number;
  submissionType: string;
  lmsAssignmentId: string | null;
  archived: number;
  createdAt: string;
  updatedAt: string;
  courseId: number;
  rubricId: number | null;
  course: { id: number; name: string; code: string; year: number; term: Term };
  rubricName: string | null;
};

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getAssignmentsForCourse(courseId: number) {
  await requireCapability("course.view", { kind: "course", courseId });
  const rows = await db
    .select({
      id: assignments.id,
      name: assignments.name,
      description: assignments.description,
      dueDate: assignments.dueDate,
      pointsPossible: assignments.pointsPossible,
      submissionType: assignments.submissionType,
      lmsAssignmentId: assignments.lmsAssignmentId,
      archived: assignments.archived,
      createdAt: assignments.createdAt,
      updatedAt: assignments.updatedAt,
      courseId: assignments.courseId,
      rubricId: assignments.rubricId,
      rubricName: rubrics.name,
    })
    .from(assignments)
    .leftJoin(rubrics, eq(assignments.rubricId, rubrics.id))
    .where(and(eq(assignments.courseId, courseId), eq(assignments.archived, 0)))
    .orderBy(desc(assignments.createdAt));

  // How many students' feedback has been emailed, per assignment — for the
  // assignment list's "n emailed" line. Only test sends count in test mode,
  // only real ones otherwise (src/lib/feedback/config.ts).
  const history = await feedbackHistory(rows.map((a) => a.id), feedbackTestMode());
  const emailedCount = (assignmentId: number) =>
    [...history].filter(([key, h]) => key.startsWith(`${assignmentId}:`) && h.lastSent).length;

  // Attach grade stats
  const withStats = await Promise.all(
    rows.map(async (a) => {
      const gradeRows = await db
        .select({ status: grades.status })
        .from(grades)
        .where(eq(grades.assignmentId, a.id));
      const total = gradeRows.length;
      const graded = gradeRows.filter((g) => g.status === "graded").length;
      const inProgress = gradeRows.filter((g) => g.status === "in_progress").length;
      return { ...a, stats: { total, graded, inProgress, emailed: emailedCount(a.id) } };
    })
  );

  return withStats;
}

export async function getAllAssignments() {
  const user = await requireCapability("course.view");
  const membershipFilter =
    user.globalRole === "admin"
      ? undefined
      : inArray(
          courses.id,
          db.select({ courseId: courseMembers.courseId }).from(courseMembers).where(eq(courseMembers.userId, user.id))
        );

  const rows = await db
    .select({
      id: assignments.id,
      name: assignments.name,
      description: assignments.description,
      dueDate: assignments.dueDate,
      pointsPossible: assignments.pointsPossible,
      submissionType: assignments.submissionType,
      lmsAssignmentId: assignments.lmsAssignmentId,
      archived: assignments.archived,
      createdAt: assignments.createdAt,
      updatedAt: assignments.updatedAt,
      courseId: assignments.courseId,
      rubricId: assignments.rubricId,
      rubricName: rubrics.name,
      courseName: courses.name,
      courseCode: courses.code,
      courseYear: courses.year,
      courseTerm: courses.term,
    })
    .from(assignments)
    .leftJoin(rubrics, eq(assignments.rubricId, rubrics.id))
    .innerJoin(courses, eq(assignments.courseId, courses.id))
    .where(
      membershipFilter
        ? and(eq(assignments.archived, 0), eq(courses.archived, 0), membershipFilter)
        : and(eq(assignments.archived, 0), eq(courses.archived, 0))
    )
    .orderBy(desc(assignments.createdAt));

  return rows;
}

export async function getAssignment(id: number) {
  const row = await db
    .select({
      id: assignments.id,
      name: assignments.name,
      description: assignments.description,
      dueDate: assignments.dueDate,
      pointsPossible: assignments.pointsPossible,
      submissionType: assignments.submissionType,
      lmsAssignmentId: assignments.lmsAssignmentId,
      lmsDiscussionUrl: assignments.lmsDiscussionUrl,
      archived: assignments.archived,
      createdAt: assignments.createdAt,
      updatedAt: assignments.updatedAt,
      courseId: assignments.courseId,
      rubricId: assignments.rubricId,
    })
    .from(assignments)
    .where(eq(assignments.id, id));

  if (!row[0]) return null;
  const a = row[0];
  await requireCapability("course.view", { kind: "assignment", assignmentId: id, courseId: a.courseId });

  // Load course
  const courseRow = await db.select().from(courses).where(eq(courses.id, a.courseId));
  const course = courseRow[0];

  // Load rubric with criteria + levels
  let rubric: {
    id: number;
    name: string;
    settings?: { gradingMode?: "v3"; model?: "share"; bandEdges?: [number, number, number] };
    criteria: {
      id: number;
      name: string;
      description: string | null;
      sortOrder: number;
      weight: number;
      archived: number;
      // Null for share-model criteria (src/lib/rubric/) — points are
      // computed from weight/share + the rubric's bandEdges, not stored.
      levels: { id: number; level: number; label: string; description: string; points: number | null }[];
    }[];
  } | null = null;

  if (a.rubricId) {
    const rubricRow = await db.select().from(rubrics).where(eq(rubrics.id, a.rubricId));
    if (rubricRow[0]) {
      const criteria = await db
        .select()
        .from(rubricCriteria)
        .where(and(eq(rubricCriteria.rubricId, a.rubricId), eq(rubricCriteria.archived, 0)))
        .orderBy(rubricCriteria.sortOrder);

      const criteriaWithLevels = await Promise.all(
        criteria.map(async (c) => {
          const levels = await db
            .select()
            .from(rubricLevels)
            .where(eq(rubricLevels.criteriaId, c.id))
            .orderBy(rubricLevels.level);
          return { ...c, levels };
        })
      );

      rubric = {
        id: rubricRow[0].id,
        name: rubricRow[0].name,
        settings: rubricRow[0].settings
          ? (JSON.parse(rubricRow[0].settings) as { gradingMode?: "v3"; bandEdges?: [number, number, number] })
          : undefined,
        criteria: criteriaWithLevels,
      };
    }
  }

  return { ...a, course, rubric };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createAssignment(data: {
  courseId: number;
  rubricId?: number | null;
  name: string;
  description?: string;
  dueDate?: string;
  pointsPossible: number;
  submissionType: "image" | "video" | "any";
  lmsAssignmentId?: string;
}) {
  await requireCapability("course.edit", { kind: "course", courseId: data.courseId });
  const result = await db
    .insert(assignments)
    .values({
      courseId: data.courseId,
      rubricId: data.rubricId ?? null,
      name: data.name,
      description: data.description ?? null,
      dueDate: data.dueDate ?? null,
      pointsPossible: data.pointsPossible,
      submissionType: data.submissionType,
      lmsAssignmentId: data.lmsAssignmentId ?? null,
    })
    .returning();

  revalidatePath(`/courses/${data.courseId}`);
  revalidatePath("/assignments");
  return result[0];
}

export async function updateAssignment(
  id: number,
  data: {
    name?: string;
    description?: string | null;
    dueDate?: string | null;
    pointsPossible?: number;
    submissionType?: "image" | "video" | "any";
    rubricId?: number | null;
    lmsAssignmentId?: string | null;
  }
) {
  const row = await db.select({ courseId: assignments.courseId }).from(assignments).where(eq(assignments.id, id));
  if (!row[0]) return;
  await requireCapability("course.edit", { kind: "assignment", assignmentId: id, courseId: row[0].courseId });
  await db
    .update(assignments)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(assignments.id, id));

  revalidatePath("/assignments");
  revalidatePath(`/assignments/${id}`);
}

/**
 * Deletes an assignment and everything FK-scoped to it, but only once it's
 * ungraded — see gradedStudentCount() above. Refuses (rather than throwing)
 * when there are grades to protect, so the UI can show the reason instead of
 * a generic error toast.
 *
 * FK-safe order, all in one transaction: annotations (their annotation_history
 * cascades), review_strokes (no FK — itemId is a "sub:{id}" convention, not a
 * real constraint, but still worth cleaning up), grades (cascades
 * grade_entries), submissions (cascades review_media), then the assignment row
 * itself (cascades upload_links). Files on disk are removed after the
 * transaction commits, best-effort.
 */
export async function deleteAssignment(id: number): Promise<DeleteOutcome> {
  const row = await db
    .select({ courseId: assignments.courseId, name: assignments.name })
    .from(assignments)
    .where(eq(assignments.id, id));
  if (!row[0]) return { ok: false, reason: "not_found", message: "Assignment not found." };

  const actor = await requireCapability("course.edit", { kind: "assignment", assignmentId: id, courseId: row[0].courseId });

  const graded = await gradedStudentCount([id]);
  if (graded > 0) {
    return {
      ok: false,
      reason: "has_grades",
      message: `${graded} student${graded === 1 ? " has" : "s have"} grades on this assignment — archive it instead.`,
    };
  }

  db.transaction((tx) => {
    const submissionIds = tx
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.assignmentId, id))
      .all()
      .map((s) => s.id);

    if (submissionIds.length > 0) {
      tx.delete(annotations).where(inArray(annotations.submissionId, submissionIds)).run();
      tx.delete(reviewStrokes)
        .where(inArray(reviewStrokes.itemId, submissionIds.map((sid) => `sub:${sid}`)))
        .run();
    }

    tx.delete(grades).where(eq(grades.assignmentId, id)).run();
    tx.delete(submissions).where(eq(submissions.assignmentId, id)).run();
    tx.delete(assignments).where(eq(assignments.id, id)).run();
  });

  await removeAssignmentStorage(id);
  await writeAudit(actor, { action: "assignment.delete", targetType: "assignment", targetId: id, detail: { name: row[0].name } });

  revalidatePath(`/courses/${row[0].courseId}`);
  revalidatePath("/assignments");
  return { ok: true };
}

export async function archiveAssignment(id: number) {
  const row = await db.select({ courseId: assignments.courseId }).from(assignments).where(eq(assignments.id, id));
  if (!row[0]) return;
  await requireCapability("course.edit", { kind: "assignment", assignmentId: id, courseId: row[0].courseId });
  await db.update(assignments).set({ archived: 1 }).where(eq(assignments.id, id));
  revalidatePath(`/courses/${row[0].courseId}`);
  revalidatePath("/assignments");
}
