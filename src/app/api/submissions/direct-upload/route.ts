import { NextRequest, NextResponse, after } from "next/server";
import path from "path";
import fs from "fs/promises";
import { db } from "@/db";
import { submissions, reviewMedia } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireCapability } from "@/lib/auth/require";
import { assignmentResource } from "@/lib/auth/resource-lookup";
import { getSubmissionDir, getMediaType, getMimeType, ensureDir } from "@/lib/file-storage";
import { MAX_FILE_SIZE, SEQUENCE_FRAME_EXTENSIONS } from "@/lib/constants";
import { ensureIngested } from "@/actions/review";

/**
 * Same-origin upload endpoint for the in-app drop zone / "+ Add" control —
 * a Route Handler rather than a Server Action.
 *
 * Server Actions run file uploads through Next's own busboy-based body
 * parser (see next/dist/server/app-render/action-handler.js), which only
 * honors `experimental.serverActions.bodySizeLimit` for individual field
 * *values* (busboy's `fieldSize` limit), not for the request body as a
 * whole — in this Next 16.2.1 build, multipart bodies over ~10MB abort
 * mid-parse with a bare "Unexpected end of form" from busboy, regardless of
 * that config. A single EXR frame or two slides under that; any real
 * sequence (or a large video) does not. Route Handlers read the body via
 * the Fetch API's `request.formData()` directly and aren't subject to it,
 * which is also why the CORS-open /api/submissions/upload (for the LS
 * Bridge extension) already worked fine at any size — this mirrors that,
 * with the auth gate that route deliberately can't carry.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const assignmentId = Number(formData.get("assignmentId"));
    const studentId = Number(formData.get("studentId"));
    const files = formData.getAll("files").filter((f): f is File => f instanceof File);
    const singleFile = formData.get("file");

    if (files.length > 0) {
      await uploadSequence(assignmentId, studentId, files);
    } else if (singleFile instanceof File) {
      await uploadSingle(assignmentId, studentId, singleFile);
    } else {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    const status =
      message === "Sign in required."
        ? 401
        : message === "You do not have permission to do that."
          ? 403
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

async function uploadSingle(assignmentId: number, studentId: number, file: File) {
  if (!assignmentId || !studentId) throw new Error("Missing required fields.");

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

async function uploadSequence(assignmentId: number, studentId: number, files: File[]) {
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
