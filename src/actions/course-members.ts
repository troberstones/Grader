"use server";

import { db } from "@/db";
import { courseMembers, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require";
import { findUserByEmail, getCurrentUser } from "@/lib/auth/session";
import { resolveAuthContext } from "@/lib/auth/course-context";
import { type CourseRole } from "@/lib/auth/roles";

export type CourseMemberRow = {
  userId: number;
  name: string;
  email: string;
  role: CourseRole;
  addedAt: string;
};

// course.members.manage is owner-only end to end (see the permission table in
// src/lib/auth/roles.ts) — there is no separate "view members" capability,
// matching docs/accounts-and-courses.md's table where only owner has any mark
// at all in the members column.

export async function listCourseMembers(courseId: number): Promise<CourseMemberRow[]> {
  await requireCapability("course.members.manage", { kind: "course", courseId });
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: courseMembers.role,
      addedAt: courseMembers.addedAt,
    })
    .from(courseMembers)
    .innerJoin(users, eq(courseMembers.userId, users.id))
    .where(eq(courseMembers.courseId, courseId))
    .orderBy(users.name);
}

/** The signed-in user's own role on a course, for UI that needs to know without a full membership list. */
export async function getMyCourseRole(courseId: number): Promise<CourseRole | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const ctx = await resolveAuthContext({ kind: "course", courseId }, user.id);
  return ctx.courseMembership ?? null;
}

export async function addCourseMember(courseId: number, email: string, role: CourseRole) {
  const actor = await requireCapability("course.members.manage", { kind: "course", courseId });
  const target = await findUserByEmail(email);
  if (!target || target.status !== "active") {
    throw new Error("No active account with that email. Invite them from Admin → Users first.");
  }

  await db
    .insert(courseMembers)
    .values({ courseId, userId: target.id, role, addedBy: actor.id })
    .onConflictDoUpdate({ target: [courseMembers.courseId, courseMembers.userId], set: { role } });

  revalidatePath(`/courses/${courseId}/members`);
}

/** A course must always keep at least one owner, or member management becomes unreachable. */
async function assertNotLastOwner(courseId: number, userId: number) {
  const owners = await db
    .select({ userId: courseMembers.userId })
    .from(courseMembers)
    .where(and(eq(courseMembers.courseId, courseId), eq(courseMembers.role, "owner")));

  if (owners.length === 1 && owners[0].userId === userId) {
    throw new Error("A course must have at least one owner — promote someone else first.");
  }
}

export async function removeCourseMember(courseId: number, userId: number) {
  await requireCapability("course.members.manage", { kind: "course", courseId });
  await assertNotLastOwner(courseId, userId);
  await db.delete(courseMembers).where(and(eq(courseMembers.courseId, courseId), eq(courseMembers.userId, userId)));
  revalidatePath(`/courses/${courseId}/members`);
}

export async function updateCourseMemberRole(courseId: number, userId: number, role: CourseRole) {
  await requireCapability("course.members.manage", { kind: "course", courseId });
  if (role !== "owner") {
    await assertNotLastOwner(courseId, userId);
  }
  await db
    .update(courseMembers)
    .set({ role })
    .where(and(eq(courseMembers.courseId, courseId), eq(courseMembers.userId, userId)));
  revalidatePath(`/courses/${courseId}/members`);
}
