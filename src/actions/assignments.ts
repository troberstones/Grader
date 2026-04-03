"use server";

import { db } from "@/db";
import { assignments, courses, rubrics, rubricCriteria, rubricLevels, grades } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";

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
  course: { id: number; name: string; code: string; semester: string };
  rubricName: string | null;
};

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getAssignmentsForCourse(courseId: number) {
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
      return { ...a, stats: { total, graded, inProgress } };
    })
  );

  return withStats;
}

export async function getAllAssignments() {
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
      courseSemester: courses.semester,
    })
    .from(assignments)
    .leftJoin(rubrics, eq(assignments.rubricId, rubrics.id))
    .innerJoin(courses, eq(assignments.courseId, courses.id))
    .where(and(eq(assignments.archived, 0), eq(courses.archived, 0)))
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

  // Load course
  const courseRow = await db.select().from(courses).where(eq(courses.id, a.courseId));
  const course = courseRow[0];

  // Load rubric with criteria + levels
  let rubric: {
    id: number;
    name: string;
    criteria: {
      id: number;
      name: string;
      description: string | null;
      sortOrder: number;
      weight: number;
      levels: { id: number; level: number; label: string; description: string; points: number }[];
    }[];
  } | null = null;

  if (a.rubricId) {
    const rubricRow = await db.select().from(rubrics).where(eq(rubrics.id, a.rubricId));
    if (rubricRow[0]) {
      const criteria = await db
        .select()
        .from(rubricCriteria)
        .where(eq(rubricCriteria.rubricId, a.rubricId))
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

      rubric = { id: rubricRow[0].id, name: rubricRow[0].name, criteria: criteriaWithLevels };
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
  await db
    .update(assignments)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(assignments.id, id));

  revalidatePath("/assignments");
  revalidatePath(`/assignments/${id}`);
}

export async function deleteAssignment(id: number) {
  const row = await db.select({ courseId: assignments.courseId }).from(assignments).where(eq(assignments.id, id));
  if (!row[0]) return;
  await db.delete(assignments).where(eq(assignments.id, id));
  revalidatePath(`/courses/${row[0].courseId}`);
  revalidatePath("/assignments");
}

export async function archiveAssignment(id: number) {
  const row = await db.select({ courseId: assignments.courseId }).from(assignments).where(eq(assignments.id, id));
  if (!row[0]) return;
  await db.update(assignments).set({ archived: 1 }).where(eq(assignments.id, id));
  revalidatePath(`/courses/${row[0].courseId}`);
  revalidatePath("/assignments");
}
