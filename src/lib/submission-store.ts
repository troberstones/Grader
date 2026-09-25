import path from "path";
import fs from "fs/promises";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { submissions, reviewMedia } from "@/db/schema";
import { getSubmissionDir, getMediaType, getMimeType, ensureDir } from "@/lib/file-storage";

/**
 * Write one file into a student's submission folder and record it.
 *
 * Deduplicates by original file name: uploading a file with the same name
 * again replaces the earlier one (and drops its review derivatives), while a
 * differently named file adds another submission. That makes re-importing
 * the same batch zip safe.
 *
 * `write` receives the absolute destination path and must create the file
 * there — a Buffer for a form upload, a stream for a zip entry.
 *
 * Caller is responsible for authorization and for checking size/type first.
 */
export async function storeSubmissionFile(opts: {
  assignmentId: number;
  studentId: number;
  originalName: string;
  size: number;
  fallbackMime?: string;
  write: (absolutePath: string) => Promise<void>;
}): Promise<number> {
  const { assignmentId, studentId, originalName, size } = opts;
  const mediaType = getMediaType(originalName);
  if (!mediaType) throw new Error(`Unsupported file type: ${path.extname(originalName) || originalName}`);

  const dir = getSubmissionDir(assignmentId, studentId);
  await ensureDir(dir);
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `${base}_${Date.now()}${ext}`;
  await opts.write(path.join(dir, fileName));
  const relPath = path.join("storage", "submissions", String(assignmentId), String(studentId), fileName);
  const fileType = getMimeType(originalName) ?? opts.fallbackMime ?? "application/octet-stream";

  const existing = await db
    .select({ id: submissions.id, filePath: submissions.filePath })
    .from(submissions)
    .where(
      and(
        eq(submissions.assignmentId, assignmentId),
        eq(submissions.studentId, studentId),
        eq(submissions.fileName, originalName)
      )
    );

  if (existing.length > 0) {
    if (existing[0].filePath !== relPath) {
      await fs.unlink(path.join(process.cwd(), existing[0].filePath)).catch(() => {});
    }
    await db
      .update(submissions)
      .set({ filePath: relPath, fileType, fileSize: size, mediaType, submittedAt: new Date().toISOString() })
      .where(eq(submissions.id, existing[0].id));

    // The old file's derivatives no longer match what's on disk — drop the
    // rows and the files they point at. Read the paths before deleting the
    // rows, and skip the "original" variant: for a submission with nothing
    // to transcode (e.g. a PDF), that row's path *is* the submission's own
    // file, already handled by the unlink above, not a derivative to remove.
    const oldMedia = await db
      .select({ path: reviewMedia.path, variant: reviewMedia.variant })
      .from(reviewMedia)
      .where(eq(reviewMedia.submissionId, existing[0].id));
    await db.delete(reviewMedia).where(eq(reviewMedia.submissionId, existing[0].id));
    await Promise.all(
      oldMedia
        .filter((m) => m.variant !== "original")
        .map((m) => fs.unlink(path.join(process.cwd(), m.path)).catch(() => {})),
    );
    return existing[0].id;
  }

  const [inserted] = await db
    .insert(submissions)
    .values({ assignmentId, studentId, filePath: relPath, fileName: originalName, fileType, fileSize: size, mediaType })
    .returning({ id: submissions.id });
  return inserted.id;
}
