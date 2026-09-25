import { NextRequest, NextResponse, after } from "next/server";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import { eq } from "drizzle-orm";
import yauzl from "yauzl";

import { db } from "@/db";
import { assignments, courseEnrollments, students } from "@/db/schema";
import { requireCapability } from "@/lib/auth/require";
import { assignmentResource } from "@/lib/auth/resource-lookup";
import { writeAudit } from "@/lib/audit";
import { MAX_FILE_SIZE } from "@/lib/constants";
import { getMediaType } from "@/lib/file-storage";
import { storeSubmissionFile } from "@/lib/submission-store";
import { detectImporter, isJunkEntry, type RosterEntry } from "@/lib/batch-import";
import { ensureIngested } from "@/actions/review";

export interface BatchUploadResult {
  format: string;
  imported: { studentName: string; fileName: string }[];
  /** Files no roster student could be matched to. */
  unmatched: string[];
  /** Matched, but not something review can show (a .blend, a nested zip, …) or too large. */
  skipped: { fileName: string; reason: string }[];
}

/**
 * Accepts an LMS "download all submissions" zip for one assignment and files
 * each entry under the student it belongs to. Which LMS made the zip is
 * detected from its file names (see src/lib/batch-import).
 *
 * The zip arrives as the raw request body rather than multipart form data:
 * these bundles are routinely several GB of video, and `request.formData()`
 * would hold all of it in memory. Instead the body is streamed to a temp file,
 * and yauzl reads the zip's directory from disk and extracts one entry at a
 * time straight into the student's folder.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ assignmentId: string }> }) {
  const assignmentId = Number((await params).assignmentId);
  let tmpDir: string | null = null;

  try {
    const user = await requireCapability("course.edit", await assignmentResource(assignmentId));
    if (!request.body) return NextResponse.json({ error: "Choose a zip file." }, { status: 400 });

    const [assignment] = await db
      .select({ courseId: assignments.courseId })
      .from(assignments)
      .where(eq(assignments.id, assignmentId));
    if (!assignment) return NextResponse.json({ error: "Assignment not found." }, { status: 404 });

    const roster: RosterEntry[] = await db
      .select({ studentId: students.id, netId: students.netId, name: students.name, sortName: students.sortName })
      .from(courseEnrollments)
      .innerJoin(students, eq(students.id, courseEnrollments.studentId))
      .where(eq(courseEnrollments.courseId, assignment.courseId));

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "grader-batch-"));
    const zipPath = path.join(tmpDir, "upload.zip");
    await pipeline(Readable.fromWeb(request.body as NodeReadableStream), createWriteStream(zipPath));

    const zip = await openZip(zipPath);
    try {
      const entries = await listEntries(zip);
      const importer = detectImporter(entries.map((e) => e.fileName), roster);
      if (!importer) {
        return NextResponse.json(
          {
            error:
              "Couldn't match any file in this zip to a student on the roster. " +
              "It may be a format this app doesn't read yet, or the roster may be missing net IDs.",
          },
          { status: 400 },
        );
      }

      const nameById = new Map(roster.map((s) => [s.studentId, s.name]));
      const result: BatchUploadResult = { format: importer.label, imported: [], unmatched: [], skipped: [] };
      const submissionIds: number[] = [];

      for (const entry of entries) {
        if (isJunkEntry(entry.fileName)) continue;
        const match = importer.match(entry.fileName, roster);
        if (!match) {
          result.unmatched.push(path.posix.basename(entry.fileName));
          continue;
        }
        if (!getMediaType(match.fileName)) {
          result.skipped.push({ fileName: entry.fileName, reason: "unsupported file type" });
          continue;
        }
        if (entry.uncompressedSize > MAX_FILE_SIZE) {
          result.skipped.push({ fileName: entry.fileName, reason: "larger than 500MB" });
          continue;
        }
        if (entry.isEncrypted()) {
          result.skipped.push({ fileName: entry.fileName, reason: "encrypted" });
          continue;
        }

        const id = await storeSubmissionFile({
          assignmentId,
          studentId: match.studentId,
          originalName: match.fileName,
          size: entry.uncompressedSize,
          write: async (abs) => pipeline(await zip.openReadStreamPromise(entry), createWriteStream(abs)),
        });
        submissionIds.push(id);
        result.imported.push({ studentName: nameById.get(match.studentId) ?? "", fileName: match.fileName });
      }

      await writeAudit(user, {
        action: "submission.batch_import",
        targetType: "assignment",
        targetId: assignmentId,
        detail: { format: importer.id, imported: result.imported.length, unmatched: result.unmatched.length },
      });

      // One at a time: a class's worth of video transcoding at once would
      // starve the server that's also serving the review page.
      after(async () => {
        for (const id of submissionIds) await ensureIngested(id).catch(() => {});
      });

      return NextResponse.json(result);
    } finally {
      zip.close();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed.";
    const status =
      message === "Sign in required." ? 401 : message === "You do not have permission to do that." ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  } finally {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err) reject(new Error("That file isn't a readable zip."));
      else resolve(zip);
    });
  });
}

function listEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    zip.on("entry", (entry: yauzl.Entry) => {
      entries.push(entry);
      zip.readEntry();
    });
    zip.on("end", () => resolve(entries));
    zip.on("error", reject);
    zip.readEntry();
  });
}
