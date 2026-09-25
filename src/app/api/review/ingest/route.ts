import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { submissions } from "@/db/schema";
import { ensureIngested } from "@/actions/review";
import { apiRequireCapability } from "@/lib/auth/api";
import { assignmentResource, submissionResource } from "@/lib/auth/resource-lookup";
import type { Resource } from "@/lib/auth/roles";

/**
 * Warm derivatives ahead of a review session.
 *
 * Ingest also happens lazily when a student's review page opens, but the first
 * open then pays for an ffmpeg transcode. Running this over an assignment
 * beforehand means the crit never waits.
 *
 * POST /api/review/ingest {assignmentId}   → every submission in that assignment
 * POST /api/review/ingest {submissionId}   → one submission
 *
 * One of assignmentId/submissionId is required — it's also what the
 * capability check runs against, so a bare "everything, no course in
 * particular" call (which used to bypass course membership entirely) is no
 * longer accepted. The result set is always scoped to whichever resource
 * passed that check, studentId (if present) only narrows it further, so a
 * caller can never see fileNames from a submission it wasn't authorized for.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

export async function POST(request: Request) {
  let body: { assignmentId?: number; studentId?: number; submissionId?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "assignmentId or submissionId is required" }, { status: 400 });
  }

  let resource: Resource;
  if (body.submissionId) {
    resource = await submissionResource(Number(body.submissionId));
  } else if (body.assignmentId) {
    resource = await assignmentResource(Number(body.assignmentId));
  } else {
    return Response.json({ error: "assignmentId or submissionId is required" }, { status: 400 });
  }

  const auth = await apiRequireCapability("course.edit", resource, request);
  if (!auth.user) return auth.response;

  const filters = [];
  if (body.submissionId) {
    filters.push(eq(submissions.id, Number(body.submissionId)));
  } else if (body.assignmentId) {
    filters.push(eq(submissions.assignmentId, Number(body.assignmentId)));
  }
  if (body.studentId) filters.push(eq(submissions.studentId, Number(body.studentId)));

  const rows = await db
    .select({ id: submissions.id, fileName: submissions.fileName })
    .from(submissions)
    .where(and(...filters));

  const results: { id: number; file: string; ok: boolean; error?: string }[] = [];

  // Sequential on purpose: ffmpeg saturates cores on its own, and running
  // dozens of transcodes at once is how you take the machine down.
  for (const row of rows) {
    try {
      await ensureIngested(row.id);
      results.push({ id: row.id, file: row.fileName, ok: true });
    } catch (e) {
      results.push({
        id: row.id,
        file: row.fileName,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return Response.json({
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
  });
}
