/**
 * Resolves the database-backed half of an authorization decision.
 *
 * `can()` (./roles) stays a pure function so it can be unit-tested without a
 * database. This is the one place that actually queries `course_members`,
 * `courses.visibility`, and `students.userId` — called once by
 * requireCapability / apiRequireCapability before they call `can()`.
 */

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { courseMembers, courses, students } from "@/db/schema";
import { isCourseRole, type AuthContext, type Resource } from "./roles";

export async function resolveAuthContext(resource: Resource, userId: number): Promise<AuthContext> {
  if (resource.kind === "global") return {};

  if (resource.kind === "student") {
    const [row] = await db
      .select({ userId: students.userId })
      .from(students)
      .where(eq(students.id, resource.studentId));
    return { isOwnStudentRecord: !!row && row.userId === userId };
  }

  const courseId = resource.courseId;

  const [course] = await db.select({ visibility: courses.visibility }).from(courses).where(eq(courses.id, courseId));
  const [member] = await db
    .select({ role: courseMembers.role })
    .from(courseMembers)
    .where(and(eq(courseMembers.courseId, courseId), eq(courseMembers.userId, userId)));

  return {
    courseMembership: member && isCourseRole(member.role) ? member.role : null,
    courseVisibility: course?.visibility === "private" ? "private" : "department",
  };
}
