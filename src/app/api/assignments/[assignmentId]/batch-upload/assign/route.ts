import { NextRequest, NextResponse, after } from "next/server";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, courseEnrollments, students } from "@/db/schema";
import { requireCapability } from "@/lib/auth/require";
import { assignmentResource } from "@/lib/auth/resource-lookup";
import { writeAudit } from "@/lib/audit";
import { fileSource, ingestForStudent, type IngestOutcome } from "@/lib/batch-import/ingest";
import { readPending, removePending } from "@/lib/batch-import/pending";
import { ensureIngested } from "@/actions/review";

export interface BatchAssignResult {
  studentName: string;
  imported: string[];
  skipped: { fileName: string; reason: string }[];
}

/**
 * Files one unmatched file from a zip upload (staged by ../route.ts) under
 * the student the instructor picked. A zip is unpacked into that student,
 * same as a matched one would have been.
 *
 * Body: { token: string, studentId: number }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ assignmentId: string }> }) {
  const assignmentId = Number((await params).assignmentId);
  let tmpDir: string | null = null;

  try {
    const user = await requireCapability("course.edit", await assignmentResource(assignmentId));
    const body = (await request.json().catch(() => null)) as { token?: unknown; studentId?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    const studentId = Number(body?.studentId);
    if (!token || !Number.isInteger(studentId)) {
      return NextResponse.json({ error: "Pick a student." }, { status: 400 });
    }

    const [student] = await db
      .select({ id: students.id, name: students.name })
      .from(assignments)
      .innerJoin(courseEnrollments, eq(courseEnrollments.courseId, assignments.courseId))
      .innerJoin(students, eq(students.id, courseEnrollments.studentId))
      .where(and(eq(assignments.id, assignmentId), eq(students.id, studentId)));
    if (!student) return NextResponse.json({ error: "That student isn't in this course." }, { status: 400 });

    const pending = await readPending(assignmentId, token);
    if (!pending) {
      return NextResponse.json(
        { error: "That file is no longer waiting — it was already assigned, or expired. Upload the zip again." },
        { status: 410 },
      );
    }

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "grader-assign-"));
    const out: IngestOutcome = { imported: [], skipped: [], submissionIds: [] };
    await ingestForStudent(fileSource(pending.abs, pending.name, pending.size), {
      assignmentId,
      studentId,
      tmpDir,
      out,
    });
    await removePending(assignmentId, token);

    await writeAudit(user, {
      action: "submission.batch_assign",
      targetType: "assignment",
      targetId: assignmentId,
      detail: { studentId, fileName: pending.name, imported: out.imported.length },
    });

    const submissionIds = [...new Set(out.submissionIds)];
    after(async () => {
      for (const id of submissionIds) await ensureIngested(id).catch(() => {});
    });

    const result: BatchAssignResult = {
      studentName: student.name,
      imported: out.imported.map((i) => i.fileName),
      skipped: out.skipped,
    };
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Assign failed.";
    const status =
      message === "Sign in required." ? 401 : message === "You do not have permission to do that." ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  } finally {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
