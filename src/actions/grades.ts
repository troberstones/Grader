"use server";

import { db } from "@/db";
import {
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

// ─── Types ────────────────────────────────────────────────────────────────────

export type GradeEntry = {
  criteriaId: number;
  levelId: number | null;
  score: number | null;
  comment: string | null;
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
  await requireCapability("course.view");
  // All students enrolled in the assignment's course
  // We join via assignment → course → enrollments → students
  const { assignments } = await import("@/db/schema");
  const assignmentRow = await db
    .select({ courseId: assignments.courseId })
    .from(assignments)
    .where(eq(assignments.id, assignmentId));
  if (!assignmentRow[0]) return [];

  const courseId = assignmentRow[0].courseId;

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
  await requireCapability("grade.write");
  // Determine status
  // Load all criteria for this assignment's rubric to know total count
  const { assignments } = await import("@/db/schema");
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

// ─── Clear a student's grade (reset to ungraded) ──────────────────────────────

export async function clearGrade(assignmentId: number, studentId: number) {
  await requireCapability("grade.write");
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
  await requireCapability("grade.write");
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
