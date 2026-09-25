"use server";

/**
 * Emailing students their feedback: the graded rubric (as letter grades), the
 * annotated frames, and optionally a read-only link to see it all in the
 * reviewer.
 *
 * The dialog sends one student per call rather than the whole class in one
 * request, so it can show progress and a slow mail transport can't stall a
 * single request for minutes. Every attempt — sent or failed — is recorded in
 * `feedback_sends`, which is what the grade sheet reads to show who has been
 * emailed, when, and whether their grade has changed since.
 */

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { assignments, courseEnrollments, feedbackSends, gradeEntries, grades, students } from "@/db/schema";
import { requireCapability } from "@/lib/auth/require";
import { assignmentResource } from "@/lib/auth/resource-lookup";
import { writeAudit } from "@/lib/audit";
import { mailTransportProblem, sendRichMail } from "@/lib/email";
import { appBaseUrl, feedbackTestMode } from "@/lib/feedback/config";
import { renderFeedbackEmail, type EmailFrame } from "@/lib/feedback/email-html";
import { gradeFingerprint } from "@/lib/feedback/fingerprint";
import { renderAnnotatedFrames, type FramesResult } from "@/lib/feedback/frames";
import { feedbackHistory, type LastFailure, type LastSent, type LinkState } from "@/lib/feedback/history";
import { issueFeedbackLink } from "@/lib/feedback/links";
import { loadFeedbackModel } from "@/lib/feedback/model";
import type { GradeStatus } from "@/types/grading";

export interface FeedbackOptions {
  rubric: boolean;
  annotations: boolean;
  link: boolean;
}

export interface FeedbackRosterRow {
  id: number;
  name: string;
  sortName: string;
  email: string | null;
  status: GradeStatus;
  lastSent: LastSent | null;
  lastFailure: LastFailure | null;
  link: LinkState | null;
  /** The grade differs from what was last emailed. */
  changed: boolean;
  /** Included by the "Graded" choice: graded, and new or changed since last emailed. */
  due: boolean;
}

export interface FeedbackRoster {
  testMode: boolean;
  senderEmail: string;
  linkAvailable: boolean;
  /** Set when the server can't send mail at all; the dialog shows it instead of letting every send fail. */
  mailProblem: string | null;
  students: FeedbackRosterRow[];
}

const SENDABLE: GradeStatus[] = ["graded", "missing"];

async function requireSender(assignmentId: number) {
  const user = await requireCapability("grade.publish", await assignmentResource(assignmentId));
  const [assignment] = await db.select().from(assignments).where(eq(assignments.id, assignmentId));
  if (!assignment) throw new Error("No such assignment.");
  return { user, assignment };
}

export async function getFeedbackRoster(assignmentId: number): Promise<FeedbackRoster> {
  const { user, assignment } = await requireSender(assignmentId);
  const testMode = feedbackTestMode();

  const roster = await db
    .select({ id: students.id, name: students.name, sortName: students.sortName, email: students.email })
    .from(courseEnrollments)
    .innerJoin(students, eq(courseEnrollments.studentId, students.id))
    .where(eq(courseEnrollments.courseId, assignment.courseId))
    .orderBy(asc(students.sortName));

  const gradeRows = await db.select().from(grades).where(eq(grades.assignmentId, assignmentId));
  const entryRows = gradeRows.length
    ? await db
        .select()
        .from(gradeEntries)
        .innerJoin(grades, eq(gradeEntries.gradeId, grades.id))
        .where(eq(grades.assignmentId, assignmentId))
    : [];
  const history = await feedbackHistory([assignmentId], testMode);

  return {
    testMode,
    senderEmail: user.email,
    linkAvailable: appBaseUrl() !== null,
    mailProblem: mailTransportProblem(),
    students: roster.map((s) => {
      const grade = gradeRows.find((g) => g.studentId === s.id);
      const status = (grade?.status ?? "ungraded") as GradeStatus;
      const fingerprint = grade
        ? gradeFingerprint({
            status: grade.status,
            totalScore: grade.totalScore,
            feedback: grade.feedback,
            entries: entryRows.filter((r) => r.grade_entries.gradeId === grade.id).map((r) => r.grade_entries),
          })
        : null;
      const h = history.get(`${assignmentId}:${s.id}`);
      const lastSent = h?.lastSent ?? null;
      const changed = !!lastSent && lastSent.fingerprint !== fingerprint;
      return {
        ...s,
        status,
        lastSent,
        lastFailure: h?.lastFailure ?? null,
        link: h?.link ?? null,
        changed,
        due: status === "graded" && (!lastSent || changed),
      };
    }),
  };
}

// ─── Building one email ──────────────────────────────────────────────────────

async function build(
  assignmentId: number,
  studentId: number,
  options: FeedbackOptions,
  sender: { id: number; name: string; email: string },
  mode: "preview" | "send",
) {
  const model = await loadFeedbackModel(assignmentId, studentId);
  if (!model) throw new Error("Student or assignment not found.");
  const testMode = feedbackTestMode();

  let frames: FramesResult | null = null;
  if (options.annotations) frames = await renderAnnotatedFrames(assignmentId, studentId);

  const frameNotes: string[] = [];
  if (frames?.warnings.length) frameNotes.push(...frames.warnings);

  const base = appBaseUrl();
  let link: { url: string; expires: Date } | null = null;
  if (options.link && base) {
    if (mode === "send") {
      const issued = await issueFeedbackLink(assignmentId, studentId, sender.id);
      link = { url: new URL(`/feedback/${issued.token}`, base).toString(), expires: issued.expiresAt };
    } else {
      // The real token is minted only when sending — a preview must not
      // revoke the link a student already has.
      link = { url: new URL("/feedback/preview", base).toString(), expires: new Date() };
    }
  }

  const emailFrames: EmailFrame[] | null = frames
    ? frames.frames.map((f) => ({
        src: mode === "send" ? `cid:${f.cid}` : `data:${f.contentType};base64,${f.content.toString("base64")}`,
        label: f.label,
        width: f.width,
        height: f.height,
      }))
    : null;

  const rendered = renderFeedbackEmail({
    model,
    includeRubric: options.rubric,
    frames: emailFrames,
    frameNotes,
    link,
    instructor: { name: sender.name, email: sender.email },
    testRecipient: testMode ? { name: model.student.name, email: model.student.email } : null,
  });

  return { model, frames, rendered, link, testMode };
}

export interface FeedbackPreview {
  subject: string;
  html: string;
  to: string;
  warnings: string[];
  frameCount: number;
  dotOnlyFrames: number;
  attachmentBytes: number;
}

export async function previewFeedback(
  assignmentId: number,
  studentId: number,
  options: FeedbackOptions,
): Promise<FeedbackPreview> {
  const { user } = await requireSender(assignmentId);
  const { model, frames, rendered, testMode } = await build(assignmentId, studentId, options, user, "preview");
  return {
    subject: rendered.subject,
    html: rendered.html,
    to: testMode ? user.email : (model.student.email ?? "(no email on file)"),
    warnings: frames?.warnings ?? [],
    frameCount: frames?.frames.length ?? 0,
    dotOnlyFrames: frames?.dotOnlyFrames ?? 0,
    attachmentBytes: frames?.frames.reduce((n, f) => n + f.content.length, 0) ?? 0,
  };
}

// ─── Sending ─────────────────────────────────────────────────────────────────

export type SendOutcome =
  | { studentId: number; name: string; result: "sent"; to: string; warnings: string[]; lastSent: LastSent }
  | { studentId: number; name: string; result: "skipped"; reason: string }
  | { studentId: number; name: string; result: "failed"; reason: string };

/**
 * Email one student. `onlyIfDue` is the "Graded" choice: skip anyone already
 * emailed whose grade hasn't changed since. Re-checked here rather than
 * trusted from the dialog, whose roster may be minutes old.
 */
export async function sendFeedbackToStudent(
  assignmentId: number,
  studentId: number,
  options: FeedbackOptions & { onlyIfDue: boolean },
): Promise<SendOutcome> {
  const { user, assignment } = await requireSender(assignmentId);
  if (!options.rubric && !options.annotations && !options.link) {
    return { studentId, name: `#${studentId}`, result: "skipped", reason: "nothing selected to send" };
  }

  const [enrolled] = await db
    .select({ id: students.id })
    .from(courseEnrollments)
    .innerJoin(students, eq(courseEnrollments.studentId, students.id))
    .where(and(eq(courseEnrollments.courseId, assignment.courseId), eq(students.id, studentId)));
  if (!enrolled) return { studentId, name: `#${studentId}`, result: "skipped", reason: "not enrolled in this course" };

  const testMode = feedbackTestMode();
  const model = await loadFeedbackModel(assignmentId, studentId);
  if (!model) return { studentId, name: `#${studentId}`, result: "skipped", reason: "not found" };
  const name = model.student.name;

  if (!SENDABLE.includes(model.status)) return { studentId, name, result: "skipped", reason: "not graded yet" };
  if (!model.student.email) return { studentId, name, result: "skipped", reason: "no email on file" };

  if (options.onlyIfDue) {
    if (model.status !== "graded") return { studentId, name, result: "skipped", reason: "not graded yet" };
    const last = (await feedbackHistory([assignmentId], testMode)).get(`${assignmentId}:${studentId}`)?.lastSent;
    if (last && last.fingerprint === model.fingerprint) {
      return { studentId, name, result: "skipped", reason: "already emailed, grade unchanged" };
    }
  }

  let built;
  try {
    built = await build(assignmentId, studentId, options, user, "send");
  } catch (err) {
    return { studentId, name, result: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
  const { rendered, frames } = built;
  const to = testMode ? user.email : model.student.email;

  const sent = await sendRichMail({
    to,
    replyTo: { name: user.name, address: user.email },
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    images: frames?.frames,
  });

  const frameCount = frames?.frames.length ?? 0;
  const [row] = await db
    .insert(feedbackSends)
    .values({
      assignmentId,
      studentId,
      sentBy: user.id,
      recipient: to,
      testMode: testMode ? 1 : 0,
      includeRubric: options.rubric ? 1 : 0,
      includeAnnotations: options.annotations ? 1 : 0,
      includeLink: built.link ? 1 : 0,
      letterGrade: model.letter,
      frameCount,
      gradeFingerprint: model.fingerprint,
      status: sent.ok ? "sent" : "failed",
      error: sent.ok ? null : sent.error,
    })
    .returning();

  await writeAudit(user, {
    action: "feedback.send",
    targetType: "assignment",
    targetId: assignmentId,
    detail: { studentId, to, testMode, ok: sent.ok, rubric: options.rubric, annotations: options.annotations, link: !!built.link, frameCount },
  });
  revalidatePath(`/assignments/${assignmentId}`);
  revalidatePath("/assignments");

  if (!sent.ok) return { studentId, name, result: "failed", reason: sent.error };
  return {
    studentId,
    name,
    result: "sent",
    to,
    warnings: frames?.warnings ?? [],
    lastSent: {
      sentAt: row.sentAt,
      fingerprint: row.gradeFingerprint,
      testMode,
      includeRubric: options.rubric,
      includeAnnotations: options.annotations,
      includeLink: !!built.link,
      letterGrade: model.letter,
      frameCount,
    },
  };
}
