import { NextRequest, NextResponse, after } from "next/server";
import path from "path";
import fs from "fs/promises";
import { db } from "@/db";
import { submissions } from "@/db/schema";
import { requireCapability } from "@/lib/auth/require";
import { apiRequireCapability } from "@/lib/auth/api";
import { assignmentResource } from "@/lib/auth/resource-lookup";
import { getSubmissionDir, getMediaType, ensureDir } from "@/lib/file-storage";
import { storeSubmissionFile } from "@/lib/submission-store";
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
 * which is also why /api/submissions/upload (for the LS Bridge extension)
 * already worked fine at any size — this mirrors that, with the auth gate
 * that route deliberately can't carry.
 *
 * assignmentId/studentId are form fields here (the client, src/lib/media-
 * upload.ts, isn't part of this sweep), so the resource-specific capability
 * check still can't run until formData() has been read. What *can* run
 * first — a coarse "is this even a signed-in instructor/assistant" gate,
 * the Content-Length precheck, and the cross-origin check baked into
 * apiRequireCapability — all happen before that parse.
 */
export async function POST(request: NextRequest) {
  const coarseAuth = await apiRequireCapability("course.edit", undefined, request);
  if (!coarseAuth.user) return coarseAuth.response;

  // Sanity ceiling on the whole multipart body before parsing it — a
  // sequence upload carries many frames, each already capped at
  // MAX_FILE_SIZE below, so this only rejects a body too large to be any
  // legitimate request.
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_FILE_SIZE * 200) {
    return NextResponse.json({ error: "Upload too large." }, { status: 413 });
  }

  try {
    const formData = await request.formData();
    const assignmentId = Number(formData.get("assignmentId"));
    const studentId = Number(formData.get("studentId"));
    const files = formData.getAll("files").filter((f): f is File => f instanceof File);
    const singleFile = formData.get("file");

    let submissionId: number;
    if (files.length > 0) {
      submissionId = await uploadSequence(assignmentId, studentId, files);
    } else if (singleFile instanceof File) {
      submissionId = await uploadSingle(assignmentId, studentId, singleFile);
    } else {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, submissionId });
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

async function uploadSingle(assignmentId: number, studentId: number, file: File): Promise<number> {
  if (!assignmentId || !studentId) throw new Error("Missing required fields.");

  await requireCapability("course.edit", await assignmentResource(assignmentId));

  if (file.size > MAX_FILE_SIZE) throw new Error("File too large (max 500MB).");
  if (!getMediaType(file.name)) throw new Error(`Unsupported file type: ${path.extname(file.name) || file.name}`);

  const submissionId = await storeSubmissionFile({
    assignmentId,
    studentId,
    originalName: file.name,
    size: file.size,
    fallbackMime: file.type,
    write: async (abs) => fs.writeFile(abs, Buffer.from(await file.arrayBuffer())),
  });

  // Ingest now, in the background, so review never pays for it later —
  // ensureIngested() is a no-op if a review page already triggered it.
  after(() => ensureIngested(submissionId).catch(() => {}));
  return submissionId;
}

async function uploadSequence(assignmentId: number, studentId: number, files: File[]): Promise<number> {
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
  return inserted.id;
}
