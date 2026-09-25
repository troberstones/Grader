import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, courseMembers, courses, gradeEntries, grades, rubricCriteria, rubricLevels, rubrics, students, users } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { deleteRubric, updateShareRubric } from "@/actions/rubrics";
import type { AuthoredRubric } from "@/lib/rubric";

// Lets a single test force `recomputeGrade` to throw for a specific grade id,
// to prove the rescore pass rolls back together with the rubric edit (same
// `db.transaction`). Delegates to the real implementation for every other
// grade id, so every other test in this file exercises the genuine scoring
// logic untouched.
const rescoreMockState = vi.hoisted(() => ({ explodeGradeId: null as number | null }));

vi.mock("@/lib/grading/recompute", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/grading/recompute")>();
  const recomputeGrade: typeof actual.recomputeGrade = (tx, gradeId) => {
    if (gradeId === rescoreMockState.explodeGradeId) {
      throw new Error("simulated recompute failure");
    }
    return actual.recomputeGrade(tx, gradeId);
  };
  return { ...actual, recomputeGrade };
});

afterEach(() => {
  rescoreMockState.explodeGradeId = null;
});

async function seedSignedInUser(globalRole: "instructor" | "assistant" | "admin" = "instructor") {
  const passwordHash = await hashPassword("password123456");
  const [user] = await db
    .insert(users)
    .values({ name: "User", email: `user-${Date.now()}-${Math.random()}@example.test`, passwordHash, globalRole, status: "active" })
    .returning();
  await createSession(user.id, {});
  return user;
}

/**
 * A minimal share-model rubric row with the same two criteria names
 * authoredPayload() below uses, so a round-trip through updateShareRubric()
 * always matches criteria BY NAME and only ever takes the update path —
 * never the insert-a-new-criterion path, which writes `points: null` into
 * rubric_levels and would hit the NOT NULL constraint the real migration
 * history has there (see the note on test/global-setup.ts in the task brief;
 * that gap is pre-existing and out of scope here).
 */
async function seedShareRubric(name = "Composition") {
  const [rubric] = await db
    .insert(rubrics)
    .values({ name, settings: JSON.stringify({ model: "share", bandEdges: [0.4, 0.7, 0.9] }) })
    .returning();
  for (const [i, cname] of ["Balance", "Craft"].entries()) {
    const [criterion] = await db.insert(rubricCriteria).values({ rubricId: rubric.id, name: cname, sortOrder: i, weight: 1 }).returning();
    // rubric_levels.points is NOT NULL in the real migration history
    // (drizzle/0000_loud_hitman.sql), even though schema.ts's TS type allows
    // null for share-model rows — see test/global-setup.ts.
    await db.insert(rubricLevels).values({ criteriaId: criterion.id, level: 0, label: "Emerging", description: "…", points: 0 });
  }
  return rubric;
}

/** A rubric payload that satisfies validateRubric(): >= 2 criteria, each with exactly 4 levels and distinguishable descriptions. */
function authoredPayload(name: string): AuthoredRubric {
  const levels = (label: string) => [
    { label: "Emerging", description: `${label} is barely present in this submission.` },
    { label: "Developing", description: `${label} shows some effort but has clear gaps.` },
    { label: "Proficient", description: `${label} is solid with only minor flaws.` },
    { label: "Mastery", description: `${label} is executed at a professional level.` },
  ];
  return {
    version: 1,
    name,
    criteria: [
      { name: "Balance", share: 1, levels: levels("Balance") },
      { name: "Craft", share: 1, levels: levels("Craft") },
    ],
  };
}

// ─── Rescore fixtures ───────────────────────────────────────────────────────
//
// Distinct from seedShareRubric()/authoredPayload() above: those deliberately
// give each criterion only a level-0 row, so a round-trip through
// updateShareRubric() always matches by name and never inserts a new
// criterion. The rescore tests below need the opposite — real grade_entries
// selecting real levels — so every criterion here gets all four.

async function seedSignedInAdmin() {
  const passwordHash = await hashPassword("adminpassword123456");
  const [admin] = await db
    .insert(users)
    .values({ name: "Admin", email: `admin-${Date.now()}-${Math.random()}@example.test`, passwordHash, globalRole: "admin", status: "active" })
    .returning();
  await createSession(admin.id, {});
  return admin;
}

async function seedStudent(name = `Student ${Date.now()}-${Math.random()}`) {
  const [student] = await db.insert(students).values({ name, sortName: name }).returning();
  return student;
}

/** A share-model rubric with every named criterion given all four levels, so grade_entries can select any of them. */
async function seedGradableShareRubric(
  name: string,
  criteriaNames: string[],
  bandEdges: [number, number, number] = [0.4, 0.7, 0.9],
) {
  const [rubric] = await db
    .insert(rubrics)
    .values({ name, settings: JSON.stringify({ model: "share", bandEdges }) })
    .returning();
  const criteria: Record<string, { id: number; levelIds: [number, number, number, number] }> = {};
  for (const [i, cname] of criteriaNames.entries()) {
    const [criterion] = await db.insert(rubricCriteria).values({ rubricId: rubric.id, name: cname, sortOrder: i, weight: 1 }).returning();
    const levelIds: number[] = [];
    for (let level = 0; level < 4; level++) {
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

async function seedAssignmentForRubric(rubricId: number | null, pointsPossible = 100) {
  const [course] = await db.insert(courses).values({ name: "Studio I", code: "ART 101", year: 2026, term: "fall" }).returning();
  const [assignment] = await db
    .insert(assignments)
    .values({ courseId: course.id, name: "Portrait Study", rubricId, pointsPossible })
    .returning();
  return assignment;
}

async function seedGrade(
  assignmentId: number,
  status: "ungraded" | "in_progress" | "graded" | "missing",
  entries: Array<{ criteriaId: number; levelId: number | null }> = [],
  totalScore: number | null = null,
) {
  const student = await seedStudent();
  const [grade] = await db
    .insert(grades)
    .values({ assignmentId, studentId: student.id, status, totalScore, gradedAt: status === "graded" ? new Date().toISOString() : null })
    .returning();
  for (const e of entries) {
    await db.insert(gradeEntries).values({ gradeId: grade.id, criteriaId: e.criteriaId, levelId: e.levelId });
  }
  return { student, grade };
}

/** Like authoredPayload(), but with an explicit criteria list/shares — for tests that add, drop, or reweight criteria. */
function sharePayload(
  name: string,
  criteria: Array<{ name: string; share?: number }>,
  bandEdges: [number, number, number] = [0.4, 0.7, 0.9],
): AuthoredRubric {
  const levels = (label: string) => [
    { label: "Emerging", description: `${label} is barely present in this submission.` },
    { label: "Developing", description: `${label} shows some effort but has clear gaps.` },
    { label: "Proficient", description: `${label} is solid with only minor flaws.` },
    { label: "Mastery", description: `${label} is executed at a professional level.` },
  ];
  return {
    version: 1,
    name,
    bandEdges,
    criteria: criteria.map((c) => ({ name: c.name, share: c.share ?? 1, levels: levels(c.name) })),
  };
}

describe("deleteRubric", () => {
  it("refuses a rubric that's still attached to an assignment, listing it by name", async () => {
    const owner = await seedSignedInUser("instructor");
    const rubric = await seedShareRubric();
    const [course] = await db.insert(courses).values({ name: "Studio I", code: "ART 101", year: 2026, term: "fall" }).returning();
    // The caller has course.edit on the using course — this test is about
    // the "in use" refusal, not the authorization check covered below.
    await db.insert(courseMembers).values({ courseId: course.id, userId: owner.id, role: "owner" });
    await db.insert(assignments).values({ courseId: course.id, name: "Portrait Study", rubricId: rubric.id, pointsPossible: 100 });

    const result = await deleteRubric(rubric.id);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("in_use");
      expect(result.message).toContain("Portrait Study");
    }
    expect(await db.select().from(rubrics).where(eq(rubrics.id, rubric.id))).toHaveLength(1);
  });

  it("deletes an unused rubric and cascades its criteria/levels", async () => {
    await seedSignedInUser("instructor");
    const rubric = await seedShareRubric("Unused Rubric");

    const result = await deleteRubric(rubric.id);
    expect(result).toEqual({ ok: true });

    expect(await db.select().from(rubrics).where(eq(rubrics.id, rubric.id))).toHaveLength(0);
    expect(await db.select().from(rubricCriteria).where(eq(rubricCriteria.rubricId, rubric.id))).toHaveLength(0);
  });
});

describe("rubric authorization when in use", () => {
  it("refuses to update an in-use rubric for a caller without course.edit on the using course", async () => {
    const owner = await seedSignedInUser("instructor");
    const rubric = await seedShareRubric("Shared Rubric");
    const [course] = await db.insert(courses).values({ name: "Studio I", code: "ART 101", year: 2026, term: "fall" }).returning();
    await db.insert(courseMembers).values({ courseId: course.id, userId: owner.id, role: "owner" });
    await db.insert(assignments).values({ courseId: course.id, name: "Life Drawing", rubricId: rubric.id, pointsPossible: 100 });

    // A second instructor, active but with no membership in that course.
    await seedSignedInUser("instructor");

    await expect(updateShareRubric(rubric.id, authoredPayload("Renamed"))).rejects.toThrow(/permission/i);

    const [unchanged] = await db.select().from(rubrics).where(eq(rubrics.id, rubric.id));
    expect(unchanged.name).toBe("Shared Rubric");
  });

  it("still allows the course's own owner to update it", async () => {
    const owner = await seedSignedInUser("instructor");
    const rubric = await seedShareRubric("Owned Rubric");
    const [course] = await db.insert(courses).values({ name: "Studio I", code: "ART 101", year: 2026, term: "fall" }).returning();
    await db.insert(courseMembers).values({ courseId: course.id, userId: owner.id, role: "owner" });
    await db.insert(assignments).values({ courseId: course.id, name: "Life Drawing", rubricId: rubric.id, pointsPossible: 100 });

    // Re-sign-in as the owner (seedShareRubric/seedSignedInUser calls above didn't touch the session).
    await createSession(owner.id, {});

    await expect(updateShareRubric(rubric.id, authoredPayload("Renamed by Owner"))).resolves.toEqual({
      rescored: 0,
      nowInProgress: 0,
    });
    const [updated] = await db.select().from(rubrics).where(eq(rubrics.id, rubric.id));
    expect(updated.name).toBe("Renamed by Owner");
  });

  it("leaves an unused rubric editable by any instructor with the global capability", async () => {
    await seedSignedInUser("instructor");
    const rubric = await seedShareRubric("Library Rubric");

    await expect(updateShareRubric(rubric.id, authoredPayload("Library Rubric (edited)"))).resolves.toEqual({
      rescored: 0,
      nowInProgress: 0,
    });
    const [updated] = await db.select().from(rubrics).where(eq(rubrics.id, rubric.id));
    expect(updated.name).toBe("Library Rubric (edited)");
  });
});

describe("updateShareRubric rescoring", () => {
  it("rescores every existing grade's total when a criterion's share changes", async () => {
    await seedSignedInAdmin();
    const { rubric, criteria } = await seedGradableShareRubric("Composition", ["Balance", "Craft"]);
    const assignment = await seedAssignmentForRubric(rubric.id, 100);
    const { grade } = await seedGrade(
      assignment.id,
      "graded",
      [
        { criteriaId: criteria.Balance.id, levelId: criteria.Balance.levelIds[2] }, // fraction .9
        { criteriaId: criteria.Craft.id, levelId: criteria.Craft.levelIds[3] }, // fraction 1.0
      ],
      95, // (.9*1 + 1*1) / 2 * 100
    );

    const outcome = await updateShareRubric(
      rubric.id,
      sharePayload("Composition", [
        { name: "Balance", share: 3 },
        { name: "Craft", share: 1 },
      ]),
    );

    expect(outcome).toEqual({ rescored: 1, nowInProgress: 0 });
    const [updated] = await db.select().from(grades).where(eq(grades.id, grade.id));
    expect(updated.totalScore).toBe(92.5); // (.9*3 + 1*1) / 4 * 100
    expect(updated.status).toBe("graded");
  });

  it("sends a fully-graded student back to in_progress when a new criterion is added", async () => {
    await seedSignedInAdmin();
    const { rubric, criteria } = await seedGradableShareRubric("Composition", ["Balance", "Craft"]);
    const assignment = await seedAssignmentForRubric(rubric.id, 100);
    const { grade } = await seedGrade(
      assignment.id,
      "graded",
      [
        { criteriaId: criteria.Balance.id, levelId: criteria.Balance.levelIds[2] },
        { criteriaId: criteria.Craft.id, levelId: criteria.Craft.levelIds[3] },
      ],
      95,
    );

    const outcome = await updateShareRubric(
      rubric.id,
      sharePayload("Composition", [{ name: "Balance" }, { name: "Craft" }, { name: "Layout" }]),
    );

    expect(outcome).toEqual({ rescored: 1, nowInProgress: 1 });
    const [updated] = await db.select().from(grades).where(eq(grades.id, grade.id));
    expect(updated.status).toBe("in_progress");
    // The new criterion has no entry yet, so it isn't in the weighted average —
    // the two already-scored criteria still read 95 even though the grade is
    // no longer complete.
    expect(updated.totalScore).toBe(95);

    const layout = await db.select().from(rubricCriteria).where(eq(rubricCriteria.name, "Layout"));
    expect(layout).toHaveLength(1);
  });

  it("rescores without an archived criterion, and leaves that criterion's own row archived rather than deleted", async () => {
    await seedSignedInAdmin();
    const { rubric, criteria } = await seedGradableShareRubric("Composition", ["Balance", "Craft", "Layout"]);
    const assignment = await seedAssignmentForRubric(rubric.id, 100);
    const { grade } = await seedGrade(
      assignment.id,
      "graded",
      [
        { criteriaId: criteria.Balance.id, levelId: criteria.Balance.levelIds[2] }, // .9
        { criteriaId: criteria.Craft.id, levelId: criteria.Craft.levelIds[3] }, // 1.0
        { criteriaId: criteria.Layout.id, levelId: criteria.Layout.levelIds[1] }, // .7
      ],
      86.7, // (.9+1+.7)/3 * 100, rounded
    );

    // Layout dropped from the authored payload, and it has grade history —
    // so updateShareRubric() must archive it, not delete it (see the FK note
    // on updateShareRubric's own doc comment).
    const outcome = await updateShareRubric(rubric.id, sharePayload("Composition", [{ name: "Balance" }, { name: "Craft" }]));

    expect(outcome).toEqual({ rescored: 1, nowInProgress: 0 });
    const [updated] = await db.select().from(grades).where(eq(grades.id, grade.id));
    expect(updated.totalScore).toBe(95); // (.9+1)/2 * 100 — Layout's entry no longer counted
    expect(updated.status).toBe("graded");

    const [layoutRow] = await db.select().from(rubricCriteria).where(eq(rubricCriteria.id, criteria.Layout.id));
    expect(layoutRow.archived).toBe(1);
    // The stale entry itself is left in place (FK-valid, just no longer scored) — see recomputeGrade().
    const layoutEntry = await db.select().from(gradeEntries).where(eq(gradeEntries.criteriaId, criteria.Layout.id));
    expect(layoutEntry).toHaveLength(1);
  });

  it("leaves a missing grade untouched", async () => {
    await seedSignedInAdmin();
    const { rubric, criteria } = await seedGradableShareRubric("Composition", ["Balance", "Craft"]);
    const assignment = await seedAssignmentForRubric(rubric.id, 100);
    const { grade: gradedRow } = await seedGrade(
      assignment.id,
      "graded",
      [
        { criteriaId: criteria.Balance.id, levelId: criteria.Balance.levelIds[2] },
        { criteriaId: criteria.Craft.id, levelId: criteria.Craft.levelIds[3] },
      ],
      95,
    );
    const { grade: missingRow } = await seedGrade(assignment.id, "missing", [], null);

    const outcome = await updateShareRubric(
      rubric.id,
      sharePayload("Composition", [
        { name: "Balance", share: 3 },
        { name: "Craft", share: 1 },
      ]),
    );

    // Only the graded student is rescored; "missing" stays exactly as it was.
    expect(outcome).toEqual({ rescored: 1, nowInProgress: 0 });
    const [stillMissing] = await db.select().from(grades).where(eq(grades.id, missingRow.id));
    expect(stillMissing.status).toBe("missing");
    expect(stillMissing.totalScore).toBeNull();
    const [rescored] = await db.select().from(grades).where(eq(grades.id, gradedRow.id));
    expect(rescored.totalScore).toBe(92.5);
  });

  it("rolls back the rubric edit if rescoring a grade fails partway through", async () => {
    await seedSignedInAdmin();
    const { rubric, criteria } = await seedGradableShareRubric("Composition", ["Balance", "Craft"]);
    const assignment = await seedAssignmentForRubric(rubric.id, 100);
    const { grade: grade1 } = await seedGrade(
      assignment.id,
      "graded",
      [
        { criteriaId: criteria.Balance.id, levelId: criteria.Balance.levelIds[2] },
        { criteriaId: criteria.Craft.id, levelId: criteria.Craft.levelIds[3] },
      ],
      95,
    );
    const { grade: grade2 } = await seedGrade(
      assignment.id,
      "graded",
      [
        { criteriaId: criteria.Balance.id, levelId: criteria.Balance.levelIds[3] },
        { criteriaId: criteria.Craft.id, levelId: criteria.Craft.levelIds[3] },
      ],
      100,
    );

    rescoreMockState.explodeGradeId = grade2.id;

    await expect(
      updateShareRubric(
        rubric.id,
        sharePayload("Renamed But Should Roll Back", [
          { name: "Balance", share: 3 },
          { name: "Craft", share: 1 },
        ]),
      ),
    ).rejects.toThrow(/simulated recompute failure/);

    // Neither the rubric edit nor grade1's rescore (processed before the
    // throw) survive — same transaction, so it's all-or-nothing.
    const [unchangedRubric] = await db.select().from(rubrics).where(eq(rubrics.id, rubric.id));
    expect(unchangedRubric.name).toBe("Composition");
    const [unchangedGrade1] = await db.select().from(grades).where(eq(grades.id, grade1.id));
    expect(unchangedGrade1.totalScore).toBe(95);
    const [unchangedGrade2] = await db.select().from(grades).where(eq(grades.id, grade2.id));
    expect(unchangedGrade2.totalScore).toBe(100);
  });
});
