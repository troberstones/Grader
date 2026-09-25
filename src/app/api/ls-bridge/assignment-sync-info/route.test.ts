import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { db } from "@/db";
import { assignments, courseMembers, courseEnrollments, courses, grades, students, users } from "@/db/schema";
import { createSession } from "@/lib/auth/session";

import { GET } from "./route";

async function seedInstructor(email: string) {
  const [user] = await db
    .insert(users)
    .values({ name: "Instructor", email, globalRole: "instructor", status: "active" })
    .returning();
  return user;
}

async function seedCourseWithAssignment() {
  const [course] = await db
    .insert(courses)
    .values({ name: "Drawing I", code: "ART 101", year: 2026, term: "fall" })
    .returning();
  const [assignment] = await db
    .insert(assignments)
    .values({
      courseId: course.id,
      name: "Figure Study",
      pointsPossible: 100,
      lmsAssignmentId: "lms-1",
      lmsGradebookId: "gb-1",
    })
    .returning();
  return { course, assignment };
}

function url(assignmentId: number, includeGrades = false) {
  return `http://localhost:3000/api/ls-bridge/assignment-sync-info?assignmentId=${assignmentId}${
    includeGrades ? "&includeGrades=true" : ""
  }`;
}

describe("GET /api/ls-bridge/assignment-sync-info", () => {
  it("401s an unauthenticated request", async () => {
    const { assignment } = await seedCourseWithAssignment();

    const res = await GET(new NextRequest(url(assignment.id)));
    expect(res.status).toBe(401);
  });

  it("403s a signed-in user who is not a member of the assignment's course", async () => {
    const { assignment } = await seedCourseWithAssignment();
    const outsider = await seedInstructor("outsider@example.test");
    await createSession(outsider.id, {});

    const res = await GET(new NextRequest(url(assignment.id)));
    expect(res.status).toBe(403);
  });

  it("with includeGrades, pushes graded and missing rows but never in_progress/ungraded", async () => {
    const { course, assignment } = await seedCourseWithAssignment();
    const member = await seedInstructor("owner@example.test");
    await db.insert(courseMembers).values({ courseId: course.id, userId: member.id, role: "owner" });
    await createSession(member.id, {});

    const [gradedStudent] = await db
      .insert(students)
      .values({ name: "Graded Student", sortName: "Student, Graded", lmsStudentId: "ls-1" })
      .returning();
    const [missingStudent] = await db
      .insert(students)
      .values({ name: "Missing Student", sortName: "Student, Missing", lmsStudentId: "ls-2" })
      .returning();
    const [inProgressStudent] = await db
      .insert(students)
      .values({ name: "In Progress Student", sortName: "Student, InProgress", lmsStudentId: "ls-3" })
      .returning();
    const [ungradedStudent] = await db
      .insert(students)
      .values({ name: "Ungraded Student", sortName: "Student, Ungraded", lmsStudentId: "ls-4" })
      .returning();

    for (const s of [gradedStudent, missingStudent, inProgressStudent, ungradedStudent]) {
      await db.insert(courseEnrollments).values({ courseId: course.id, studentId: s.id });
    }

    await db.insert(grades).values({
      assignmentId: assignment.id,
      studentId: gradedStudent.id,
      totalScore: 92,
      feedback: "Nice work",
      status: "graded",
    });
    await db.insert(grades).values({
      assignmentId: assignment.id,
      studentId: missingStudent.id,
      totalScore: 0,
      feedback: null,
      status: "missing",
    });
    await db.insert(grades).values({
      assignmentId: assignment.id,
      studentId: inProgressStudent.id,
      totalScore: 40,
      feedback: null,
      status: "in_progress",
    });
    // ungradedStudent has no grades row at all — the default state.

    const res = await GET(new NextRequest(url(assignment.id, true)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { grades: { lmsStudentId: string; score: number; note: string }[] };

    const byLmsId = new Map(body.grades.map((g) => [g.lmsStudentId, g]));
    expect(byLmsId.has("ls-1")).toBe(true);
    expect(byLmsId.get("ls-1")).toMatchObject({ score: 92, note: "Nice work" });

    expect(byLmsId.has("ls-2")).toBe(true);
    expect(byLmsId.get("ls-2")).toMatchObject({ score: 0, note: "" });

    expect(byLmsId.has("ls-3")).toBe(false);
    expect(byLmsId.has("ls-4")).toBe(false);
    expect(body.grades.length).toBe(2);
  });
});
