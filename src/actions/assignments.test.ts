import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { annotations, assignments, courses, grades, reviewStrokes, students, submissions, users } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { deleteAssignment } from "@/actions/assignments";

async function seedSignedInAdmin() {
  const passwordHash = await hashPassword("adminpassword123");
  const [admin] = await db
    .insert(users)
    .values({ name: "Admin", email: `admin-${Date.now()}-${Math.random()}@example.test`, passwordHash, globalRole: "admin", status: "active" })
    .returning();
  await createSession(admin.id, {});
  return admin;
}

async function seedCourseAndAssignment() {
  const [course] = await db.insert(courses).values({ name: "Studio I", code: "ART 101", year: 2026, term: "fall" }).returning();
  const [assignment] = await db
    .insert(assignments)
    .values({ courseId: course.id, name: "Figure Study", pointsPossible: 100 })
    .returning();
  return { course, assignment };
}

async function seedStudent(name = "Student One") {
  const [student] = await db.insert(students).values({ name, sortName: name }).returning();
  return student;
}

describe("deleteAssignment", () => {
  it("refuses when a student has a real grade, and removes nothing", async () => {
    await seedSignedInAdmin();
    const { assignment } = await seedCourseAndAssignment();
    const student = await seedStudent();

    const [submission] = await db
      .insert(submissions)
      .values({
        assignmentId: assignment.id,
        studentId: student.id,
        filePath: "storage/submissions/x/y/z.png",
        fileName: "z.png",
        fileType: "image/png",
        mediaType: "image",
      })
      .returning();

    await db.insert(grades).values({ assignmentId: assignment.id, studentId: student.id, submissionId: submission.id, status: "graded" });

    const result = await deleteAssignment(assignment.id);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("has_grades");
      expect(result.message).toMatch(/1 student has grades on this assignment/i);
    }

    // Nothing was touched.
    const [stillThere] = await db.select().from(assignments).where(eq(assignments.id, assignment.id));
    expect(stillThere).toBeDefined();
    const remainingSubmissions = await db.select().from(submissions).where(eq(submissions.assignmentId, assignment.id));
    expect(remainingSubmissions).toHaveLength(1);
    const remainingGrades = await db.select().from(grades).where(eq(grades.assignmentId, assignment.id));
    expect(remainingGrades).toHaveLength(1);
  });

  it("removes every dependent row atomically when the assignment is ungraded", async () => {
    await seedSignedInAdmin();
    const { assignment } = await seedCourseAndAssignment();
    const student = await seedStudent();

    const [submission] = await db
      .insert(submissions)
      .values({
        assignmentId: assignment.id,
        studentId: student.id,
        filePath: "storage/submissions/x/y/z.png",
        fileName: "z.png",
        fileType: "image/png",
        mediaType: "image",
      })
      .returning();

    await db.insert(annotations).values({ submissionId: submission.id, annotationData: "{}" });
    await db.insert(reviewStrokes).values({
      itemId: `sub:${submission.id}`,
      seq: 1,
      localId: "local-1",
      authorId: "1",
      data: Buffer.from("stroke"),
    });
    // A grade row can exist even when nothing has been graded yet — it must
    // not block the delete, and it must still be cleaned up.
    await db.insert(grades).values({ assignmentId: assignment.id, studentId: student.id, submissionId: submission.id, status: "ungraded" });

    const result = await deleteAssignment(assignment.id);
    expect(result).toEqual({ ok: true });

    const [assignmentRow] = await db.select().from(assignments).where(eq(assignments.id, assignment.id));
    expect(assignmentRow).toBeUndefined();
    expect(await db.select().from(submissions).where(eq(submissions.assignmentId, assignment.id))).toHaveLength(0);
    expect(await db.select().from(grades).where(eq(grades.assignmentId, assignment.id))).toHaveLength(0);
    expect(await db.select().from(annotations).where(eq(annotations.submissionId, submission.id))).toHaveLength(0);
    expect(await db.select().from(reviewStrokes).where(eq(reviewStrokes.itemId, `sub:${submission.id}`))).toHaveLength(0);
  });

  it("reports not_found for a missing assignment instead of throwing", async () => {
    await seedSignedInAdmin();
    const result = await deleteAssignment(999_999_999);
    expect(result).toEqual({ ok: false, reason: "not_found", message: "Assignment not found." });
  });
});
