import { describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, auditLog, courseMembers, courses, rubricCriteria, rubricLevels, rubrics, students, users } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { forceSignOut, setUserRole, setUserStatus } from "@/actions/auth";
import { removeCourseMember, updateCourseMemberRole } from "@/actions/course-members";
import { clearGrade, saveShareGrade } from "@/actions/grades";
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

  it("records saveShareGrade and clearGrade", async () => {
    await seedSignedInAdmin();
    const [course] = await db.insert(courses).values({ name: "Test Course", code: "TST 100", year: 2026, term: "fall" }).returning();
    const [rubric] = await db
      .insert(rubrics)
      .values({ name: "Test Rubric", settings: JSON.stringify({ model: "share" }) })
      .returning();
    const [criterion] = await db
      .insert(rubricCriteria)
      .values({ rubricId: rubric.id, name: "Craft", sortOrder: 0, weight: 1 })
      .returning();
    // rubric_levels.points is NOT NULL in the test DB (see test/global-setup.ts) —
    // share-model rubrics normally leave it null in production, so this is a
    // test-only workaround, not a real value the app reads.
    await db.insert(rubricLevels).values([
      { criteriaId: criterion.id, level: 0, label: "Low", description: "", points: 0 },
      { criteriaId: criterion.id, level: 1, label: "Mid", description: "", points: 0 },
      { criteriaId: criterion.id, level: 2, label: "Good", description: "", points: 0 },
      { criteriaId: criterion.id, level: 3, label: "High", description: "", points: 0 },
    ]);
    const [assignment] = await db
      .insert(assignments)
      .values({ courseId: course.id, rubricId: rubric.id, name: "Assignment 1", pointsPossible: 100 })
      .returning();
    const [student] = await db.insert(students).values({ name: "Student One", sortName: "Student One" }).returning();

    await saveShareGrade({ assignmentId: assignment.id, studentId: student.id, entries: [], feedback: "" });
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

  it("records updateCourseMemberRole", async () => {
    const admin = await seedSignedInAdmin();
    const [course] = await db
      .insert(courses)
      .values({ name: "Roles Course", code: "ROLE 100", year: 2026, term: "fall" })
      .returning();
    const target = await seedTargetUser("role-member-target@example.test");
    await db.insert(courseMembers).values({ courseId: course.id, userId: target.id, role: "observer" });

    await updateCourseMemberRole(course.id, target.id, "ta");

    const row = await latestAuditRow("course_member.role_change");
    expect(row?.actorId).toBe(admin.id);
    expect(row?.targetType).toBe("course");
    expect(row?.targetId).toBe(course.id);
  });

  it("records removeCourseMember", async () => {
    await seedSignedInAdmin();
    const [course] = await db
      .insert(courses)
      .values({ name: "Membership Course", code: "MEM 100", year: 2026, term: "fall" })
      .returning();
    const target = await seedTargetUser("remove-member-target@example.test");
    await db.insert(courseMembers).values({ courseId: course.id, userId: target.id, role: "observer" });

    await removeCourseMember(course.id, target.id);

    const row = await latestAuditRow("course_member.remove");
    expect(row?.targetId).toBe(course.id);
  });
});
