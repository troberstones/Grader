"use server";

import { db } from "@/db";
import { courses, assignments, courseEnrollments, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require";
import { isTerm, termSortKey, type Term } from "@/lib/terms";

export async function getCourses(includeArchived = false) {
  await requireCapability("course.view");
  const query = includeArchived
    ? db.select().from(courses).orderBy(desc(courses.createdAt))
    : db.select().from(courses).where(eq(courses.archived, 0)).orderBy(desc(courses.createdAt));
  return query;
}

export async function getCourse(id: number) {
  await requireCapability("course.view");
  const result = await db.select().from(courses).where(eq(courses.id, id));
  return result[0] || null;
}

/** Every year/term that has a course, newest first — populates the courses-page rail. */
export async function getCourseTerms(): Promise<{ year: number; term: Term }[]> {
  await requireCapability("course.view");
  const rows = await db
    .selectDistinct({ year: courses.year, term: courses.term })
    .from(courses)
    .where(eq(courses.archived, 0));

  return rows
    .filter((r): r is { year: number; term: Term } => isTerm(r.term))
    .sort((a, b) => termSortKey(b.year, b.term) - termSortKey(a.year, a.term));
}

/** The signed-in user's remembered courses-page filter, or null if never set. */
export async function getMyTermPreference(): Promise<{ year: number; term: Term } | null> {
  const user = await requireCapability("course.view");
  const [row] = await db
    .select({ year: users.defaultCourseYear, term: users.defaultCourseTerm })
    .from(users)
    .where(eq(users.id, user.id));

  if (!row || row.year == null || !isTerm(row.term)) return null;
  return { year: row.year, term: row.term };
}

export async function setMyTermPreference(year: number, term: Term): Promise<void> {
  const user = await requireCapability("course.view");
  await db
    .update(users)
    .set({ defaultCourseYear: year, defaultCourseTerm: term })
    .where(eq(users.id, user.id));
}

/**
 * The course whose detail page the instructor last opened.
 *
 * Scopes the global Assignments nav item so it shows one course's work
 * instead of everything at once — set by visiting any course's detail page,
 * not tied to a particular link, so every path there keeps it current.
 */
export async function setActiveCourse(courseId: number): Promise<void> {
  const user = await requireCapability("course.view");
  await db.update(users).set({ activeCourseId: courseId }).where(eq(users.id, user.id));
}

export async function getActiveCourse() {
  const user = await requireCapability("course.view");
  const [row] = await db
    .select({ activeCourseId: users.activeCourseId })
    .from(users)
    .where(eq(users.id, user.id));

  if (!row?.activeCourseId) return null;
  const [course] = await db.select().from(courses).where(eq(courses.id, row.activeCourseId));
  return course ?? null;
}

export async function createCourse(data: {
  name: string;
  code: string;
  section?: string;
  year: number;
  term: Term;
}) {
  await requireCapability("course.create");
  const result = db.insert(courses).values(data).returning();
  revalidatePath("/courses");
  return (await result)[0];
}

export async function updateCourse(
  id: number,
  data: Partial<{ name: string; code: string; section: string; year: number; term: Term }>
) {
  await requireCapability("course.edit", { kind: "course", courseId: id });
  await db.update(courses).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(courses.id, id));
  revalidatePath("/courses");
  revalidatePath(`/courses/${id}`);
}

export async function deleteCourse(id: number) {
  await requireCapability("course.edit", { kind: "course", courseId: id });
  await db.delete(courseEnrollments).where(eq(courseEnrollments.courseId, id));
  await db.delete(assignments).where(eq(assignments.courseId, id));
  await db.delete(courses).where(eq(courses.id, id));
  revalidatePath("/courses");
}

export async function archiveCourse(id: number) {
  await requireCapability("course.edit", { kind: "course", courseId: id });
  await db.update(courses).set({ archived: 1, updatedAt: new Date().toISOString() }).where(eq(courses.id, id));
  revalidatePath("/courses");
}
