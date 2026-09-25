import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, courseMembers, courses, rubricCriteria, rubricLevels, rubrics, users } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { deleteRubric, updateShareRubric } from "@/actions/rubrics";
import type { AuthoredRubric } from "@/lib/rubric";

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

    await expect(updateShareRubric(rubric.id, authoredPayload("Renamed by Owner"))).resolves.toBeUndefined();
    const [updated] = await db.select().from(rubrics).where(eq(rubrics.id, rubric.id));
    expect(updated.name).toBe("Renamed by Owner");
  });

  it("leaves an unused rubric editable by any instructor with the global capability", async () => {
    await seedSignedInUser("instructor");
    const rubric = await seedShareRubric("Library Rubric");

    await expect(updateShareRubric(rubric.id, authoredPayload("Library Rubric (edited)"))).resolves.toBeUndefined();
    const [updated] = await db.select().from(rubrics).where(eq(rubrics.id, rubric.id));
    expect(updated.name).toBe("Library Rubric (edited)");
  });
});
