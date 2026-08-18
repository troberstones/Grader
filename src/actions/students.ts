"use server";

import { db } from "@/db";
import { students, courseEnrollments } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { parseCSV } from "@/lib/csv";
import { normalizeRosterRow } from "@/lib/learning-suite";
import type { LMSRosterRow } from "@/types/learning-suite";
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

export async function importRoster(courseId: number, csvText: string) {
  await requireCapability("course.edit", { kind: "course", courseId });
  const { data, errors } = parseCSV<LMSRosterRow>(csvText);

  if (errors.length > 0) {
    return { success: false, error: `CSV parse errors: ${errors.map((e) => e.message).join(", ")}`, imported: 0 };
  }

  let imported = 0;
  let skipped = 0;

  for (const row of data) {
    const normalized = normalizeRosterRow(row);
    if (!normalized) {
      skipped++;
      continue;
    }

    // Upsert student by netId if available, otherwise by name
    let studentId: number;

    if (normalized.netId) {
      const existing = await db
        .select()
        .from(students)
        .where(eq(students.netId, normalized.netId));

      if (existing.length > 0) {
        studentId = existing[0].id;
        // Update name/email if changed
        await db
          .update(students)
          .set({
            name: normalized.name,
            sortName: normalized.sortName,
            email: normalized.email,
            lmsStudentId: normalized.lmsStudentId,
          })
          .where(eq(students.id, studentId));
      } else {
        const result = await db
          .insert(students)
          .values({
            name: normalized.name,
            sortName: normalized.sortName,
            netId: normalized.netId,
            email: normalized.email,
            lmsStudentId: normalized.lmsStudentId,
          })
          .returning();
        studentId = result[0].id;
      }
    } else {
      // No netId — insert new student
      const result = await db
        .insert(students)
        .values({
          name: normalized.name,
          sortName: normalized.sortName,
          email: normalized.email,
          lmsStudentId: normalized.lmsStudentId,
        })
        .returning();
      studentId = result[0].id;
    }

    // Enroll in course (ignore if already enrolled)
    const existingEnrollment = await db
      .select()
      .from(courseEnrollments)
      .where(
        and(
          eq(courseEnrollments.courseId, courseId),
          eq(courseEnrollments.studentId, studentId)
        )
      );

    if (existingEnrollment.length === 0) {
      await db.insert(courseEnrollments).values({ courseId, studentId });
    }

    imported++;
  }

  revalidatePath(`/courses/${courseId}/roster`);
  return { success: true, imported, skipped };
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
