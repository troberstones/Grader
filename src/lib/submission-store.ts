import path from "path";
import fs from "fs/promises";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { submissions, reviewMedia } from "@/db/schema";
import { getSubmissionDir, getMediaType, getMimeType, ensureDir } from "@/lib/file-storage";

/**
 * Write one file into a student's submission folder and record it.
 *
 * What happens when the student already has a file by this name is the
 * caller's call, via `onNameClash`:
 *
 * - "replace" (the default) swaps the earlier file out in place and drops its
 *   review derivatives. That is what makes re-importing the same batch zip
 *   safe, and it is only right for a caller that is re-sending what it sent
 *   before.
 * - "add" keeps both, recording the newcomer as "name (2).ext". For anything
 *   a person hands over one file at a time: two exports both called
 *   "render.png" are two pieces, and replacing the first would also leave its
 *   annotations sitting on a different image, because the submission row —
 *   and so the strokes keyed to it — stays the same.
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
  onNameClash?: "replace" | "add";
  write: (absolutePath: string) => Promise<void>;
}): Promise<number> {
  const { assignmentId, studentId, originalName, size, onNameClash = "replace" } = opts;
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

  const theirs = await db
    .select({ id: submissions.id, filePath: submissions.filePath, fileName: submissions.fileName })
    .from(submissions)
    .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, studentId)));
  const existing = theirs.filter((s) => s.fileName === originalName);

  if (existing.length > 0 && onNameClash === "replace") {
    if (existing[0].filePath !== relPath) {
      await fs.unlink(path.join(process.cwd(), existing[0].filePath)).catch(() => {});
    }
    await db
      .update(submissions)
      .set({ filePath: relPath, fileType, fileSize: size, mediaType, submittedAt: new Date().toISOString() })
      .where(eq(submissions.id, existing[0].id));

    // The old file's derivatives no longer match what's on disk — drop the
    // rows and the files they point at. Skip the "original" variant: for a
    // submission with nothing to transcode (e.g. a PDF), that row's path *is*
    // the submission's own file, already handled by the unlink above.
    // Files go before rows: ensureIngested() does nothing while rows exist,
    // so a review page opened mid-replace can't start writing new
    // derivatives to the same s<id>.* paths that are still being unlinked.
    const oldMedia = await db
      .select({ path: reviewMedia.path, variant: reviewMedia.variant })
      .from(reviewMedia)
      .where(eq(reviewMedia.submissionId, existing[0].id));
    await Promise.all(
      oldMedia
        .filter((m) => m.variant !== "original")
        .map((m) => fs.unlink(path.join(process.cwd(), m.path)).catch(() => {})),
    );
    await db.delete(reviewMedia).where(eq(reviewMedia.submissionId, existing[0].id));
    return existing[0].id;
  }

  const recordedName = freeName(originalName, new Set(theirs.map((s) => s.fileName)));
  const [inserted] = await db
    .insert(submissions)
    .values({ assignmentId, studentId, filePath: relPath, fileName: recordedName, fileType, fileSize: size, mediaType })
    .returning({ id: submissions.id });
  return inserted.id;
}

/** `name` if nobody has it, otherwise the first of "name (2).ext", "name (3).ext"… that is free. */
export function freeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}
