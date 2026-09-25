import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  assignments,
  courseEnrollments,
  courses,
  feedbackSends,
  gradeEntries,
  grades,
  rubricCriteria,
  rubricLevels,
  rubrics,
  submissions,
  users,
} from "@/db/schema";
import { students } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { linkCoversSubmission, resolveFeedbackLink } from "@/lib/feedback/links";

const sent = vi.hoisted(() => [] as { to: string; subject: string; html: string; text: string }[]);
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendRichMail: vi.fn(async (mail: { to: string; subject: string; html: string; text: string }) => {
    sent.push(mail);
    return { ok: true };
  }),
}));

import { getFeedbackRoster, sendFeedbackToStudent } from "./feedback";
import { feedbackStrokes } from "./feedback-view";

let seq = 0;

async function seed() {
  seq++;
  const passwordHash = await hashPassword("adminpassword123");
  const [admin] = await db
    .insert(users)
    .values({ name: "Prof Admin", email: `prof${seq}@example.test`, passwordHash, globalRole: "admin", status: "active" })
    .returning();
  await createSession(admin.id, {});

  const [course] = await db.insert(courses).values({ name: "Lighting", code: `ART ${seq}`, year: 2026, term: "fall" }).returning();
  const [rubric] = await db
    .insert(rubrics)
    .values({ name: "Render rubric", settings: JSON.stringify({ model: "share", bandEdges: [0.55, 0.74, 0.88] }) })
    .returning();
  const criteria: { id: number; levels: { id: number }[] }[] = [];
  for (const [i, name] of ["Lighting", "Composition"].entries()) {
    const [c] = await db.insert(rubricCriteria).values({ rubricId: rubric.id, name, sortOrder: i, weight: 1 }).returning();
    const levels: { id: number }[] = [];
    for (const level of [0, 1, 2, 3]) {
      const [l] = await db
        .insert(rubricLevels)
        .values({ criteriaId: c.id, level, label: "", description: `${name} level ${level}`, points: 0 })
        .returning();
      levels.push(l);
    }
    criteria.push({ ...c, levels });
  }
  const [assignment] = await db
    .insert(assignments)
    .values({ courseId: course.id, rubricId: rubric.id, name: "Studio Lighting", pointsPossible: 50 })
    .returning();

  const mk = async (name: string, email: string | null) => {
    const [s] = await db.insert(students).values({ name, sortName: name, email }).returning();
    await db.insert(courseEnrollments).values({ courseId: course.id, studentId: s.id });
    return s;
  };
  const withEmail = await mk("Lovelace, Ada", `ada${seq}@students.test`);
  const noEmail = await mk("Hopper, Grace", null);
  const ungraded = await mk("Turing, Alan", `alan${seq}@students.test`);
  const other = await mk("Noether, Emmy", `emmy${seq}@students.test`);

  const grade = async (studentId: number, status: string, levels: number[], totalScore: number) => {
    const [g] = await db
      .insert(grades)
      .values({ assignmentId: assignment.id, studentId, status, totalScore, feedback: "Nice rim light." })
      .returning();
    for (const [i, level] of levels.entries()) {
      await db.insert(gradeEntries).values({ gradeId: g.id, criteriaId: criteria[i].id, levelId: criteria[i].levels[level].id, nudge: 0 });
    }
    return g;
  };
  // Levels 3 and 2 → (1.0 + 0.88) / 2 = 94% → A, 47 of 50 points.
  const adaGrade = await grade(withEmail.id, "graded", [3, 2], 47);
  await grade(noEmail.id, "graded", [2, 2], 44);
  await grade(ungraded.id, "in_progress", [1], 37);

  return { admin, assignment, withEmail, noEmail, ungraded, other, adaGrade };
}

const OPTS = { rubric: true, annotations: false, link: false };

beforeEach(() => {
  sent.length = 0;
  delete process.env.FEEDBACK_EMAIL_STUDENTS;
  delete process.env.APP_BASE_URL;
});
afterEach(() => {
  delete process.env.FEEDBACK_EMAIL_STUDENTS;
  delete process.env.APP_BASE_URL;
});

describe("sending feedback", () => {
  it("redirects to the sending instructor in test mode, with letters and no points", async () => {
    const { admin, assignment, withEmail } = await seed();

    const roster = await getFeedbackRoster(assignment.id);
    expect(roster.testMode).toBe(true);
    expect(roster.students.find((s) => s.id === withEmail.id)?.due).toBe(true);

    const out = await sendFeedbackToStudent(assignment.id, withEmail.id, { ...OPTS, onlyIfDue: true });
    expect(out.result).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(admin.email);
    expect(sent[0].subject).toBe(`[TEST → Ada Lovelace] Feedback: Studio Lighting (${(await db.select().from(courses).where(eq(courses.id, assignment.courseId)))[0].code})`);
    expect(sent[0].html).toContain(">A<");
    expect(sent[0].html).toContain("Professional / Mastery");
    expect(sent[0].html).toContain("Nice rim light.");
    expect(sent[0].html).not.toMatch(/\b47\b|\/ ?50\b|\bpts\b|\bpoints\b/i);

    const [row] = await db.select().from(feedbackSends).where(eq(feedbackSends.studentId, withEmail.id));
    expect(row).toMatchObject({ status: "sent", testMode: 1, recipient: admin.email, letterGrade: "A", includeRubric: 1 });
  });

  it("skips a student already emailed unless the grade changed", async () => {
    const { assignment, withEmail, adaGrade } = await seed();
    await sendFeedbackToStudent(assignment.id, withEmail.id, { ...OPTS, onlyIfDue: true });

    const again = await sendFeedbackToStudent(assignment.id, withEmail.id, { ...OPTS, onlyIfDue: true });
    expect(again).toMatchObject({ result: "skipped", reason: "already emailed, grade unchanged" });
    expect((await getFeedbackRoster(assignment.id)).students.find((s) => s.id === withEmail.id)?.due).toBe(false);

    await db.update(grades).set({ feedback: "Nice rim light. Watch the fill." }).where(eq(grades.id, adaGrade.id));
    const roster = await getFeedbackRoster(assignment.id);
    expect(roster.students.find((s) => s.id === withEmail.id)).toMatchObject({ changed: true, due: true });
    expect((await sendFeedbackToStudent(assignment.id, withEmail.id, { ...OPTS, onlyIfDue: true })).result).toBe("sent");

    // Picking a student by hand sends regardless.
    expect((await sendFeedbackToStudent(assignment.id, withEmail.id, { ...OPTS, onlyIfDue: false })).result).toBe("sent");
    expect(sent).toHaveLength(3);
  });

  it("skips students with no email or no finished grade", async () => {
    const { assignment, noEmail, ungraded } = await seed();
    expect(await sendFeedbackToStudent(assignment.id, noEmail.id, { ...OPTS, onlyIfDue: false })).toMatchObject({
      result: "skipped",
      reason: "no email on file",
    });
    expect(await sendFeedbackToStudent(assignment.id, ungraded.id, { ...OPTS, onlyIfDue: false })).toMatchObject({
      result: "skipped",
      reason: "not graded yet",
    });
    expect(sent).toHaveLength(0);
  });

  it("keeps test sends apart from real ones", async () => {
    const { assignment, withEmail } = await seed();
    await sendFeedbackToStudent(assignment.id, withEmail.id, { ...OPTS, onlyIfDue: true });

    process.env.FEEDBACK_EMAIL_STUDENTS = "1";
    const roster = await getFeedbackRoster(assignment.id);
    expect(roster.testMode).toBe(false);
    expect(roster.students.find((s) => s.id === withEmail.id)).toMatchObject({ lastSent: null, due: true });

    const out = await sendFeedbackToStudent(assignment.id, withEmail.id, { ...OPTS, onlyIfDue: true });
    expect(out).toMatchObject({ result: "sent", to: withEmail.email });
    expect(sent[1].subject.startsWith("Feedback:")).toBe(true);
  });

  it("issues a link that covers only that student's own work, until the end of term", async () => {
    const { assignment, withEmail, other } = await seed();
    process.env.APP_BASE_URL = "https://grader.example.test";
    const [own] = await db
      .insert(submissions)
      .values({ assignmentId: assignment.id, studentId: withEmail.id, filePath: "x", fileName: "a.png", fileType: "image/png", mediaType: "image" })
      .returning();
    const [theirs] = await db
      .insert(submissions)
      .values({ assignmentId: assignment.id, studentId: other.id, filePath: "y", fileName: "b.png", fileType: "image/png", mediaType: "image" })
      .returning();

    await sendFeedbackToStudent(assignment.id, withEmail.id, { ...OPTS, link: true, onlyIfDue: false });
    const token = /https:\/\/grader\.example\.test\/feedback\/([A-Za-z0-9_-]+)/.exec(sent[0].html)?.[1];
    expect(token).toBeTruthy();

    const link = await resolveFeedbackLink(token);
    expect(link).toMatchObject({ assignmentId: assignment.id, studentId: withEmail.id, expiresAt: "2026-12-31 23:59:59" });
    expect(await linkCoversSubmission(link!, own.id)).toBe(true);
    expect(await linkCoversSubmission(link!, theirs.id)).toBe(false);
    await expect(feedbackStrokes(token!, `sub:${theirs.id}`)).rejects.toThrow();
    expect((await feedbackStrokes(token!, `sub:${own.id}`)).strokes).toEqual([]);

    // Resending replaces the link; the old token stops working.
    await sendFeedbackToStudent(assignment.id, withEmail.id, { ...OPTS, link: true, onlyIfDue: false });
    expect(await resolveFeedbackLink(token)).toBeNull();
    const rows = await db
      .select()
      .from(feedbackSends)
      .where(and(eq(feedbackSends.studentId, withEmail.id), eq(feedbackSends.includeLink, 1)));
    expect(rows).toHaveLength(2);
  });
});
