"use server";

import { db } from "@/db";
import { courses, assignments, courseEnrollments } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function getCourses(includeArchived = false) {
  const query = includeArchived
    ? db.select().from(courses).orderBy(desc(courses.createdAt))
    : db.select().from(courses).where(eq(courses.archived, 0)).orderBy(desc(courses.createdAt));
  return query;
}

export async function getCourse(id: number) {
  const result = await db.select().from(courses).where(eq(courses.id, id));
  return result[0] || null;
}

export async function createCourse(data: {
  name: string;
  code: string;
  section?: string;
  semester: string;
}) {
  const result = db.insert(courses).values(data).returning();
  revalidatePath("/courses");
  return (await result)[0];
}

export async function updateCourse(
  id: number,
  data: Partial<{ name: string; code: string; section: string; semester: string }>
) {
  await db.update(courses).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(courses.id, id));
  revalidatePath("/courses");
  revalidatePath(`/courses/${id}`);
}

export async function deleteCourse(id: number) {
  await db.delete(courseEnrollments).where(eq(courseEnrollments.courseId, id));
  await db.delete(assignments).where(eq(assignments.courseId, id));
  await db.delete(courses).where(eq(courses.id, id));
  revalidatePath("/courses");
}

export async function archiveCourse(id: number) {
  await db.update(courses).set({ archived: 1, updatedAt: new Date().toISOString() }).where(eq(courses.id, id));
  revalidatePath("/courses");
}
