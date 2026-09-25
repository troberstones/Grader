import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, courseEnrollments, courseMembers, courses, grades, students, submissions, users } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { deleteCourse } from "@/actions/courses";

async function seedSignedInAdmin() {
  const passwordHash = await hashPassword("adminpassword123");
  const [admin] = await db
    .insert(users)
    .values({ name: "Admin", email: `admin-${Date.now()}-${Math.random()}@example.test`, passwordHash, globalRole: "admin", status: "active" })
    .returning();
  await createSession(admin.id, {});
  return admin;
}

async function seedStudent(name = "Student One") {
  const [student] = await db.insert(students).values({ name, sortName: name }).returning();
  return student;
}

describe("deleteCourse", () => {
  it("refuses a course with a real grade in it, and removes nothing", async () => {
    await seedSignedInAdmin();
    const [course] = await db.insert(courses).values({ name: "Studio I", code: "ART 101", year: 2026, term: "fall" }).returning();
    const [assignment] = await db.insert(assignments).values({ courseId: course.id, name: "Figure Study", pointsPossible: 100 }).returning();
    const student = await seedStudent();
    await db.insert(courseEnrollments).values({ courseId: course.id, studentId: student.id });
    await db.insert(grades).values({ assignmentId: assignment.id, studentId: student.id, status: "graded" });

    const result = await deleteCourse(course.id);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("has_grades");
      expect(result.message).toMatch(/1 student has grades in this course/i);
    }

    expect(await db.select().from(courses).where(eq(courses.id, course.id))).toHaveLength(1);
    expect(await db.select().from(assignments).where(eq(assignments.courseId, course.id))).toHaveLength(1);
    expect(await db.select().from(courseEnrollments).where(eq(courseEnrollments.courseId, course.id))).toHaveLength(1);
  });

  it("removes the whole course tree atomically when nothing is graded", async () => {
    const admin = await seedSignedInAdmin();
    const [course] = await db.insert(courses).values({ name: "Studio II", code: "ART 102", year: 2026, term: "fall" }).returning();
    const [assignment] = await db.insert(assignments).values({ courseId: course.id, name: "Still Life", pointsPossible: 100 }).returning();
    const student = await seedStudent("Student Two");
    await db.insert(courseEnrollments).values({ courseId: course.id, studentId: student.id });
    const [submission] = await db
      .insert(submissions)
      .values({
        assignmentId: assignment.id,
        studentId: student.id,
        filePath: "storage/submissions/a/b/c.png",
        fileName: "c.png",
        fileType: "image/png",
        mediaType: "image",
      })
      .returning();
    await db.insert(grades).values({ assignmentId: assignment.id, studentId: student.id, submissionId: submission.id, status: "ungraded" });
    await db.insert(courseMembers).values({ courseId: course.id, userId: admin.id, role: "owner" });

    const result = await deleteCourse(course.id);
    expect(result).toEqual({ ok: true });

    expect(await db.select().from(courses).where(eq(courses.id, course.id))).toHaveLength(0);
    expect(await db.select().from(assignments).where(eq(assignments.courseId, course.id))).toHaveLength(0);
    expect(await db.select().from(courseEnrollments).where(eq(courseEnrollments.courseId, course.id))).toHaveLength(0);
    expect(await db.select().from(submissions).where(eq(submissions.assignmentId, assignment.id))).toHaveLength(0);
    expect(await db.select().from(grades).where(eq(grades.assignmentId, assignment.id))).toHaveLength(0);
    expect(await db.select().from(courseMembers).where(eq(courseMembers.courseId, course.id))).toHaveLength(0);
  });
});
