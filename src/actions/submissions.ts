"use server";

import { db } from "@/db";
import { submissions } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/** A single row from the submissions table, as returned by Drizzle. */
export type SubmissionRow = typeof submissions.$inferSelect;

export async function getSubmission(assignmentId: number, studentId: number) {
  const rows = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, studentId)));
  return rows[0] ?? null;
}

export async function getSubmissionsForAssignment(assignmentId: number) {
  return db.select().from(submissions).where(eq(submissions.assignmentId, assignmentId));
}

export async function updateSubmissionMeta(
  submissionId: number,
  data: { fps?: number; frameCount?: number; duration?: number }
) {
  await db.update(submissions).set(data).where(eq(submissions.id, submissionId));
}

export async function deleteSubmission(submissionId: number) {
  await db.delete(submissions).where(eq(submissions.id, submissionId));
}
