import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { submissions } from "@/db/schema";
import { ensureIngested } from "@/actions/review";
import { apiRequireCapability } from "@/lib/auth/api";

/**
 * Warm derivatives ahead of a review session.
 *
 * Ingest also happens lazily when a student's review page opens, but the first
 * open then pays for an ffmpeg transcode. Running this over an assignment
 * beforehand means the crit never waits.
 *
 * POST /api/review/ingest            → every submission
 * POST /api/review/ingest {assignmentId} → one assignment
 */

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

export async function POST(request: Request) {
  const auth = await apiRequireCapability("course.edit");
  if (!auth.user) return auth.response;

  let body: { assignmentId?: number; studentId?: number } = {};
  try {
    body = await request.json();
  } catch {
    // No body means "everything".
  }

  const filters = [];
  if (body.assignmentId) filters.push(eq(submissions.assignmentId, body.assignmentId));
  if (body.studentId) filters.push(eq(submissions.studentId, body.studentId));

  const rows = await db
    .select({ id: submissions.id, fileName: submissions.fileName })
    .from(submissions)
    .where(filters.length ? and(...filters) : undefined);

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
