"use server";

/**
 * The read-only feedback page's data, authorized by a feedback link token
 * instead of a session (src/lib/feedback/links.ts). Read-only by construction:
 * there is no write here at all, so a link holder cannot add, move or delete a
 * stroke however the page is tampered with.
 *
 * Every call re-resolves the token, so revoking a link or reaching the end of
 * the term cuts off an already-open page on its next request.
 */

import { and, asc, eq, isNull, max, sql } from "drizzle-orm";
import type { FrameMarker, ReviewItem } from "@grader/art-review";

import { db } from "@/db";
import { reviewStrokes, submissions } from "@/db/schema";
import { resolveFeedbackLink, type ResolvedLink } from "@/lib/feedback/links";
import { buildReviewItems } from "@/lib/review-items";
import type { StoredStrokeRow } from "./review";

async function requireLink(token: string): Promise<ResolvedLink> {
  const link = await resolveFeedbackLink(token);
  if (!link) throw new Error("This feedback link has expired or been replaced.");
  return link;
}

/** `sub:{id}` → the id, but only if that submission is the link's student's work for the link's assignment. */
async function requireItem(link: ResolvedLink, itemId: string): Promise<void> {
  const m = /^sub:(\d+)$/.exec(itemId);
  if (!m) throw new Error("Not found.");
  const [sub] = await db
    .select({ assignmentId: submissions.assignmentId, studentId: submissions.studentId })
    .from(submissions)
    .where(eq(submissions.id, Number(m[1])));
  if (!sub || sub.assignmentId !== link.assignmentId || sub.studentId !== link.studentId) throw new Error("Not found.");
}

export async function feedbackReviewItems(token: string): Promise<ReviewItem[]> {
  const link = await requireLink(token);
  const subs = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.assignmentId, link.assignmentId), eq(submissions.studentId, link.studentId)))
    .orderBy(asc(submissions.id));
  return buildReviewItems(subs, token);
}

export async function feedbackStrokes(
  token: string,
  itemId: string,
): Promise<{ strokes: StoredStrokeRow[]; deleted: number[]; head: number }> {
  await requireItem(await requireLink(token), itemId);
  const rows = await db
    .select()
    .from(reviewStrokes)
    .where(and(eq(reviewStrokes.itemId, itemId), isNull(reviewStrokes.deletedAt)))
    .orderBy(asc(reviewStrokes.seq));
  const [headRow] = await db
    .select({ head: max(reviewStrokes.seq) })
    .from(reviewStrokes)
    .where(eq(reviewStrokes.itemId, itemId));
  return {
    strokes: rows.map((r) => ({
      id: r.id,
      seq: r.seq,
      localId: r.localId,
      frameIn: r.frameIn,
      frameOut: r.frameOut,
      authorId: r.authorId,
      b: Buffer.from(r.data as Buffer).toString("base64"),
      createdAt: r.createdAt,
    })),
    deleted: [],
    head: headRow?.head ?? 0,
  };
}

export async function feedbackMarkers(token: string, itemId: string): Promise<FrameMarker[]> {
  await requireItem(await requireLink(token), itemId);
  const rows = await db
    .select({
      frameIn: reviewStrokes.frameIn,
      frameOut: max(reviewStrokes.frameOut),
      count: sql<number>`count(*)`,
    })
    .from(reviewStrokes)
    .where(and(eq(reviewStrokes.itemId, itemId), isNull(reviewStrokes.deletedAt)))
    .groupBy(reviewStrokes.frameIn)
    .orderBy(asc(reviewStrokes.frameIn));
  return rows.map((r) => ({ frameIn: r.frameIn, frameOut: r.frameOut ?? r.frameIn, count: Number(r.count) }));
}
