import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, courses, grades, rubricCriteria, rubricLevels, rubrics, students, users } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { exportGradesCSV, markMissing, saveShareGrade } from "@/actions/grades";

// Admin bypasses every resource-specific capability check (see can() in
// src/lib/auth/roles.ts), so a signed-in admin is enough to exercise these
// actions without also seeding course_members rows.
async function seedSignedInAdmin() {
  const passwordHash = await hashPassword("adminpassword123");
  const [admin] = await db
    .insert(users)
    .values({ name: "Admin", email: `admin-${Date.now()}-${Math.random()}@example.test`, passwordHash, globalRole: "admin", status: "active" })
    .returning();
  await createSession(admin.id, {});
  return admin;
}

async function makeCourse(name: string) {
  const [course] = await db.insert(courses).values({ name, code: name, year: 2026, term: "fall" }).returning();
  return course;
}

async function makeStudent(name: string, extra: { netId?: string; email?: string } = {}) {
  const [student] = await db
    .insert(students)
    .values({ name, sortName: name, netId: extra.netId ?? null, email: extra.email ?? null })
    .returning();
  return student;
}

/**
 * A two-criterion, equal-weight share-model rubric with default band edges
 * ([0.55, 0.74, 0.88, 1]). `rubric_levels.points` is NOT NULL in the test DB
 * (a known gap in test/global-setup.ts — share-model rubrics leave it null in
 * production), so 0 is inserted here purely to satisfy the constraint; it is
 * never read by the share-model scoring path.
 */
async function makeShareRubric(criteriaNames: string[]) {
  const [rubric] = await db
    .insert(rubrics)
    .values({ name: "Test Rubric", settings: JSON.stringify({ model: "share" }) })
    .returning();

  const criteria = [];
  for (let i = 0; i < criteriaNames.length; i++) {
    const [criterion] = await db
      .insert(rubricCriteria)
      .values({ rubricId: rubric.id, name: criteriaNames[i], sortOrder: i, weight: 1 })
      .returning();
    const levels = await db
      .insert(rubricLevels)
      .values([
        { criteriaId: criterion.id, level: 0, label: "Little/No Effort", description: "", points: 0 },
        { criteriaId: criterion.id, level: 1, label: "Lacking", description: "", points: 0 },
        { criteriaId: criterion.id, level: 2, label: "Good", description: "", points: 0 },
        { criteriaId: criterion.id, level: 3, label: "Mastery", description: "", points: 0 },
      ])
      .returning();
    criteria.push({ id: criterion.id, levels });
  }
  return { rubric, criteria };
}

async function makeAssignment(courseId: number, rubricId: number, pointsPossible = 100) {
  const [assignment] = await db
    .insert(assignments)
    .values({ courseId, rubricId, name: "Test Assignment", pointsPossible })
    .returning();
  return assignment;
}

function levelId(criteria: Awaited<ReturnType<typeof makeShareRubric>>["criteria"], criterionIdx: number, level: number) {
  return criteria[criterionIdx].levels.find((l) => l.level === level)!.id;
}

describe("saveShareGrade", () => {
  it("keeps the full total when a second save only submits one criterion", async () => {
    await seedSignedInAdmin();
    const course = await makeCourse("Course A");
    const { rubric, criteria } = await makeShareRubric(["Composition", "Technique"]);
    const assignment = await makeAssignment(course.id, rubric.id, 100);
    const student = await makeStudent("Student One");

    // First device grades criterion 0 at level 0 (fraction 0.55).
    const first = await saveShareGrade({
      assignmentId: assignment.id,
      studentId: student.id,
      entries: [{ criteriaId: criteria[0].id, levelId: levelId(criteria, 0, 0) }],
      feedback: "",
    });
    expect(first.success).toBe(true);
    if (first.success) {
      expect(first.status).toBe("in_progress");
      expect(first.totalScore).toBe(55);
    }

    // Second device only knows about criterion 1, grades it at level 3
    // (fraction 1.0), and submits ONLY that entry — criterion 0 is not part
    // of this request at all.
    const second = await saveShareGrade({
      assignmentId: assignment.id,
      studentId: student.id,
      entries: [{ criteriaId: criteria[1].id, levelId: levelId(criteria, 1, 3) }],
      feedback: "",
    });

    expect(second.success).toBe(true);
    if (second.success) {
      // Both criteria are now stored (0.55 and 1.0), mean = 0.775 → 77.5,
      // not 100 (as if only the second request's entry counted) and not 55
      // (as if the second request had clobbered the total with just its own
      // one-criterion score).
      expect(second.status).toBe("graded");
      expect(second.totalScore).toBe(77.5);
    }

    const [row] = await db.select().from(grades).where(eq(grades.assignmentId, assignment.id));
    expect(row.totalScore).toBe(77.5);
    expect(row.status).toBe("graded");
  });

  it("leaves stored feedback intact when feedback is omitted", async () => {
    await seedSignedInAdmin();
    const course = await makeCourse("Course B");
    const { rubric, criteria } = await makeShareRubric(["Composition"]);
    const assignment = await makeAssignment(course.id, rubric.id, 100);
    const student = await makeStudent("Student Two");

    await saveShareGrade({
      assignmentId: assignment.id,
      studentId: student.id,
      entries: [{ criteriaId: criteria[0].id, levelId: levelId(criteria, 0, 2) }],
      feedback: "Great work, keep it up.",
    });

    // Second save omits `feedback` entirely — e.g. a device only touching
    // the rubric, not the feedback box.
    const result = await saveShareGrade({
      assignmentId: assignment.id,
      studentId: student.id,
      entries: [{ criteriaId: criteria[0].id, levelId: levelId(criteria, 0, 3) }],
    });
    expect(result.success).toBe(true);

    const [row] = await db.select().from(grades).where(eq(grades.assignmentId, assignment.id));
    expect(row.feedback).toBe("Great work, keep it up.");
  });

  it("clears feedback when explicitly passed an empty string", async () => {
    await seedSignedInAdmin();
    const course = await makeCourse("Course B2");
    const { rubric, criteria } = await makeShareRubric(["Composition"]);
    const assignment = await makeAssignment(course.id, rubric.id, 100);
    const student = await makeStudent("Student Two B");

    await saveShareGrade({
      assignmentId: assignment.id,
      studentId: student.id,
      entries: [{ criteriaId: criteria[0].id, levelId: levelId(criteria, 0, 2) }],
      feedback: "Will be cleared",
    });
    await saveShareGrade({
      assignmentId: assignment.id,
      studentId: student.id,
      entries: [{ criteriaId: criteria[0].id, levelId: levelId(criteria, 0, 2) }],
      feedback: "",
    });

    const [row] = await db.select().from(grades).where(eq(grades.assignmentId, assignment.id));
    expect(row.feedback).toBeNull();
  });

  it("rejects a save whose baseUpdatedAt no longer matches the stored row", async () => {
    await seedSignedInAdmin();
    const course = await makeCourse("Course C");
    const { rubric, criteria } = await makeShareRubric(["Composition"]);
    const assignment = await makeAssignment(course.id, rubric.id, 100);
    const student = await makeStudent("Student Three");

    const first = await saveShareGrade({
      assignmentId: assignment.id,
      studentId: student.id,
      entries: [{ criteriaId: criteria[0].id, levelId: levelId(criteria, 0, 0) }],
      feedback: "",
    });
    expect(first.success).toBe(true);

    const [afterFirst] = await db.select().from(grades).where(eq(grades.assignmentId, assignment.id));
    const staleBase = afterFirst.updatedAt;

    // A second, unrelated save moves updatedAt forward.
    const second = await saveShareGrade({
      assignmentId: assignment.id,
      studentId: student.id,
      entries: [{ criteriaId: criteria[0].id, levelId: levelId(criteria, 0, 3) }],
      feedback: "",
      baseUpdatedAt: staleBase,
    });
    expect(second.success).toBe(true);

    // A third save still carrying the original (now stale) baseUpdatedAt
    // must be rejected rather than overwrite what the second save wrote.
    const third = await saveShareGrade({
      assignmentId: assignment.id,
      studentId: student.id,
      entries: [{ criteriaId: criteria[0].id, levelId: levelId(criteria, 0, 1) }],
      feedback: "",
      baseUpdatedAt: staleBase,
    });
    expect(third.success).toBe(false);
    if (!third.success) {
      expect(third.reason).toBe("stale");
      expect(third.current.updatedAt).not.toBe(staleBase);
    }

    const [finalRow] = await db.select().from(grades).where(eq(grades.assignmentId, assignment.id));
    // Score from the third (rejected) save's level-1 entry must not have applied.
    expect(finalRow.totalScore).toBe(100);
  });
});

describe("exportGradesCSV", () => {
  it("includes graded and missing(0) rows, excludes in_progress/ungraded, and only stamps exportedAt on exported rows", async () => {
    await seedSignedInAdmin();
    const course = await makeCourse("Course D");
    const { rubric, criteria } = await makeShareRubric(["Composition", "Technique"]);
    const assignment = await makeAssignment(course.id, rubric.id, 100);

    const gradedStudent = await makeStudent("A Graded", { netId: "graded01" });
    const inProgressStudent = await makeStudent("B InProgress", { netId: "prog01" });
    const ungradedStudent = await makeStudent("C Ungraded", { netId: "ungr01" });
    const missingStudent = await makeStudent("D Missing", { netId: "miss01", email: "missing@example.test" });

    await saveShareGrade({
      assignmentId: assignment.id,
      studentId: gradedStudent.id,
      entries: [
        { criteriaId: criteria[0].id, levelId: levelId(criteria, 0, 3) },
        { criteriaId: criteria[1].id, levelId: levelId(criteria, 1, 3) },
      ],
      feedback: "Nicely done",
    });
    await saveShareGrade({
      assignmentId: assignment.id,
      studentId: inProgressStudent.id,
      entries: [{ criteriaId: criteria[0].id, levelId: levelId(criteria, 0, 2) }],
      feedback: "",
    });
    await saveShareGrade({
      assignmentId: assignment.id,
      studentId: ungradedStudent.id,
      entries: [],
      feedback: "",
    });
    await markMissing(assignment.id, missingStudent.id);

    const result = await exportGradesCSV(assignment.id);

    expect(result.grades).toContain("graded01");
    expect(result.grades).toContain("miss01");
    expect(result.grades).not.toContain("prog01");
    expect(result.grades).not.toContain("ungr01");

    // Missing row is exported at score 0.
    const missingLine = result.grades.split("\n").find((l) => l.includes("miss01"));
    expect(missingLine).toBeDefined();
    expect(missingLine!.split(",")[2]).toBe('"0"');

    const rows = await db.select().from(grades).where(eq(grades.assignmentId, assignment.id));
    const byStudent = (id: number) => rows.find((r) => r.studentId === id)!;
    expect(byStudent(gradedStudent.id).exportedAt).not.toBeNull();
    expect(byStudent(missingStudent.id).exportedAt).not.toBeNull();
    expect(byStudent(inProgressStudent.id).exportedAt).toBeNull();
    expect(byStudent(ungradedStudent.id).exportedAt).toBeNull();
  });

  it("lists exactly the missing students in the second CSV", async () => {
    await seedSignedInAdmin();
    const course = await makeCourse("Course E");
    const { rubric, criteria } = await makeShareRubric(["Composition"]);
    const assignment = await makeAssignment(course.id, rubric.id, 100);

    const gradedStudent = await makeStudent("Graded Student", { netId: "gr02" });
    const missingStudent = await makeStudent("Missing Student", { netId: "ms02", email: "ms02@example.test" });

    await saveShareGrade({
      assignmentId: assignment.id,
      studentId: gradedStudent.id,
      entries: [{ criteriaId: criteria[0].id, levelId: levelId(criteria, 0, 3) }],
      feedback: "",
    });
    await markMissing(assignment.id, missingStudent.id);

    const result = await exportGradesCSV(assignment.id);
    expect(result.missing).not.toBeNull();
    const lines = (result.missing ?? "").split("\n");
    // Header + exactly one data row.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Missing Student");
    expect(lines[1]).toContain("ms02");
    expect(lines[1]).toContain("ms02@example.test");
    expect(lines[1]).toContain("Test Assignment");
    expect(result.missing).not.toContain("Graded Student");
  });

  it("omits the missing CSV entirely when nobody is marked missing", async () => {
    await seedSignedInAdmin();
    const course = await makeCourse("Course F");
    const { rubric, criteria } = await makeShareRubric(["Composition"]);
    const assignment = await makeAssignment(course.id, rubric.id, 100);
    const gradedStudent = await makeStudent("Solo Graded", { netId: "sg01" });

    await saveShareGrade({
      assignmentId: assignment.id,
      studentId: gradedStudent.id,
      entries: [{ criteriaId: criteria[0].id, levelId: levelId(criteria, 0, 3) }],
      feedback: "",
    });

    const result = await exportGradesCSV(assignment.id);
    expect(result.missing).toBeNull();
  });
});
