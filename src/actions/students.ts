"use server";

import { db } from "@/db";
import { students, courseEnrollments } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { parseRoster } from "@/lib/learning-suite";
import { requireCapability } from "@/lib/auth/require";

/**
 * Just the count, for stat cards on pages a department-visibility bypass can
 * legitimately reach (browsing a course to decide whether to copy it) — see
 * roster.view in src/lib/auth/roles.ts for why the actual names/netIds/
 * emails below stay member-only even there.
 */
export async function getEnrollmentCount(courseId: number): Promise<number> {
  await requireCapability("course.view", { kind: "course", courseId });
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(courseEnrollments)
    .where(eq(courseEnrollments.courseId, courseId));
  return row?.n ?? 0;
}

export async function getStudentsForCourse(courseId: number) {
  await requireCapability("roster.view", { kind: "course", courseId });
  return db
    .select({
      id: students.id,
      name: students.name,
      sortName: students.sortName,
      netId: students.netId,
      email: students.email,
      lmsStudentId: students.lmsStudentId,
      enrolledAt: courseEnrollments.enrolledAt,
    })
    .from(courseEnrollments)
    .innerJoin(students, eq(courseEnrollments.studentId, students.id))
    .where(eq(courseEnrollments.courseId, courseId))
    .orderBy(students.sortName);
}

/**
 * Import a roster CSV into a course.
 *
 * Tolerant on purpose: an unreadable row is counted and stepped over rather
 * than aborting the file, because a roster is usually right about 30 students
 * and odd about one, and losing the 30 helps nobody. Only a file with nothing
 * readable in it at all comes back as a failure — with a reason naming the
 * columns it did find, which is the difference between "import failed" and
 * knowing to rename a column. See parseRoster in src/lib/learning-suite.ts.
 */
export async function importRoster(courseId: number, csvText: string) {
  await requireCapability("course.edit", { kind: "course", courseId });
  const roster = parseRoster(csvText);

  if (roster.error) {
    return { success: false, error: roster.error, imported: 0, updated: 0, skipped: roster.skipped };
  }

  let imported = 0;
  let updated = 0;
  let failed = 0;

  for (const student of roster.students) {
    try {
      let studentId: number;

      if (student.netId) {
        const [existing] = await db
          .select({ id: students.id })
          .from(students)
          .where(eq(students.netId, student.netId));

        if (existing) {
          studentId = existing.id;
          await db
            .update(students)
            .set({
              name: student.name,
              sortName: student.sortName,
              // Keep what we already hold when the export omits a column, so a
              // roster without an Email column does not blank everyone's email.
              ...(student.email ? { email: student.email } : {}),
              ...(student.lmsStudentId ? { lmsStudentId: student.lmsStudentId } : {}),
            })
            .where(eq(students.id, studentId));
          updated++;
        } else {
          const [created] = await db
            .insert(students)
            .values({
              name: student.name,
              sortName: student.sortName,
              netId: student.netId,
              email: student.email,
              lmsStudentId: student.lmsStudentId,
            })
            .returning({ id: students.id });
          studentId = created.id;
          imported++;
        }
      } else {
        /*
         * No Net ID to match on. Fall back to the sort name within this course
         * — without it, re-importing a roster that has no identifier column
         * duplicates the whole class every time.
         */
        const [existing] = await db
          .select({ id: students.id })
          .from(students)
          .innerJoin(courseEnrollments, eq(courseEnrollments.studentId, students.id))
          .where(
            and(
              eq(courseEnrollments.courseId, courseId),
              eq(students.sortName, student.sortName),
            ),
          );

        if (existing) {
          studentId = existing.id;
          updated++;
        } else {
          const [created] = await db
            .insert(students)
            .values({
              name: student.name,
              sortName: student.sortName,
              email: student.email,
              lmsStudentId: student.lmsStudentId,
            })
            .returning({ id: students.id });
          studentId = created.id;
          imported++;
        }
      }

      const [enrolled] = await db
        .select({ id: courseEnrollments.id })
        .from(courseEnrollments)
        .where(
          and(
            eq(courseEnrollments.courseId, courseId),
            eq(courseEnrollments.studentId, studentId),
          ),
        );

      if (!enrolled) {
        await db.insert(courseEnrollments).values({ courseId, studentId });
      }
    } catch {
      // One bad row must not cost the rest of the roster.
      failed++;
    }
  }

  revalidatePath(`/courses/${courseId}/roster`);
  return {
    success: true,
    imported,
    updated,
    skipped: roster.skipped + failed,
    duplicates: roster.duplicates,
    columns: roster.columns,
  };
}

export async function addStudent(
  courseId: number,
  data: { name: string; sortName: string; netId?: string; email?: string }
) {
  await requireCapability("course.edit", { kind: "course", courseId });
  const result = await db.insert(students).values(data).returning();
  await db.insert(courseEnrollments).values({
    courseId,
    studentId: result[0].id,
  });
  revalidatePath(`/courses/${courseId}/roster`);
  return result[0];
}

export async function removeEnrollment(courseId: number, studentId: number) {
  await requireCapability("course.edit", { kind: "course", courseId });
  await db
    .delete(courseEnrollments)
    .where(
      and(
        eq(courseEnrollments.courseId, courseId),
        eq(courseEnrollments.studentId, studentId)
      )
    );
  revalidatePath(`/courses/${courseId}/roster`);
}
