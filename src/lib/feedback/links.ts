import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { courses, assignments, feedbackLinks, submissions } from "@/db/schema";
import { generateToken, hashToken, isExpired, sqlTimestamp } from "@/lib/auth/tokens";
import { termEndDate } from "@/lib/terms";

/**
 * Read-only feedback links: one student, one assignment, until the end of the
 * course's term. There are no student accounts yet (docs/student-accounts-
 * plan.md), so the token *is* the access — same handling as upload links:
 * only the SHA-256 is stored, and issuing a new one revokes the old.
 *
 * The token grants exactly one thing: that student's feedback and their own
 * submissions for that assignment (see linkCoversSubmission). Every route that
 * serves media to a link holder checks through here.
 */

/** A link sent after the term already ended (grading late, a copied course) still gets two weeks. */
const MIN_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

export async function issueFeedbackLink(
  assignmentId: number,
  studentId: number,
  createdBy: number,
): Promise<{ token: string; expiresAt: Date }> {
  const [row] = await db
    .select({ year: courses.year, term: courses.term })
    .from(assignments)
    .innerJoin(courses, eq(assignments.courseId, courses.id))
    .where(eq(assignments.id, assignmentId));
  if (!row) throw new Error("No such assignment.");

  const termEnd = termEndDate(row.year, row.term);
  const floor = new Date(Date.now() + MIN_LIFETIME_MS);
  const expiresAt = termEnd > floor ? termEnd : floor;

  await db
    .update(feedbackLinks)
    .set({ revokedAt: sqlTimestamp(new Date()) })
    .where(
      and(
        eq(feedbackLinks.assignmentId, assignmentId),
        eq(feedbackLinks.studentId, studentId),
        isNull(feedbackLinks.revokedAt),
      ),
    );

  const token = generateToken();
  await db.insert(feedbackLinks).values({
    assignmentId,
    studentId,
    tokenHash: hashToken(token),
    createdBy,
    expiresAt: sqlTimestamp(expiresAt),
  });
  return { token, expiresAt };
}

export interface ResolvedLink {
  id: number;
  assignmentId: number;
  studentId: number;
  expiresAt: string;
}

/** The live link for this token, or null if unknown, revoked or expired. */
export async function resolveFeedbackLink(token: string | null | undefined): Promise<ResolvedLink | null> {
  if (!token || token.length > 128) return null;
  const [link] = await db.select().from(feedbackLinks).where(eq(feedbackLinks.tokenHash, hashToken(token)));
  if (!link || link.revokedAt || isExpired(link.expiresAt)) return null;
  return { id: link.id, assignmentId: link.assignmentId, studentId: link.studentId, expiresAt: link.expiresAt };
}

/** Does this link grant access to this submission? Only the student's own work for this assignment. */
export async function linkCoversSubmission(link: ResolvedLink, submissionId: number): Promise<boolean> {
  const [sub] = await db
    .select({ assignmentId: submissions.assignmentId, studentId: submissions.studentId })
    .from(submissions)
    .where(eq(submissions.id, submissionId));
  return !!sub && sub.assignmentId === link.assignmentId && sub.studentId === link.studentId;
}

/** So the professor can see the student actually opened it. */
export async function recordLinkView(linkId: number): Promise<void> {
  await db
    .update(feedbackLinks)
    .set({ lastViewedAt: sqlTimestamp(new Date()), viewCount: sql`${feedbackLinks.viewCount} + 1` })
    .where(eq(feedbackLinks.id, linkId));
}

/**
 * For media routes: does the request carry a feedback link (`?ft=`) that
 * covers this submission? Checked only after the normal session check fails,
 * so a signed-in instructor's requests never depend on it.
 */
export async function feedbackTokenAllows(request: Request, submissionId: number): Promise<boolean> {
  const link = await resolveFeedbackLink(new URL(request.url).searchParams.get("ft"));
  return !!link && (await linkCoversSubmission(link, submissionId));
}
