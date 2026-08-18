"use server";

import { db } from "@/db";
import { students, courseEnrollments, courses, assignments, submissions, grades, annotations } from "@/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireCapability } from "@/lib/auth/require";
import type { Term } from "@/lib/terms";

export type ArchiveAssignment = {
  id: number;
  name: string;
  pointsPossible: number;
  dueDate: string | null;
  submissionCount: number;
  grade: { totalScore: number | null; status: string; feedback: string | null } | null;
  annotationCount: number;
};

export type ArchiveCourse = {
  id: number;
  name: string;
  code: string;
  year: number;
  term: Term;
  assignments: ArchiveAssignment[];
};

export type StudentArchive = {
  student: { id: number; name: string; netId: string | null; email: string | null };
  courses: ArchiveCourse[];
};

/** Candidate list for the archive's student picker — requires the global archive.view flag. */
export async function searchStudents(query: string): Promise<{ id: number; name: string; netId: string | null }[]> {
  await requireCapability("archive.view");
  const q = query.trim();
  if (!q) return [];

  return db
    .select({ id: students.id, name: students.name, netId: students.netId })
    .from(students)
    .where(sql`${students.name} LIKE ${`%${q}%`} OR ${students.netId} LIKE ${`%${q}%`}`)
    .orderBy(students.sortName)
    .limit(25);
}

/**
 * One student's submissions, grades, and annotation counts across every
 * course they've been enrolled in — not just courses the caller teaches.
 * Gated on the `canViewArchive` flag (or, once student login exists, the
 * student's own linked record) rather than course membership: sharing a
 * student with another instructor must not by itself expose their record
 * elsewhere. See docs/accounts-and-courses.md.
 */
export async function getStudentArchive(studentId: number): Promise<StudentArchive | null> {
  await requireCapability("archive.view", { kind: "student", studentId });

  const [student] = await db
    .select({ id: students.id, name: students.name, netId: students.netId, email: students.email })
    .from(students)
    .where(eq(students.id, studentId));
  if (!student) return null;

  const enrollments = await db
    .select({ courseId: courseEnrollments.courseId })
    .from(courseEnrollments)
    .where(eq(courseEnrollments.studentId, studentId));

  const courseIds = enrollments.map((e) => e.courseId);
  if (courseIds.length === 0) return { student, courses: [] };

  const courseRows = await db.select().from(courses).where(inArray(courses.id, courseIds));

  const archiveCourses = await Promise.all(
    courseRows.map(async (course): Promise<ArchiveCourse> => {
      const courseAssignments = await db
        .select()
        .from(assignments)
        .where(eq(assignments.courseId, course.id))
        .orderBy(assignments.sortOrder);

      const archiveAssignments = await Promise.all(
        courseAssignments.map(async (a): Promise<ArchiveAssignment> => {
          const [gradeRow] = await db
            .select({ totalScore: grades.totalScore, status: grades.status, feedback: grades.feedback })
            .from(grades)
            .where(and(eq(grades.assignmentId, a.id), eq(grades.studentId, studentId)));

          const subs = await db
            .select({ id: submissions.id })
            .from(submissions)
            .where(and(eq(submissions.assignmentId, a.id), eq(submissions.studentId, studentId)));

          const [annotationCountRow] =
            subs.length > 0
              ? await db
                  .select({ n: sql<number>`count(*)` })
                  .from(annotations)
                  .where(
                    inArray(
                      annotations.submissionId,
                      subs.map((s) => s.id)
                    )
                  )
              : [{ n: 0 }];

          return {
            id: a.id,
            name: a.name,
            pointsPossible: a.pointsPossible,
            dueDate: a.dueDate,
            submissionCount: subs.length,
            grade: gradeRow ?? null,
            annotationCount: Number(annotationCountRow?.n ?? 0),
          };
        })
      );

      return {
        id: course.id,
        name: course.name,
        code: course.code,
        year: course.year,
        term: course.term,
        assignments: archiveAssignments,
      };
    })
  );

  return { student, courses: archiveCourses };
}
