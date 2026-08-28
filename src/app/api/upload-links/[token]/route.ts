import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, auditLog, courseEnrollments, submissions, reviewMedia, uploadLinks } from "@/db/schema";
import { getSubmissionDir, getMediaType, getMimeType } from "@/lib/file-storage";
import { MAX_FILE_SIZE } from "@/lib/constants";
import { hashToken, isExpired } from "@/lib/auth/tokens";

/**
 * Accepts a submission through a token issued by src/actions/upload-links.ts,
 * instead of a session. The assignment (and, for a per-student link, the
 * student) come from the token row in the database — never from the request
 * body — so a link cannot be redirected at a different assignment/student by
 * editing form fields. A shared link (no bound student) must name which
 * enrolled student it's for; that's the one thing this route trusts from the
 * client, same trust boundary as a student typing their own name on a paper
 * sign-in sheet.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    const [link] = await db
      .select({
        id: uploadLinks.id,
        studentId: uploadLinks.studentId,
        expiresAt: uploadLinks.expiresAt,
        revokedAt: uploadLinks.revokedAt,
        assignmentId: assignments.id,
        courseId: assignments.courseId,
        archived: assignments.archived,
      })
      .from(uploadLinks)
      .innerJoin(assignments, eq(assignments.id, uploadLinks.assignmentId))
      .where(eq(uploadLinks.tokenHash, hashToken(token)))
      .limit(1);

    if (!link || link.revokedAt || isExpired(link.expiresAt) || link.archived) {
      return NextResponse.json({ error: "This upload link is no longer valid." }, { status: 410 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    let studentId = link.studentId;
    if (studentId == null) {
      const requestedId = Number(formData.get("studentId"));
      if (!requestedId) return NextResponse.json({ error: "Select your name." }, { status: 400 });
      const [enrolled] = await db
        .select({ studentId: courseEnrollments.studentId })
        .from(courseEnrollments)
        .where(and(eq(courseEnrollments.courseId, link.courseId), eq(courseEnrollments.studentId, requestedId)));
      if (!enrolled) return NextResponse.json({ error: "That student is not on this course's roster." }, { status: 400 });
      studentId = requestedId;
    }

    if (!file) {
      return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File too large (max 500MB)" }, { status: 400 });
    }

    const mediaType = getMediaType(file.name);
    if (!mediaType) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }

    const assignmentId = link.assignmentId;
    const dir = getSubmissionDir(assignmentId, studentId);
    await fs.mkdir(dir, { recursive: true });

    const ext = path.extname(file.name);
    const base = path.basename(file.name, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileName = `${base}_${Date.now()}${ext}`;
    const absolutePath = path.join(dir, fileName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(absolutePath, buffer);

    const relPath = path.join("storage", "submissions", String(assignmentId), String(studentId), fileName);

    const existing = await db
      .select({ id: submissions.id, filePath: submissions.filePath })
      .from(submissions)
      .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, studentId), eq(submissions.fileName, file.name)));

    let submission;
    if (existing.length > 0) {
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

    // No signed-in actor here — writeAudit() assumes one, so this is inserted
    // directly with a null actorId rather than pointing it at a fake user row.
    try {
      await db.insert(auditLog).values({
        actorId: null,
        actorEmail: "upload-link",
        action: "upload_link.use",
        targetType: "assignment",
        targetId: assignmentId,
        detail: JSON.stringify({ linkId: link.id, studentId, fileName: file.name }),
      });
    } catch (err) {
      console.error("[audit] write failed:", err);
    }

    return NextResponse.json({ submission });
  } catch (err) {
    console.error("Upload-link upload error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: 500 });
  }
}
