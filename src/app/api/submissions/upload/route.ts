/**
 * POST /api/submissions/upload?assignmentId=N&studentId=N
 *
 * Called by the LS Bridge extension's background service worker — see
 * ls-bridge-extension/background.js. That request is cross-origin by
 * construction (Learning Suite's own tab origin, relayed through the
 * extension's service worker, whose fetches carry `Origin:
 * chrome-extension://<id>`), so it now requires both a normal grader session
 * (`course.edit` on the target assignment) and membership on
 * ALLOWED_EXTENSION_ORIGINS to get past apiRequireCapability's cross-origin
 * check — see docs/security.md and src/lib/auth/api.ts.
 *
 * assignmentId/studentId travel as query parameters rather than form fields
 * specifically so the capability check, the assignment lookup, and the
 * enrollment check can all run *before* request.formData() reads the file
 * into memory — an unauthorized or oversized request never pays for that
 * parse.
 */

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { db } from "@/db";
import { assignments, courseEnrollments, submissions, reviewMedia } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSubmissionDir, getMediaType, getMimeType } from "@/lib/file-storage";
import { MAX_FILE_SIZE } from "@/lib/constants";
import { apiRequireCapability } from "@/lib/auth/api";
import { assignmentResource } from "@/lib/auth/resource-lookup";

export async function POST(request: NextRequest) {
  const assignmentId = Number(request.nextUrl.searchParams.get("assignmentId"));
  const studentId = Number(request.nextUrl.searchParams.get("studentId"));
  if (!assignmentId || !studentId) {
    return NextResponse.json({ error: "assignmentId and studentId are required" }, { status: 400 });
  }

  // Reject an oversized body by its declared Content-Length before reading
  // any of it — a real 500MB file plus multipart overhead never gets close
  // to this, so it only ever catches a request that couldn't be legitimate.
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_FILE_SIZE * 2) {
    return NextResponse.json({ error: "File too large (max 500MB)" }, { status: 413 });
  }

  const auth = await apiRequireCapability("course.edit", await assignmentResource(assignmentId), request);
  if (!auth.user) return auth.response;

  let writtenPath: string | null = null;
  try {
    const [assignment] = await db
      .select({ courseId: assignments.courseId })
      .from(assignments)
      .where(eq(assignments.id, assignmentId));
    if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

    const [enrolled] = await db
      .select({ id: courseEnrollments.id })
      .from(courseEnrollments)
      .where(and(eq(courseEnrollments.courseId, assignment.courseId), eq(courseEnrollments.studentId, studentId)));
    if (!enrolled) {
      return NextResponse.json({ error: "Student is not enrolled in this course" }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File too large (max 500MB)" }, { status: 400 });
    }

    const mediaType = getMediaType(file.name);
    if (!mediaType) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }

    // Save file to disk
    const dir = getSubmissionDir(assignmentId, studentId);
    await fs.mkdir(dir, { recursive: true });

    // Use a sanitised filename with timestamp to avoid collisions
    const ext = path.extname(file.name);
    const base = path.basename(file.name, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileName = `${base}_${Date.now()}${ext}`;
    const absolutePath = path.join(dir, fileName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(absolutePath, buffer);
    writtenPath = absolutePath;

    // Relative path from project root for storage in DB
    const relPath = path.join("storage", "submissions", String(assignmentId), String(studentId), fileName);

    // Deduplicate by original filename — re-syncing the same file replaces it,
    // but submitting a different file adds a new record (supports multi-file students).
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

    let submission;
    if (existing.length > 0) {
      // Replace the file on disk if it changed
      if (existing[0].filePath !== relPath) {
        const oldAbs = path.join(process.cwd(), existing[0].filePath);
        await fs.unlink(oldAbs).catch(() => {});
      }
      const updated = await db
        .update(submissions)
        .set({
          filePath: relPath,
          fileType: getMimeType(file.name) ?? file.type,
          fileSize: file.size,
          mediaType,
          submittedAt: new Date().toISOString(),
        })
        .where(eq(submissions.id, existing[0].id))
        .returning();
      submission = updated[0];
      // The old file's derivatives no longer match what's on disk.
      await db.delete(reviewMedia).where(eq(reviewMedia.submissionId, existing[0].id));
    } else {
      const inserted = await db
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
        .returning();
      submission = inserted[0];
    }

    return NextResponse.json({ submission });
  } catch (err) {
    // The file may have already landed on disk before the DB write that
    // records it failed — an orphan nothing would ever clean up otherwise.
    if (writtenPath) await fs.unlink(writtenPath).catch(() => {});
    console.error("[submissions/upload]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
