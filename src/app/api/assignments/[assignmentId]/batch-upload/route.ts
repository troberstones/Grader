import { NextRequest, NextResponse, after } from "next/server";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, courseEnrollments, students } from "@/db/schema";
import { requireCapability } from "@/lib/auth/require";
import { assignmentResource } from "@/lib/auth/resource-lookup";
import { writeAudit } from "@/lib/audit";
import { detectImporter, isJunkEntry, type RosterEntry } from "@/lib/batch-import";
import {
  classifySource,
  ingestForStudent,
  listEntries,
  openZip,
  type IngestOutcome,
  type IngestSource,
} from "@/lib/batch-import/ingest";
import { stagePending, sweepPending } from "@/lib/batch-import/pending";
import { ensureIngested } from "@/actions/review";

export interface BatchUploadResult {
  format: string;
  imported: { studentName: string; fileName: string }[];
  /**
   * Files no roster student could be matched to, kept on the server under
   * `token` until the instructor assigns them (see ./assign).
   */
  unmatched: { token: string; fileName: string }[];
  /** Not something review can show (a .blend, …), too large, or encrypted. */
  skipped: { fileName: string; reason: string }[];
  /** The course roster, for assigning unmatched files. */
  roster: { studentId: number; name: string }[];
}

/**
 * Accepts an LMS "download all submissions" zip for one assignment and files
 * each entry under the student it belongs to. Which LMS made the zip is
 * detected from its file names (see src/lib/batch-import). A zip that no
 * format recognizes still uploads: every file comes back unmatched, for the
 * instructor to assign by hand.
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
      .where(eq(courseEnrollments.courseId, assignment.courseId))
      .orderBy(asc(students.sortName));

    await sweepPending();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "grader-batch-"));
    const zipPath = path.join(tmpDir, "upload.zip");
    await pipeline(Readable.fromWeb(request.body as NodeReadableStream), createWriteStream(zipPath));

    const zip = await openZip(zipPath);
    try {
      const entries = await listEntries(zip);
      const importer = detectImporter(entries.map((e) => e.fileName), roster);

      const nameById = new Map(roster.map((s) => [s.studentId, s.name]));
      const out: IngestOutcome = { imported: [], skipped: [], submissionIds: [] };
      const unmatched: BatchUploadResult["unmatched"] = [];

      for (const entry of entries) {
        if (isJunkEntry(entry.fileName)) continue;
        if (entry.isEncrypted()) {
          out.skipped.push({ fileName: entry.fileName, reason: "encrypted" });
          continue;
        }
        const match = importer?.match(entry.fileName, roster) ?? null;
        const base = path.posix.basename(entry.fileName);
        const src: IngestSource = {
          name: match?.fileName ?? base,
          size: entry.uncompressedSize,
          open: () => zip.openReadStreamPromise(entry),
        };

        if (match) {
          await ingestForStudent(src, { assignmentId, studentId: match.studentId, tmpDir, out, label: entry.fileName });
          continue;
        }
        // Only worth keeping for assignment if review could use it once assigned.
        if (!(await classifySource(src))) {
          out.skipped.push({ fileName: base, reason: "no matching student, and not a file type review can show" });
          continue;
        }
        const token = await stagePending(assignmentId, base, async (abs) =>
          pipeline(await src.open(), createWriteStream(abs)),
        );
        unmatched.push({ token, fileName: base });
      }

      if (out.imported.length === 0 && unmatched.length === 0) {
        return NextResponse.json(
          { error: "Nothing in this zip is a file review can show.", skipped: out.skipped },
          { status: 400 },
        );
      }

      const result: BatchUploadResult = {
        format: importer?.label ?? "zip with no recognized naming",
        imported: out.imported.map((i) => ({ studentName: nameById.get(i.studentId) ?? "", fileName: i.fileName })),
        unmatched,
        skipped: out.skipped,
        roster: roster.map((s) => ({ studentId: s.studentId, name: s.name })),
      };

      await writeAudit(user, {
        action: "submission.batch_import",
        targetType: "assignment",
        targetId: assignmentId,
        detail: { format: importer?.id ?? null, imported: result.imported.length, unmatched: unmatched.length },
      });

      // One at a time: a class's worth of video transcoding at once would
      // starve the server that's also serving the review page.
      const submissionIds = [...new Set(out.submissionIds)];
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
