import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { assignments, courseEnrollments, courseMembers, courses, students, users } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { createUploadLink, sendUploadLinks } from "@/actions/upload-links";

async function seedSignedInInstructor() {
  const passwordHash = await hashPassword("password123456");
  const [user] = await db
    .insert(users)
    .values({ name: "Instructor", email: `instructor-${Date.now()}-${Math.random()}@example.test`, passwordHash, globalRole: "instructor", status: "active" })
    .returning();
  await createSession(user.id, {});
  return user;
}

async function seedCourseAndAssignment(owner: { id: number }) {
  const [course] = await db.insert(courses).values({ name: "Studio I", code: "ART 101", year: 2026, term: "fall" }).returning();
  await db.insert(courseMembers).values({ courseId: course.id, userId: owner.id, role: "owner" });
  const [assignment] = await db
    .insert(assignments)
    .values({ courseId: course.id, name: "Figure Study", pointsPossible: 100 })
    .returning();
  return { course, assignment };
}

async function seedStudent(name: string, email: string | null = `${name.toLowerCase().replace(/\s+/g, "")}@example.test`) {
  const [student] = await db.insert(students).values({ name, sortName: name, email }).returning();
  return student;
}

describe("createUploadLink — enrollment scoping", () => {
  it("refuses to mint a link for a student who isn't enrolled in the assignment's course", async () => {
    const owner = await seedSignedInInstructor();
    const { assignment } = await seedCourseAndAssignment(owner);
    // Enrolled in some other course entirely, not this assignment's course.
    const stranger = await seedStudent("Stranger Student");

    const result = await createUploadLink(assignment.id, stranger.id);

    expect(result.ok).toBe(false);
    expect(result.url).toBeUndefined();
  });

  it("succeeds for a student actually enrolled in the assignment's course", async () => {
    const owner = await seedSignedInInstructor();
    const { course, assignment } = await seedCourseAndAssignment(owner);
    const student = await seedStudent("Enrolled Student");
    await db.insert(courseEnrollments).values({ courseId: course.id, studentId: student.id });

    const result = await createUploadLink(assignment.id, student.id);

    expect(result.ok).toBe(true);
    expect(result.url).toMatch(/^\/upload\//);
  });

  it("still allows a shared (assignment-wide) link with no student id", async () => {
    const owner = await seedSignedInInstructor();
    const { assignment } = await seedCourseAndAssignment(owner);

    const result = await createUploadLink(assignment.id, null);
    expect(result.ok).toBe(true);
  });
});

describe("sendUploadLinks — enrollment scoping", () => {
  it("skips a selected student who isn't enrolled in the assignment's course, without leaking their name", async () => {
    const owner = await seedSignedInInstructor();
    const { course, assignment } = await seedCourseAndAssignment(owner);
    const enrolled = await seedStudent("Real Student");
    await db.insert(courseEnrollments).values({ courseId: course.id, studentId: enrolled.id });
    const stranger = await seedStudent("Other Course Student");

    const result = await sendUploadLinks(assignment.id, [enrolled.id, stranger.id], "per-student");

    expect(result.ok).toBe(true);
    const strangerSkip = result.skipped.find((s) => s.name.includes(stranger.id.toString()));
    expect(strangerSkip).toBeDefined();
    expect(strangerSkip?.name).not.toBe("Other Course Student");
    expect(strangerSkip?.reason).toBe("not found");
  });
});
