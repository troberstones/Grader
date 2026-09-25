import { describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  annotations,
  assignments,
  courses,
  gradeEntries,
  grades,
  reviewStrokes,
  rubricCriteria,
  rubricLevels,
  rubrics,
  students,
  submissions,
  users,
} from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { deleteAssignment, updateAssignment } from "@/actions/assignments";

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

/** A share-model rubric with every named criterion given all four levels, so grade_entries can select any of them. */
async function seedGradableShareRubric(name: string, criteriaNames: string[] = ["Balance", "Craft"]) {
  const [rubric] = await db
    .insert(rubrics)
    .values({ name, settings: JSON.stringify({ model: "share", bandEdges: [0.4, 0.7, 0.9] }) })
    .returning();
  const criteria: Record<string, { id: number; levelIds: [number, number, number, number] }> = {};
  for (const [i, cname] of criteriaNames.entries()) {
    const [criterion] = await db.insert(rubricCriteria).values({ rubricId: rubric.id, name: cname, sortOrder: i, weight: 1 }).returning();
    const levelIds: number[] = [];
    for (let level = 0; level < 4; level++) {
      // rubric_levels.points is NOT NULL in the real migration history but
      // loosened to nullable on real databases — see test/global-setup.ts.
      const [row] = await db
        .insert(rubricLevels)
        .values({ criteriaId: criterion.id, level, label: `L${level}`, description: `${cname} at level ${level}.`, points: 0 })
        .returning();
      levelIds.push(row.id);
    }
    criteria[cname] = { id: criterion.id, levelIds: levelIds as [number, number, number, number] };
  }
  return { rubric, criteria };
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

describe("updateAssignment", () => {
  it("rescales every existing grade's total when pointsPossible changes", async () => {
    await seedSignedInAdmin();
    const { rubric, criteria } = await seedGradableShareRubric("Composition");
    const { course } = await seedCourseAndAssignment();
    const [assignment] = await db
      .insert(assignments)
      .values({ courseId: course.id, name: "Portrait Study", rubricId: rubric.id, pointsPossible: 100 })
      .returning();
    const student = await seedStudent();
    const [grade] = await db
      .insert(grades)
      .values({ assignmentId: assignment.id, studentId: student.id, status: "graded", totalScore: 95, gradedAt: new Date().toISOString() })
      .returning();
    await db.insert(gradeEntries).values({ gradeId: grade.id, criteriaId: criteria.Balance.id, levelId: criteria.Balance.levelIds[2] }); // .9
    await db.insert(gradeEntries).values({ gradeId: grade.id, criteriaId: criteria.Craft.id, levelId: criteria.Craft.levelIds[3] }); // 1.0

    const result = await updateAssignment(assignment.id, { pointsPossible: 50 });

    expect(result).toEqual({ ok: true, rescored: 1, nowInProgress: 0 });
    const [updated] = await db.select().from(grades).where(eq(grades.id, grade.id));
    expect(updated.totalScore).toBe(47.5); // (.9+1)/2 * 50
    expect(updated.status).toBe("graded");
    const [updatedAssignment] = await db.select().from(assignments).where(eq(assignments.id, assignment.id));
    expect(updatedAssignment.pointsPossible).toBe(50);
  });

  it("refuses to swap the rubric once a student has a grade, and leaves the assignment untouched", async () => {
    await seedSignedInAdmin();
    const { rubric: oldRubric } = await seedGradableShareRubric("Old Rubric");
    const { rubric: newRubric } = await seedGradableShareRubric("New Rubric");
    const { course } = await seedCourseAndAssignment();
    const [assignment] = await db
      .insert(assignments)
      .values({ courseId: course.id, name: "Portrait Study", rubricId: oldRubric.id, pointsPossible: 100 })
      .returning();
    const student = await seedStudent();
    await db.insert(grades).values({ assignmentId: assignment.id, studentId: student.id, status: "graded" });

    const result = await updateAssignment(assignment.id, { rubricId: newRubric.id });

    expect(result).toEqual({
      ok: false,
      reason: "rubric_swap_blocked",
      message: "Grades exist for this assignment — clear them or create a new assignment to use a different rubric.",
    });
    const [unchanged] = await db.select().from(assignments).where(eq(assignments.id, assignment.id));
    expect(unchanged.rubricId).toBe(oldRubric.id);
  });

  it("also refuses the swap when a grade's status is 'ungraded' but it already has entries", async () => {
    await seedSignedInAdmin();
    const { rubric: oldRubric, criteria } = await seedGradableShareRubric("Old Rubric");
    const { rubric: newRubric } = await seedGradableShareRubric("New Rubric");
    const { course } = await seedCourseAndAssignment();
    const [assignment] = await db
      .insert(assignments)
      .values({ courseId: course.id, name: "Portrait Study", rubricId: oldRubric.id, pointsPossible: 100 })
      .returning();
    const student = await seedStudent();
    // Status still "ungraded" (the DB default) even though it already has a
    // real entry — e.g. one criterion scored, none of the others touched
    // yet. gradedStudentCount() (the bar deleteAssignment() also uses) counts
    // this student as graded specifically to catch this state.
    const [grade] = await db.insert(grades).values({ assignmentId: assignment.id, studentId: student.id, status: "ungraded" }).returning();
    await db.insert(gradeEntries).values({ gradeId: grade.id, criteriaId: criteria.Balance.id, levelId: criteria.Balance.levelIds[2] });

    const result = await updateAssignment(assignment.id, { rubricId: newRubric.id });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("rubric_swap_blocked");
    const [unchanged] = await db.select().from(assignments).where(eq(assignments.id, assignment.id));
    expect(unchanged.rubricId).toBe(oldRubric.id);
  });

  it("allows the swap when nobody has been graded, and leaves no grade_entries behind for the old rubric's criteria", async () => {
    await seedSignedInAdmin();
    const { rubric: oldRubric, criteria } = await seedGradableShareRubric("Old Rubric");
    const { rubric: newRubric } = await seedGradableShareRubric("New Rubric");
    const { course } = await seedCourseAndAssignment();
    const [assignment] = await db
      .insert(assignments)
      .values({ courseId: course.id, name: "Portrait Study", rubricId: oldRubric.id, pointsPossible: 100 })
      .returning();
    const student = await seedStudent();
    await db.insert(grades).values({ assignmentId: assignment.id, studentId: student.id, status: "ungraded" });

    const result = await updateAssignment(assignment.id, { rubricId: newRubric.id });

    expect(result).toEqual({ ok: true, rescored: 0, nowInProgress: 0 });
    const [updated] = await db.select().from(assignments).where(eq(assignments.id, assignment.id));
    expect(updated.rubricId).toBe(newRubric.id);

    const oldCriteriaIds = Object.values(criteria).map((c) => c.id);
    const orphans = await db.select().from(gradeEntries).where(inArray(gradeEntries.criteriaId, oldCriteriaIds));
    expect(orphans).toHaveLength(0);
  });
});
