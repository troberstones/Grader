/**
 * Resolves a `{kind:"assignment"|"submission"}` Resource from the id a caller
 * already has, for actions that only ever receive an assignmentId or
 * submissionId — not a courseId — but still need to gate on the right course.
 * Shared by grades.ts, submissions.ts, annotations.ts, and review.ts.
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, submissions } from "@/db/schema";
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
