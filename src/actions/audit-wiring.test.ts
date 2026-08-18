import { describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, auditLog, courses, rubrics, students, users } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { forceSignOut, setUserRole, setUserStatus } from "@/actions/auth";
import { clearGrade, saveGrade } from "@/actions/grades";
import { deleteRubric } from "@/actions/rubrics";
import { deleteCourse } from "@/actions/courses";

// Admin bypasses every resource-specific capability check (see can() in
// src/lib/auth/roles.ts), so a signed-in admin is enough to exercise every
// wired call site without also seeding course_members rows.
async function seedSignedInAdmin() {
  const passwordHash = await hashPassword("adminpassword123");
  const [admin] = await db
    .insert(users)
    .values({ name: "Admin", email: "admin@example.test", passwordHash, globalRole: "admin", status: "active" })
    .returning();
  await createSession(admin.id, {});
  return admin;
}

async function seedTargetUser(email: string) {
  const [user] = await db
    .insert(users)
    .values({ name: "Target", email, globalRole: "instructor", status: "active" })
    .returning();
  return user;
}

async function latestAuditRow(action: string) {
  const [row] = await db.select().from(auditLog).where(eq(auditLog.action, action)).orderBy(desc(auditLog.id)).limit(1);
  return row;
}

describe("audit log wiring", () => {
  it("records setUserRole with the actor and target", async () => {
    const admin = await seedSignedInAdmin();
    const target = await seedTargetUser("role-target@example.test");

    await setUserRole(target.id, "assistant");

    const row = await latestAuditRow("user.role_change");
    expect(row?.actorId).toBe(admin.id);
    expect(row?.targetType).toBe("user");
    expect(row?.targetId).toBe(target.id);
  });

  it("records setUserStatus", async () => {
    await seedSignedInAdmin();
    const target = await seedTargetUser("status-target@example.test");

    await setUserStatus(target.id, "disabled");

    const row = await latestAuditRow("user.status_change");
    expect(row?.targetId).toBe(target.id);
  });

  it("records forceSignOut", async () => {
    await seedSignedInAdmin();
    const target = await seedTargetUser("signout-target@example.test");

    await forceSignOut(target.id);

    const row = await latestAuditRow("user.force_sign_out");
    expect(row?.targetId).toBe(target.id);
  });

  it("records saveGrade and clearGrade", async () => {
    await seedSignedInAdmin();
    const [course] = await db.insert(courses).values({ name: "Test Course", code: "TST 100", year: 2026, term: "fall" }).returning();
    const [assignment] = await db
      .insert(assignments)
      .values({ courseId: course.id, name: "Assignment 1", pointsPossible: 100 })
      .returning();
    const [student] = await db.insert(students).values({ name: "Student One", sortName: "Student One" }).returning();

    await saveGrade({ assignmentId: assignment.id, studentId: student.id, entries: [], feedback: "" });
    expect(await latestAuditRow("grade.save")).toBeDefined();

    await clearGrade(assignment.id, student.id);
    expect(await latestAuditRow("grade.clear")).toBeDefined();
  });

  it("records deleteRubric", async () => {
    await seedSignedInAdmin();
    const [rubric] = await db.insert(rubrics).values({ name: "Test Rubric" }).returning();

    await deleteRubric(rubric.id);

    const row = await latestAuditRow("rubric.delete");
    expect(row?.targetId).toBe(rubric.id);
  });

  it("records deleteCourse", async () => {
    await seedSignedInAdmin();
    const [course] = await db.insert(courses).values({ name: "Doomed Course", code: "DOOM 100", year: 2026, term: "fall" }).returning();

    await deleteCourse(course.id);

    const row = await latestAuditRow("course.delete");
    expect(row?.targetId).toBe(course.id);
  });
});
