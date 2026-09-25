import { headers } from "next/headers";

import { db } from "@/db";
import { auditLog } from "@/db/schema";

export type AuditAction =
  | "grade.save"
  | "grade.clear"
  | "grade.mark_missing"
  | "user.role_change"
  | "user.status_change"
  | "user.force_sign_out"
  | "user.invite"
  | "user.password_reset_issued"
  | "user.password_change"
  | "user.archive_access_change"
  | "course.delete"
  | "assignment.delete"
  | "rubric.delete"
  | "upload_link.create"
  | "upload_link.revoke"
  | "upload_link.use"
  | "submission.batch_import"
  | "feedback.send"
  | "auth.sign_in"
  | "auth.sign_in_failed"
  | "auth.sign_out"
  | "auth.lockout"
  | "session.revoke"
  | "course_member.add"
  | "course_member.remove"
  | "course_member.role_change";

/**
 * Record who did what. Append-only, best-effort: a write failure here must
 * never fail the action it's recording, so this never throws.
 *
 * `actor.id` is nullable for a sign-in failure against an email that matches
 * no account — there is no user row to point at, but the attempted address
 * still belongs in `actorEmail` for the log to be useful.
 */
export async function writeAudit(
  actor: { id: number | null; email: string },
  entry: { action: AuditAction; targetType?: string; targetId?: number; detail?: Record<string, unknown> },
): Promise<void> {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    await db.insert(auditLog).values({
      actorId: actor.id,
      actorEmail: actor.email,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      detail: entry.detail ? JSON.stringify(entry.detail) : null,
      ip,
    });
  } catch (err) {
    console.error("[audit] write failed:", err);
  }
}
