import { and, eq, inArray, isNotNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { grades, gradeEntries } from "@/db/schema";

// Not in src/actions/: an exported async function in a "use server" file is a
// public server action, and this runs no auth check of its own.

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
