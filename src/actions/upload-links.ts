"use server";

/**
 * Expiring links that let a student add a submission without signing in —
 * there is no student login yet (see docs/student-accounts-plan.md). Two
 * shapes, both rows in `upload_links`:
 *
 *   - per-student: studentId set, the upload page already knows who it's for
 *   - shared: studentId null, one link for the whole assignment and the
 *     uploader picks their own name from the roster on the upload page
 *
 * Token handling mirrors src/actions/auth.ts's invite flow: only the SHA-256
 * of the token is ever stored, and the token itself is returned exactly once
 * (in the URL) to the caller that created it.
 */

import { and, desc, eq, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { assignments, courseEnrollments, students, uploadLinks } from "@/db/schema";
import { requireCapability } from "@/lib/auth/require";
import { expiryFromNow, generateToken, hashToken, isExpired, UPLOAD_LINK_TTL_MS } from "@/lib/auth/tokens";
import { writeAudit } from "@/lib/audit";
import { sendUploadLinkEmail } from "@/lib/email";

async function requireAssignmentEditor(assignmentId: number) {
  const [assignment] = await db
    .select({ id: assignments.id, name: assignments.name, courseId: assignments.courseId })
    .from(assignments)
    .where(eq(assignments.id, assignmentId));
  if (!assignment) throw new Error("No such assignment.");
  const user = await requireCapability("grade.write", { kind: "assignment", assignmentId, courseId: assignment.courseId });
  return { assignment, user };
}

/**
 * Always mints a fresh link, revoking any prior live one for the same
 * (assignmentId, studentId) first — same "re-issuing invalidates the old
 * link" reasoning as inviteUser()/resetPassword() in src/actions/auth.ts.
 * The token is never stored, only its hash, so there is no way to hand back
 * an existing link's URL — reissuing is the only way to get a fresh copy to
 * show or resend, which is also why this doesn't try to detect "nothing
 * changed" and skip the write.
 */
async function reissueLink(assignmentId: number, studentId: number | null, createdBy: number) {
  await db
    .update(uploadLinks)
    .set({ revokedAt: new Date().toISOString() })
    .where(
      and(
        eq(uploadLinks.assignmentId, assignmentId),
        studentId == null ? isNull(uploadLinks.studentId) : eq(uploadLinks.studentId, studentId),
        isNull(uploadLinks.revokedAt),
      ),
    );

  const token = generateToken();
  const expiresAt = expiryFromNow(UPLOAD_LINK_TTL_MS);
  await db.insert(uploadLinks).values({
    assignmentId,
    studentId,
    tokenHash: hashToken(token),
    createdBy,
    expiresAt,
  });
  return { token, expiresAt };
}

export interface CreateLinkResult {
  ok: boolean;
  error?: string;
  url?: string;
}

/** Issues a fresh link and returns its URL for copying. Does not email. */
export async function createUploadLink(assignmentId: number, studentId: number | null): Promise<CreateLinkResult> {
  const { assignment, user } = await requireAssignmentEditor(assignmentId);

  const { token } = await reissueLink(assignmentId, studentId, user.id);

  await writeAudit(user, {
    action: "upload_link.create",
    targetType: "assignment",
    targetId: assignmentId,
    detail: { studentId, shared: studentId == null },
  });
  revalidatePath(`/assignments/${assignment.id}`);
  return { ok: true, url: `/upload/${token}` };
}

export interface SendLinksResult {
  ok: boolean;
  error?: string;
  sent: number;
  skipped: { name: string; reason: string }[];
}

/**
 * Creates (as needed) and emails upload links.
 *
 * `mode: "per-student"` mints one link per selected student and emails each
 * their own. `mode: "shared"` mints a single assignment-wide link and emails
 * the same URL to every selected student. Either way a missing email address
 * is a skip, not a failure — see students.email in src/db/schema.ts.
 */
export async function sendUploadLinks(
  assignmentId: number,
  studentIds: number[],
  mode: "per-student" | "shared",
): Promise<SendLinksResult> {
  const { assignment, user } = await requireAssignmentEditor(assignmentId);

  if (studentIds.length === 0) return { ok: false, error: "Select at least one student.", sent: 0, skipped: [] };

  const roster = await db
    .select({ id: students.id, name: students.name, email: students.email })
    .from(students)
    .where(or(...studentIds.map((id) => eq(students.id, id))));
  const byId = new Map(roster.map((s) => [s.id, s]));

  // A shared link is one row for the whole assignment — issued once here,
  // then the same URL goes out to everyone selected below. A per-student
  // link is issued per recipient inside the loop instead.
  const shared = mode === "shared" ? await reissueLink(assignmentId, null, user.id) : null;

  let sent = 0;
  const skipped: { name: string; reason: string }[] = [];

  for (const studentId of studentIds) {
    const student = byId.get(studentId);
    if (!student) {
      skipped.push({ name: `#${studentId}`, reason: "not found" });
      continue;
    }
    if (!student.email) {
      skipped.push({ name: student.name, reason: "no email on file" });
      continue;
    }

    const { token, expiresAt } = shared ?? (await reissueLink(assignmentId, studentId, user.id));

    const emailSent = await sendUploadLinkEmail(student.email, student.name, assignment.name, `/upload/${token}`, expiresAt);
    if (emailSent) {
      sent++;
    } else {
      skipped.push({ name: student.name, reason: "email failed to send" });
    }
  }

  await writeAudit(user, {
    action: "upload_link.create",
    targetType: "assignment",
    targetId: assignmentId,
    detail: { mode, requested: studentIds.length, sent, skipped: skipped.length },
  });
  revalidatePath(`/assignments/${assignment.id}`);
  return { ok: true, sent, skipped };
}

export interface UploadLinkRow {
  id: number;
  studentId: number | null;
  studentName: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  expired: boolean;
}

export async function listUploadLinks(assignmentId: number): Promise<UploadLinkRow[]> {
  const { assignment } = await requireAssignmentEditor(assignmentId);

  const rows = await db
    .select({
      id: uploadLinks.id,
      studentId: uploadLinks.studentId,
      studentName: students.name,
      expiresAt: uploadLinks.expiresAt,
      revokedAt: uploadLinks.revokedAt,
      createdAt: uploadLinks.createdAt,
    })
    .from(uploadLinks)
    .leftJoin(students, eq(students.id, uploadLinks.studentId))
    .where(eq(uploadLinks.assignmentId, assignment.id))
    .orderBy(desc(uploadLinks.createdAt));

  return rows.map((r) => ({ ...r, expired: isExpired(r.expiresAt) }));
}

export async function revokeUploadLink(id: number): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db.select({ assignmentId: uploadLinks.assignmentId }).from(uploadLinks).where(eq(uploadLinks.id, id));
  if (!row) return { ok: false, error: "No such link." };

  const { assignment, user } = await requireAssignmentEditor(row.assignmentId);

  await db.update(uploadLinks).set({ revokedAt: new Date().toISOString() }).where(eq(uploadLinks.id, id));
  await writeAudit(user, { action: "upload_link.revoke", targetType: "assignment", targetId: assignment.id, detail: { linkId: id } });
  revalidatePath(`/assignments/${assignment.id}`);
  return { ok: true };
}

// ─── Public (unauthenticated) lookups, for the /upload/[token] page ─────

export interface UploadLinkDetails {
  assignmentId: number;
  assignmentName: string;
  submissionType: string;
  courseId: number;
  /** Set for a per-student link; null for a shared link (uploader picks below). */
  studentId: number | null;
  studentName: string | null;
  /** Populated only for a shared link, so the uploader can pick their own name. */
  roster: { id: number; name: string }[];
}

/** Looks up an upload link for the public upload page. Null when unusable. */
export async function inspectUploadLink(token: string): Promise<UploadLinkDetails | null> {
  if (!token) return null;

  const rows = await db
    .select({
      linkStudentId: uploadLinks.studentId,
      expiresAt: uploadLinks.expiresAt,
      revokedAt: uploadLinks.revokedAt,
      assignmentId: assignments.id,
      assignmentName: assignments.name,
      submissionType: assignments.submissionType,
      courseId: assignments.courseId,
      archived: assignments.archived,
      studentName: students.name,
    })
    .from(uploadLinks)
    .innerJoin(assignments, eq(assignments.id, uploadLinks.assignmentId))
    .leftJoin(students, eq(students.id, uploadLinks.studentId))
    .where(eq(uploadLinks.tokenHash, hashToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row || row.revokedAt || isExpired(row.expiresAt) || row.archived) return null;

  let roster: { id: number; name: string }[] = [];
  if (row.linkStudentId == null) {
    roster = await db
      .select({ id: students.id, name: students.name })
      .from(courseEnrollments)
      .innerJoin(students, eq(students.id, courseEnrollments.studentId))
      .where(eq(courseEnrollments.courseId, row.courseId))
      .orderBy(students.sortName);
  }

  return {
    assignmentId: row.assignmentId,
    assignmentName: row.assignmentName,
    submissionType: row.submissionType,
    courseId: row.courseId,
    studentId: row.linkStudentId,
    studentName: row.studentName,
    roster,
  };
}
