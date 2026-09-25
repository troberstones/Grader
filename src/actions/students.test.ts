import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { courseEnrollments, courseMembers, courses, students, users } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { importRoster } from "@/actions/students";

async function seedInstructor(name = "Instructor") {
  const passwordHash = await hashPassword("password123456");
  const [user] = await db
    .insert(users)
    .values({ name, email: `${name.toLowerCase()}-${Date.now()}-${Math.random()}@example.test`, passwordHash, globalRole: "instructor", status: "active" })
    .returning();
  return user;
}

async function seedCourse(name: string) {
  const [course] = await db.insert(courses).values({ name, code: name, year: 2026, term: "fall" }).returning();
  return course;
}

describe("importRoster — cross-course student hijack", () => {
  it("does not let an instructor of course B change the name/email of a student who is also in course A, when they aren't a member of course A", async () => {
    const instructorA = await seedInstructor("Instructor A");
    const courseA = await seedCourse("Course A");
    await db.insert(courseMembers).values({ courseId: courseA.id, userId: instructorA.id, role: "owner" });

    // The student already exists, enrolled only in course A, with A's data on file.
    const [student] = await db
      .insert(students)
      .values({ name: "Jane Smith", sortName: "Smith, Jane", netId: "jsmith7", email: "jane.a@example.test" })
      .returning();
    await db.insert(courseEnrollments).values({ courseId: courseA.id, studentId: student.id });

    // A second instructor owns an unrelated course B and is not a member of course A.
    const instructorB = await seedInstructor("Instructor B");
    const courseB = await seedCourse("Course B");
    await db.insert(courseMembers).values({ courseId: courseB.id, userId: instructorB.id, role: "owner" });
    await createSession(instructorB.id, {});

    const result = await importRoster(
      courseB.id,
      "Student Name,Net ID,Email\nJane Smith,jsmith7,jane.hijacked@example.test\n",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.updated).toBe(0);
      expect(result.keptExisting).toBe(1);
    }

    // The student's original name/email survive untouched.
    const [unchanged] = await db.select().from(students).where(eq(students.id, student.id));
    expect(unchanged.email).toBe("jane.a@example.test");
    expect(unchanged.name).toBe("Jane Smith");

    // But they are now enrolled in course B too — the import still works,
    // it just doesn't hijack the identity.
    const enrollment = await db
      .select()
      .from(courseEnrollments)
      .where(eq(courseEnrollments.courseId, courseB.id));
    expect(enrollment.map((e) => e.studentId)).toContain(student.id);
  });

  it("still updates the student when the caller can edit every course they're enrolled in", async () => {
    const instructor = await seedInstructor("Instructor C");
    const courseA = await seedCourse("Course C1");
    const courseB = await seedCourse("Course C2");
    await db.insert(courseMembers).values({ courseId: courseA.id, userId: instructor.id, role: "owner" });
    await db.insert(courseMembers).values({ courseId: courseB.id, userId: instructor.id, role: "owner" });

    const [student] = await db
      .insert(students)
      .values({ name: "John Doe", sortName: "Doe, John", netId: "jdoe2", email: "john.old@example.test" })
      .returning();
    await db.insert(courseEnrollments).values({ courseId: courseA.id, studentId: student.id });

    await createSession(instructor.id, {});

    const result = await importRoster(
      courseB.id,
      "Student Name,Net ID,Email\nJohn Doe,jdoe2,john.new@example.test\n",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.updated).toBe(1);
      expect(result.keptExisting).toBe(0);
    }

    const [changed] = await db.select().from(students).where(eq(students.id, student.id));
    expect(changed.email).toBe("john.new@example.test");
  });
});
