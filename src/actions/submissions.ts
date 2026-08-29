"use server";

import path from "path";
import fs from "fs/promises";
import { after } from "next/server";
import { db } from "@/db";
import { submissions, reviewMedia } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireCapability } from "@/lib/auth/require";
import { assignmentResource, submissionResource } from "@/lib/auth/resource-lookup";
import { getSubmissionDir, getMediaType, getMimeType, ensureDir } from "@/lib/file-storage";
import { MAX_FILE_SIZE, SEQUENCE_FRAME_EXTENSIONS } from "@/lib/constants";
import { ensureIngested } from "@/actions/review";

/** A single row from the submissions table, as returned by Drizzle. */
export type SubmissionRow = typeof submissions.$inferSelect;

export async function getSubmission(assignmentId: number, studentId: number) {
  await requireCapability("roster.view", await assignmentResource(assignmentId));
  const rows = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, studentId)));
  return rows[0] ?? null;
}

export async function getSubmissionsForAssignment(assignmentId: number): Promise<Record<number, SubmissionRow[]>> {
  await requireCapability("roster.view", await assignmentResource(assignmentId));
  const rows = await db.select().from(submissions).where(eq(submissions.assignmentId, assignmentId));
  const map: Record<number, SubmissionRow[]> = {};
  for (const row of rows) {
    if (!map[row.studentId]) map[row.studentId] = [];
    map[row.studentId].push(row);
  }
  return map;
}

export async function updateSubmissionMeta(
  submissionId: number,
  data: { fps?: number; frameCount?: number; duration?: number }
) {
  await requireCapability("course.edit", await submissionResource(submissionId));
  await db.update(submissions).set(data).where(eq(submissions.id, submissionId));
}

export async function deleteSubmission(submissionId: number) {
  await requireCapability("course.edit", await submissionResource(submissionId));
  const deleted = await db.delete(submissions).where(eq(submissions.id, submissionId)).returning();
  // review_media/annotations/strokes cascade at the DB level; the raw file (or
  // sequence directory) on disk does not, so it has to go here.
  if (deleted[0]) {
    await fs.rm(path.join(process.cwd(), deleted[0].filePath), { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Uploads one file as a student's submission, same-origin counterpart to
 * /api/submissions/upload (which stays CORS-open for the LS Bridge
 * extension and so can't carry an auth gate). Re-uploading the same
 * filename for the same student replaces the row and clears any stale
 * derivatives rather than leaving them pointing at a deleted file.
 */
export async function uploadSubmission(formData: FormData) {
  const assignmentId = Number(formData.get("assignmentId"));
  const studentId = Number(formData.get("studentId"));
  const file = formData.get("file");
  if (!assignmentId || !studentId || !(file instanceof File)) {
    throw new Error("Missing required fields.");
  }

  await requireCapability("course.edit", await assignmentResource(assignmentId));

  if (file.size > MAX_FILE_SIZE) throw new Error("File too large (max 500MB).");
  const mediaType = getMediaType(file.name);
  if (!mediaType) throw new Error(`Unsupported file type: ${path.extname(file.name) || file.name}`);

  const dir = getSubmissionDir(assignmentId, studentId);
  await ensureDir(dir);
  const ext = path.extname(file.name);
  const base = path.basename(file.name, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `${base}_${Date.now()}${ext}`;
  await fs.writeFile(path.join(dir, fileName), Buffer.from(await file.arrayBuffer()));
  const relPath = path.join("storage", "submissions", String(assignmentId), String(studentId), fileName);

  const existing = await db
    .select({ id: submissions.id, filePath: submissions.filePath })
    .from(submissions)
    .where(
      and(
        eq(submissions.assignmentId, assignmentId),
        eq(submissions.studentId, studentId),
        eq(submissions.fileName, file.name)
      )
    );

  let submissionId: number;
  if (existing.length > 0) {
    if (existing[0].filePath !== relPath) {
      await fs.unlink(path.join(process.cwd(), existing[0].filePath)).catch(() => {});
    }
    await db
      .update(submissions)
      .set({
        filePath: relPath,
        fileType: getMimeType(file.name) ?? file.type,
        fileSize: file.size,
        mediaType,
        submittedAt: new Date().toISOString(),
      })
      .where(eq(submissions.id, existing[0].id));
    // The old file's derivatives no longer match what's on disk.
    await db.delete(reviewMedia).where(eq(reviewMedia.submissionId, existing[0].id));
    submissionId = existing[0].id;
  } else {
    const [inserted] = await db
      .insert(submissions)
      .values({
        assignmentId,
        studentId,
        filePath: relPath,
        fileName: file.name,
        fileType: getMimeType(file.name) ?? file.type,
        fileSize: file.size,
        mediaType,
      })
      .returning({ id: submissions.id });
    submissionId = inserted.id;
  }

  // Ingest now, in the background, so review never pays for it later —
  // ensureIngested() is a no-op if a review page already triggered it.
  after(() => ensureIngested(submissionId).catch(() => {}));
}

/**
 * Uploads several numbered frame images as one sequence submission — the
 * browser counterpart to scripts/import-sequence.mjs. The caller has
 * already decided these files belong together (see sequencePrefix() in
 * media-drop-zone.tsx); this just validates they're frame-shaped and
 * writes them into their own subdirectory so ingestSequence() picks them
 * up as a single playable item.
 */
export async function uploadSubmissionSequence(formData: FormData) {
  const assignmentId = Number(formData.get("assignmentId"));
  const studentId = Number(formData.get("studentId"));
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (!assignmentId || !studentId || files.length < 2) {
    throw new Error("A sequence needs at least two numbered frames.");
  }

  await requireCapability("course.edit", await assignmentResource(assignmentId));

  for (const file of files) {
    const ext = path.extname(file.name).toLowerCase();
    if (!SEQUENCE_FRAME_EXTENSIONS.has(ext)) {
      throw new Error(`${file.name} isn't a frame image (${ext || "no extension"}).`);
    }
    if (file.size > MAX_FILE_SIZE) throw new Error(`${file.name} is too large (max 500MB per frame).`);
  }

  const name = `sequence_${Date.now()}`;
  const dir = path.join(getSubmissionDir(assignmentId, studentId), name);
  await ensureDir(dir);

  let bytes = 0;
  for (const file of files) {
    const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9_.-]/g, "_");
    await fs.writeFile(path.join(dir, safeName), Buffer.from(await file.arrayBuffer()));
    bytes += file.size;
  }

  const relDir = path.join("storage", "submissions", String(assignmentId), String(studentId), name);
  const [inserted] = await db
    .insert(submissions)
    .values({
      assignmentId,
      studentId,
      filePath: relDir,
      fileName: name,
      fileType: "image/x-sequence",
      fileSize: bytes,
      mediaType: "image",
      frameCount: files.length,
    })
    .returning({ id: submissions.id });

  // Ingest now, in the background, so review never pays for it later —
  // ensureIngested() is a no-op if a review page already triggered it.
  after(() => ensureIngested(inserted.id).catch(() => {}));
}
