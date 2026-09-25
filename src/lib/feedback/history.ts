import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { feedbackLinks, feedbackSends } from "@/db/schema";

/**
 * What has already gone out, per student. Only rows matching the current
 * test mode count (see src/lib/feedback/config.ts), so a test send never makes
 * a student look emailed.
 */

export interface LastSent {
  sentAt: string;
  fingerprint: string | null;
  testMode: boolean;
  includeRubric: boolean;
  includeAnnotations: boolean;
  includeLink: boolean;
  letterGrade: string | null;
  frameCount: number;
}

export interface LastFailure {
  sentAt: string;
  error: string | null;
}

export interface LinkState {
  expiresAt: string;
  lastViewedAt: string | null;
  viewCount: number;
}

export async function feedbackHistory(
  assignmentIds: number[],
  testMode: boolean,
): Promise<Map<string, { lastSent: LastSent | null; lastFailure: LastFailure | null; link: LinkState | null }>> {
  const out = new Map<string, { lastSent: LastSent | null; lastFailure: LastFailure | null; link: LinkState | null }>();
  if (assignmentIds.length === 0) return out;

  const rows = await db
    .select()
    .from(feedbackSends)
    .where(and(inArray(feedbackSends.assignmentId, assignmentIds), eq(feedbackSends.testMode, testMode ? 1 : 0)))
    .orderBy(desc(feedbackSends.id));

  const entry = (assignmentId: number, studentId: number) => {
    const key = `${assignmentId}:${studentId}`;
    let e = out.get(key);
    if (!e) {
      e = { lastSent: null, lastFailure: null, link: null };
      out.set(key, e);
    }
    return e;
  };

  // Newest first, so the first row seen for a student is their latest.
  const seenAttempt = new Set<string>();
  for (const r of rows) {
    const e = entry(r.assignmentId, r.studentId);
    const key = `${r.assignmentId}:${r.studentId}`;
    if (r.status === "sent" && !e.lastSent) {
      e.lastSent = {
        sentAt: r.sentAt,
        fingerprint: r.gradeFingerprint,
        testMode: r.testMode === 1,
        includeRubric: r.includeRubric === 1,
        includeAnnotations: r.includeAnnotations === 1,
        includeLink: r.includeLink === 1,
        letterGrade: r.letterGrade,
        frameCount: r.frameCount,
      };
    }
    // A failure only matters if it is the most recent attempt.
    if (!seenAttempt.has(key)) {
      seenAttempt.add(key);
      if (r.status === "failed") e.lastFailure = { sentAt: r.sentAt, error: r.error };
    }
  }

  const links = await db
    .select()
    .from(feedbackLinks)
    .where(and(inArray(feedbackLinks.assignmentId, assignmentIds), isNull(feedbackLinks.revokedAt)))
    .orderBy(desc(feedbackLinks.id));
  for (const l of links) {
    const e = entry(l.assignmentId, l.studentId);
    if (!e.link) e.link = { expiresAt: l.expiresAt, lastViewedAt: l.lastViewedAt, viewCount: l.viewCount };
  }

  return out;
}
