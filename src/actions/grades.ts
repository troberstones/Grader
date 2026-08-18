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
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { GradeStatus } from "@/types/grading";
import { requireCapability } from "@/lib/auth/require";
import { assignmentResource } from "@/lib/auth/resource-lookup";
import { computeScore, criterionPoints, toNormalRubric, toSelections } from "@/lib/rubric";

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

// ─── Get grade sheet data for an assignment ───────────────────────────────────

export async function getGradeSheet(assignmentId: number): Promise<StudentWithGrade[]> {
  const resource = await assignmentResource(assignmentId);
  await requireCapability("course.view", resource);
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

// ─── Save a grade for one student ─────────────────────────────────────────────

export async function saveGrade({
  assignmentId,
  studentId,
  entries,
  feedback,
}: {
  assignmentId: number;
  studentId: number;
  entries: { criteriaId: number; levelId: number; score: number }[];
  feedback: string;
}) {
  await requireCapability("grade.write", await assignmentResource(assignmentId));
  // Determine status
  // Load all criteria for this assignment's rubric to know total count
  const assignmentRow = await db
    .select({ rubricId: assignments.rubricId })
    .from(assignments)
    .where(eq(assignments.id, assignmentId));
  const rubricId = assignmentRow[0]?.rubricId ?? null;

  let criteriaCount = 0;
  if (rubricId) {
    const criteria = await db
      .select({ id: rubricCriteria.id })
      .from(rubricCriteria)
      .where(eq(rubricCriteria.rubricId, rubricId));
    criteriaCount = criteria.length;
  }

  const status: GradeStatus =
    entries.length === 0
      ? "ungraded"
      : criteriaCount > 0 && entries.length >= criteriaCount
      ? "graded"
      : "in_progress";

  const totalScore = entries.reduce((sum, e) => sum + e.score, 0);

  // Upsert grade record
  const existing = await db
    .select({ id: grades.id })
    .from(grades)
    .where(and(eq(grades.assignmentId, assignmentId), eq(grades.studentId, studentId)));

  let gradeId: number;
  if (existing.length > 0) {
    gradeId = existing[0].id;
    await db
      .update(grades)
      .set({
        totalScore,
        feedback: feedback || null,
        status,
        gradedAt: status === "graded" ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(grades.id, gradeId));
  } else {
    const result = await db
      .insert(grades)
      .values({
        assignmentId,
        studentId,
        totalScore,
        feedback: feedback || null,
        status,
        gradedAt: status === "graded" ? new Date().toISOString() : null,
      })
      .returning();
    gradeId = result[0].id;
  }

  // Upsert grade entries
  for (const entry of entries) {
    const existingEntry = await db
      .select({ id: gradeEntries.id })
      .from(gradeEntries)
      .where(and(eq(gradeEntries.gradeId, gradeId), eq(gradeEntries.criteriaId, entry.criteriaId)));

    if (existingEntry.length > 0) {
      await db
        .update(gradeEntries)
        .set({ levelId: entry.levelId, score: entry.score })
        .where(eq(gradeEntries.id, existingEntry[0].id));
    } else {
      await db.insert(gradeEntries).values({
        gradeId,
        criteriaId: entry.criteriaId,
        levelId: entry.levelId,
        score: entry.score,
      });
    }
  }

  revalidatePath(`/assignments/${assignmentId}`);
  return { success: true, status, totalScore };
}

// ─── Save a grade for a share-model rubric (src/lib/rubric/) ─────────────────

/**
 * Same shape of job as `saveGrade`, for a rubric authored by the share-model
 * editor. Re-fetches the rubric server-side rather than trusting anything
 * client-computed. `grades.totalScore` is written from `computeScore(...)
 * .points` — rounded exactly once — never from summing the per-entry scores
 * below, which are informational only (see `criterionPoints`).
 */
export async function saveShareGrade({
  assignmentId,
  studentId,
  entries,
  feedback,
}: {
  assignmentId: number;
  studentId: number;
  entries: { criteriaId: number; levelId: number; nudge?: number }[];
  feedback: string;
}) {
  await requireCapability("grade.write", await assignmentResource(assignmentId));

  const assignmentRow = await db
    .select({ rubricId: assignments.rubricId, pointsPossible: assignments.pointsPossible })
    .from(assignments)
    .where(eq(assignments.id, assignmentId));
  const a = assignmentRow[0];
  if (!a?.rubricId) throw new Error("This assignment has no rubric attached.");

  const rubricRow = await db.select().from(rubrics).where(eq(rubrics.id, a.rubricId));
  const rubricRecord = rubricRow[0];
  if (!rubricRecord) throw new Error("Rubric not found.");

  const criteriaRows = await db
    .select()
    .from(rubricCriteria)
    .where(and(eq(rubricCriteria.rubricId, a.rubricId), eq(rubricCriteria.archived, 0)))
    .orderBy(rubricCriteria.sortOrder);
  const criteria = await Promise.all(
    criteriaRows.map(async (c) => {
      const levels = await db.select().from(rubricLevels).where(eq(rubricLevels.criteriaId, c.id)).orderBy(rubricLevels.level);
      return { id: c.id, name: c.name, description: c.description, share: c.weight, levels };
    }),
  );

  const normal = toNormalRubric({
    name: rubricRecord.name,
    description: rubricRecord.description,
    settings: rubricRecord.settings ? JSON.parse(rubricRecord.settings) : null,
    criteria,
  });
  const selections = toSelections(criteria, entries);
  const result = computeScore(normal, selections, a.pointsPossible);
  const outcomeByCriterionIndex = new Map(result.perCriterion.map((o) => [o.criterionIndex, o]));

  const status: GradeStatus = result.scored === 0 ? "ungraded" : result.complete ? "graded" : "in_progress";
  const totalScore = result.points ?? 0;

  const existing = await db
    .select({ id: grades.id })
    .from(grades)
    .where(and(eq(grades.assignmentId, assignmentId), eq(grades.studentId, studentId)));

  let gradeId: number;
  if (existing.length > 0) {
    gradeId = existing[0].id;
    await db
      .update(grades)
      .set({
        totalScore,
        feedback: feedback || null,
        status,
        gradedAt: status === "graded" ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(grades.id, gradeId));
  } else {
    const result = await db
      .insert(grades)
      .values({
        assignmentId,
        studentId,
        totalScore,
        feedback: feedback || null,
        status,
        gradedAt: status === "graded" ? new Date().toISOString() : null,
      })
      .returning();
    gradeId = result[0].id;
  }

  for (const entry of entries) {
    const criterionIndex = criteria.findIndex((c) => c.id === entry.criteriaId);
    const outcome = criterionIndex >= 0 ? outcomeByCriterionIndex.get(criterionIndex) : undefined;
    const score = outcome ? criterionPoints(normal, outcome, a.pointsPossible) : null;
    const nudge = entry.nudge ?? 0;

    const existingEntry = await db
      .select({ id: gradeEntries.id })
      .from(gradeEntries)
      .where(and(eq(gradeEntries.gradeId, gradeId), eq(gradeEntries.criteriaId, entry.criteriaId)));

    if (existingEntry.length > 0) {
      await db
        .update(gradeEntries)
        .set({ levelId: entry.levelId, score, nudge })
        .where(eq(gradeEntries.id, existingEntry[0].id));
    } else {
      await db.insert(gradeEntries).values({ gradeId, criteriaId: entry.criteriaId, levelId: entry.levelId, score, nudge });
    }
  }

  revalidatePath(`/assignments/${assignmentId}`);
  return { success: true, status, totalScore };
}

/**
 * Distinct from a criterion graded at level 0: nothing was submitted at all.
 * A nonzero band floor is only defensible if these two states read
 * differently — see docs/rubric-authoring.md. Model-agnostic: works
 * regardless of which editor authored the rubric.
 */
export async function markMissing(assignmentId: number, studentId: number) {
  await requireCapability("grade.write", await assignmentResource(assignmentId));
  const existing = await db
    .select({ id: grades.id })
    .from(grades)
    .where(and(eq(grades.assignmentId, assignmentId), eq(grades.studentId, studentId)));

  if (existing.length > 0) {
    await db.delete(gradeEntries).where(eq(gradeEntries.gradeId, existing[0].id));
    await db
      .update(grades)
      .set({ totalScore: 0, feedback: null, status: "missing", gradedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(grades.id, existing[0].id));
  } else {
    await db.insert(grades).values({ assignmentId, studentId, totalScore: 0, status: "missing", gradedAt: new Date().toISOString() });
  }
  revalidatePath(`/assignments/${assignmentId}`);
}

// ─── Clear a student's grade (reset to ungraded) ──────────────────────────────

export async function clearGrade(assignmentId: number, studentId: number) {
  await requireCapability("grade.write", await assignmentResource(assignmentId));
  const existing = await db
    .select({ id: grades.id })
    .from(grades)
    .where(and(eq(grades.assignmentId, assignmentId), eq(grades.studentId, studentId)));

  if (existing.length > 0) {
    // gradeEntries cascade delete via FK
    await db.delete(grades).where(eq(grades.id, existing[0].id));
  }
  revalidatePath(`/assignments/${assignmentId}`);
}

// ─── Export grades as CSV for Learning Suite ──────────────────────────────────

export async function exportGradesCSV(assignmentId: number): Promise<string> {
  await requireCapability("grade.write", await assignmentResource(assignmentId));
  const rows = await db
    .select({
      netId: students.netId,
      name: students.name,
      sortName: students.sortName,
      totalScore: grades.totalScore,
      feedback: grades.feedback,
      status: grades.status,
    })
    .from(grades)
    .innerJoin(students, eq(grades.studentId, students.id))
    .where(eq(grades.assignmentId, assignmentId))
    .orderBy(students.sortName);

  const escapeCsv = (val: string) => `"${val.replace(/"/g, '""')}"`;

  const header = ["Net ID", "Student Name", "Score", "Feedback"].map(escapeCsv).join(",");
  const body = rows
    .filter((r) => r.status !== "ungraded" && r.totalScore !== null)
    .map((r) =>
      [
        escapeCsv(r.netId ?? ""),
        escapeCsv(r.name),
        escapeCsv(String(r.totalScore ?? "")),
        escapeCsv(r.feedback ?? ""),
      ].join(",")
    )
    .join("\n");

  // Mark all exported grades
  await db
    .update(grades)
    .set({ exportedAt: new Date().toISOString() })
    .where(eq(grades.assignmentId, assignmentId));

  revalidatePath(`/assignments/${assignmentId}`);
  return body.length > 0 ? `${header}\n${body}` : header;
}
