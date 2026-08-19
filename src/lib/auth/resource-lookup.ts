/**
 * Resolves a `{kind:"assignment"|"submission"}` Resource from the id a caller
 * already has, for actions that only ever receive an assignmentId or
 * submissionId — not a courseId — but still need to gate on the right course.
 * Shared by grades.ts, submissions.ts, annotations.ts, and review.ts.
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, submissions, reviewMedia } from "@/db/schema";
import { GLOBAL, type Resource } from "./roles";

export async function assignmentResource(assignmentId: number): Promise<Resource> {
  const [row] = await db
    .select({ courseId: assignments.courseId })
    .from(assignments)
    .where(eq(assignments.id, assignmentId));
  return row ? { kind: "assignment", assignmentId, courseId: row.courseId } : GLOBAL;
}

export async function submissionResource(submissionId: number): Promise<Resource> {
  const [row] = await db
    .select({ courseId: assignments.courseId })
    .from(submissions)
    .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
    .where(eq(submissions.id, submissionId));
  return row ? { kind: "submission", submissionId, courseId: row.courseId } : GLOBAL;
}

/** Resolves a `{kind:"submission"}` Resource from a review_media id — only the
 * media id is available at these routes, not the submissionId directly. */
export async function reviewMediaResource(mediaId: number): Promise<Resource> {
  const [row] = await db
    .select({ submissionId: reviewMedia.submissionId, courseId: assignments.courseId })
    .from(reviewMedia)
    .innerJoin(submissions, eq(reviewMedia.submissionId, submissions.id))
    .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
    .where(eq(reviewMedia.id, mediaId));
  return row ? { kind: "submission", submissionId: row.submissionId, courseId: row.courseId } : GLOBAL;
}
