import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { db } from "@/db";
import { submissions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSubmissionDir, getMediaType, getMimeType } from "@/lib/file-storage";
import { MAX_FILE_SIZE } from "@/lib/constants";

// Allow the LS Bridge extension to upload files directly from the LS tab
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const assignmentId = Number(formData.get("assignmentId"));
    const studentId = Number(formData.get("studentId"));

    if (!file || !assignmentId || !studentId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
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

    return NextResponse.json({ submission }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
