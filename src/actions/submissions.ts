"use server";

import { db } from "@/db";
import { submissions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireCapability } from "@/lib/auth/require";

/** A single row from the submissions table, as returned by Drizzle. */
export type SubmissionRow = typeof submissions.$inferSelect;

export async function getSubmission(assignmentId: number, studentId: number) {
  await requireCapability("course.view");
  const rows = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, studentId)));
  return rows[0] ?? null;
}

export async function getSubmissionsForAssignment(assignmentId: number): Promise<Record<number, SubmissionRow[]>> {
  await requireCapability("course.view");
  const rows = await db.select().from(submissions).where(eq(submissions.assignmentId, assignmentId));
  const map: Record<number, SubmissionRow[]> = {};
  for (const row of rows) {
    if (!map[row.studentId]) map[row.studentId] = [];
    map[row.studentId].push(row);
  }
  return map;
}

export async function updateSubmissionMeta(
  submissionId: number,
  data: { fps?: number; frameCount?: number; duration?: number }
) {
  await requireCapability("course.edit");
  await db.update(submissions).set(data).where(eq(submissions.id, submissionId));
}

export async function deleteSubmission(submissionId: number) {
  await requireCapability("course.edit");
  await db.delete(submissions).where(eq(submissions.id, submissionId));
}
