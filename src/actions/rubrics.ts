"use server";

import { db } from "@/db";
import { rubrics, rubricCriteria, rubricLevels, gradeEntries, assignments } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { RubricJSON, RubricSettings } from "@/types/rubric";
import { requireCapability } from "@/lib/auth/require";
import type { SessionUser } from "@/lib/auth/session";
import { validateRubric, isShareModel, type AuthoredRubric } from "@/lib/rubric";
import { writeAudit } from "@/lib/audit";
import { rescoreAssignmentGrades, type RescoreOutcome } from "@/lib/grading/rescore";

// ─── Authorization ──────────────────────────────────────────────────────────

/**
 * Rubrics are a global library (see roles.ts: `course.edit` on the global
 * resource is granted to any instructor/assistant), which is right for a
 * rubric nobody has attached to anything yet — but wrong the moment it's in
 * use, since editing it then changes grading for a course the caller may
 * have no part in. Without a schema change (no `course_id` on `rubrics`),
 * "in use" is derived from `assignments.rubric_id`: if any assignment uses
 * this rubric, the caller needs `course.edit` on every one of those
 * assignments' courses, not just the global capability. An unused rubric
 * keeps the old, library-wide behavior. Admins bypass this the same way they
 * bypass every other capability check, via can() in roles.ts.
 */
async function requireRubricEditAccess(rubricId: number): Promise<SessionUser> {
  const usingAssignments = await db
    .select({ courseId: assignments.courseId })
    .from(assignments)
    .where(eq(assignments.rubricId, rubricId));

  if (usingAssignments.length === 0) {
    return requireCapability("course.edit");
  }

  const courseIds = [...new Set(usingAssignments.map((a) => a.courseId))];
  let actor: SessionUser | null = null;
  for (const courseId of courseIds) {
    actor = await requireCapability("course.edit", { kind: "course", courseId });
  }
  return actor as SessionUser;
}

export async function getRubrics() {
  await requireCapability("course.view");
  return db.select().from(rubrics).orderBy(desc(rubrics.updatedAt));
}

export async function getRubric(id: number) {
  await requireCapability("course.view");
  const rubric = await db.select().from(rubrics).where(eq(rubrics.id, id));
  if (!rubric[0]) return null;

  const criteria = await db
    .select()
    .from(rubricCriteria)
    .where(and(eq(rubricCriteria.rubricId, id), eq(rubricCriteria.archived, 0)))
    .orderBy(rubricCriteria.sortOrder);

  const criteriaWithLevels = await Promise.all(
    criteria.map(async (criterion) => {
      const levels = await db
        .select()
        .from(rubricLevels)
        .where(eq(rubricLevels.criteriaId, criterion.id))
        .orderBy(rubricLevels.level);
      return { ...criterion, levels };
    })
  );

  return {
    ...rubric[0],
    settings: rubric[0].settings ? (JSON.parse(rubric[0].settings) as RubricSettings) : undefined,
    criteria: criteriaWithLevels,
  };
}

export async function createRubric(data: {
  name: string;
  description?: string;
  settings?: RubricSettings;
  criteria: Array<{
    name: string;
    description?: string;
    weight: number;
    // Nullable so cloneRubric() can round-trip a share-model rubric (whose
    // levels carry no stored points) through this same generic insert path.
    // v1/v2/v3 always pass a real number.
    levels: Array<{ level: number; label: string; description: string; points: number | null }>;
  }>;
}) {
  await requireCapability("course.edit");
  const rubric = await db.insert(rubrics).values({
    name: data.name,
    description: data.description,
    settings: data.settings ? JSON.stringify(data.settings) : null,
  }).returning();
  const rubricId = rubric[0].id;

  for (let i = 0; i < data.criteria.length; i++) {
    const c = data.criteria[i];
    const criterion = await db
      .insert(rubricCriteria)
      .values({ rubricId, name: c.name, description: c.description, sortOrder: i, weight: c.weight })
      .returning();

    for (const level of c.levels) {
      await db.insert(rubricLevels).values({ criteriaId: criterion[0].id, ...level });
    }
  }

  revalidatePath("/rubrics");
  return rubric[0];
}

/**
 * Creates a rubric authored by the share-model editor (src/lib/rubric/) —
 * no stored points, just a per-criterion `share` (held in the `weight`
 * column, same as legacy rubrics — see the comment on that column in
 * schema.ts) and a rubric-wide `bandEdges`, recorded in `settings.model`.
 */
export async function createShareRubric(data: AuthoredRubric): Promise<{ id: number }> {
  await requireCapability("course.edit");
  const result = validateRubric(data);
  if (!result.ok || !result.rubric) {
    throw new Error(result.errors.map((e) => `${e.where}: ${e.message}`).join("; "));
  }
  const normal = result.rubric;

  const inserted = db.transaction((tx) => {
    const rubric = tx
      .insert(rubrics)
      .values({
        name: normal.name,
        description: normal.description,
        settings: JSON.stringify({ model: "share", bandEdges: normal.bandEdges }),
      })
      .returning()
      .get();

    normal.criteria.forEach((criterion, i) => {
      const row = tx
        .insert(rubricCriteria)
        .values({ rubricId: rubric.id, name: criterion.name, description: criterion.description, sortOrder: i, weight: criterion.share })
        .returning()
        .get();
      criterion.levels.forEach((level, levelIdx) => {
        tx.insert(rubricLevels).values({ criteriaId: row.id, level: levelIdx, label: level.label, description: level.description, points: null }).run();
      });
    });

    return rubric;
  });

  revalidatePath("/rubrics");
  return { id: inserted.id };
}

/**
 * Updates a share-model rubric without the legacy `updateRubric`'s
 * delete-and-reinsert (which throws an FK error the moment a rubric has any
 * grade_entries against it — see docs/rubric-authoring.md). Criteria are
 * reconciled primarily by ID: the editor (src/components/rubric/share-editor/)
 * carries each existing criterion's database id along untouched, so a rename
 * or reorder still points at the same row and its grade_entries keep
 * counting. A criterion with no id — new from the grid's "Add Criterion", a
 * template, a paste-import, or an AI-generated rubric, none of which can know
 * a database id — falls back to matching an existing, still-unmatched
 * criterion by NAME, exactly as this function used to do for everything.
 * That fallback is what a plain rename used to be indistinguishable from a
 * remove-and-add-under-a-new-name; now the editor's own submissions never
 * need it; only older/foreign clients (JSON pasted from an export, or hand-
 * built payloads) still take that path, and reordering under it stays
 * handled exactly right, same as before.
 *
 * An id that doesn't belong to this rubric — stale, or lifted from a paste of
 * a *different* rubric's export — is rejected outright before any row is
 * touched; a caller must never be able to reach across rubrics by number. A
 * criterion whose row goes unmatched (name and id both fail to find it) is
 * archived (not deleted) if it has grade history, so those grades stay
 * FK-valid and readable; otherwise it's removed outright.
 *
 * Also rescores every existing grade on every assignment currently using
 * this rubric, in the SAME transaction as the edit (owner's decision): a
 * changed weight/share, band edges, level wording, or criteria set must land
 * or roll back together with the grades it affects, so the sidebar, CSV and
 * LS push can never disagree with the live grading panel. Adding a criterion
 * after students are fully graded flips them back to "in_progress" (the new
 * criterion has no entry yet) — the returned counts let the caller surface
 * that to the instructor.
 */
export async function updateShareRubric(id: number, data: AuthoredRubric): Promise<RescoreOutcome> {
  await requireRubricEditAccess(id);
  const result = validateRubric(data);
  if (!result.ok || !result.rubric) {
    throw new Error(result.errors.map((e) => `${e.where}: ${e.message}`).join("; "));
  }
  const normal = result.rubric;

  const outcome = db.transaction((tx) => {
    const existing = tx
      .select()
      .from(rubricCriteria)
      .where(and(eq(rubricCriteria.rubricId, id), eq(rubricCriteria.archived, 0)))
      .all();
    const existingById = new Map(existing.map((c) => [c.id, c]));
    const existingByName = new Map(existing.map((c) => [c.name.toLowerCase(), c]));

    // Reject a foreign/stale id before writing anything — an id only ever
    // identifies a row on *this* rubric. (The transaction would roll back
    // any partial writes anyway on a throw, but checking first means we
    // never attempt them.)
    const seenIds = new Set<number>();
    for (const criterion of normal.criteria) {
      if (criterion.id === undefined) continue;
      if (!existingById.has(criterion.id)) {
        throw new Error(
          `criterion "${criterion.name}" has an id (${criterion.id}) that does not belong to this rubric.`,
        );
      }
      if (seenIds.has(criterion.id)) {
        throw new Error(`criterion "${criterion.name}" repeats an id (${criterion.id}) already used in this rubric.`);
      }
      seenIds.add(criterion.id);
    }

    // Pre-claim every id match so the name fallback below only ever lands on
    // a row nothing else in this payload has already claimed — otherwise a
    // criterion renamed *away* from "Balance" earlier in the array could
    // still let some other, unrelated new criterion also named "Balance"
    // steal its row by that stale name.
    const matchedIds = new Set<number>(
      normal.criteria.filter((c) => c.id !== undefined).map((c) => c.id as number),
    );

    tx.update(rubrics)
      .set({
        name: normal.name,
        description: normal.description,
        settings: JSON.stringify({ model: "share", bandEdges: normal.bandEdges }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(rubrics.id, id))
      .run();

    normal.criteria.forEach((criterion, i) => {
      let match: (typeof existing)[number] | undefined;
      if (criterion.id !== undefined) {
        match = existingById.get(criterion.id);
      } else {
        const candidate = existingByName.get(criterion.name.toLowerCase());
        if (candidate && !matchedIds.has(candidate.id)) {
          match = candidate;
          matchedIds.add(candidate.id);
        }
      }

      if (match) {
        tx.update(rubricCriteria)
          .set({ name: criterion.name, description: criterion.description, weight: criterion.share, sortOrder: i })
          .where(eq(rubricCriteria.id, match.id))
          .run();
        criterion.levels.forEach((level, levelIdx) => {
          tx.update(rubricLevels)
            .set({ label: level.label, description: level.description })
            .where(and(eq(rubricLevels.criteriaId, match.id), eq(rubricLevels.level, levelIdx)))
            .run();
        });
      } else {
        const row = tx
          .insert(rubricCriteria)
          .values({ rubricId: id, name: criterion.name, description: criterion.description, sortOrder: i, weight: criterion.share })
          .returning()
          .get();
        criterion.levels.forEach((level, levelIdx) => {
          tx.insert(rubricLevels).values({ criteriaId: row.id, level: levelIdx, label: level.label, description: level.description, points: null }).run();
        });
      }
    });

    for (const criterion of existing) {
      if (matchedIds.has(criterion.id)) continue;
      const hasGrades = tx.select({ id: gradeEntries.id }).from(gradeEntries).where(eq(gradeEntries.criteriaId, criterion.id)).limit(1).all();
      if (hasGrades.length > 0) {
        tx.update(rubricCriteria).set({ archived: 1 }).where(eq(rubricCriteria.id, criterion.id)).run();
      } else {
        tx.delete(rubricLevels).where(eq(rubricLevels.criteriaId, criterion.id)).run();
        tx.delete(rubricCriteria).where(eq(rubricCriteria.id, criterion.id)).run();
      }
    }

    const affectedAssignmentIds = tx
      .select({ id: assignments.id })
      .from(assignments)
      .where(eq(assignments.rubricId, id))
      .all()
      .map((a) => a.id);

    return rescoreAssignmentGrades(tx, affectedAssignmentIds);
  });

  revalidatePath("/rubrics");
  revalidatePath(`/rubrics/${id}`);
  if (outcome.rescored > 0) {
    // Every assignment using this rubric may now show different totals/status.
    const affected = await db.select({ id: assignments.id }).from(assignments).where(eq(assignments.rubricId, id));
    for (const a of affected) revalidatePath(`/assignments/${a.id}`);
  }
  return outcome;
}

export type DeleteRubricOutcome = { ok: true } | { ok: false; reason: "in_use" | "not_found" | "referenced"; message: string };

/**
 * Deletes a rubric, refusing when any assignment still uses it (owner's
 * decision: rubrics in use can't be deleted, only unassigned first). Unlike
 * the old delete-criteria-then-criteria-then-rubric sequence, this is a
 * single statement inside a transaction: rubric_criteria.rubric_id and
 * rubric_levels.criteria_id both cascade (see drizzle/0000_loud_hitman.sql),
 * so deleting the rubrics row is enough — there's no partial-delete state to
 * leave behind if it fails partway.
 *
 * `grade_entries.criteria_id` does NOT cascade, so a criterion that still has
 * grade history from a *previous* rubric assignment (the assignment was
 * later repointed to a different rubric) would make the cascade fail at the
 * DB level even though no assignment currently references this rubric. That
 * edge case isn't covered by the owner's "in use" wording, so it's handled
 * conservatively here: caught and reported as a refusal rather than an
 * unhandled throw.
 */
export async function deleteRubric(id: number): Promise<DeleteRubricOutcome> {
  const actor = await requireRubricEditAccess(id);
  const [rubric] = await db.select({ name: rubrics.name }).from(rubrics).where(eq(rubrics.id, id));
  if (!rubric) return { ok: false, reason: "not_found", message: "Rubric not found." };

  const usingAssignments = await db.select({ name: assignments.name }).from(assignments).where(eq(assignments.rubricId, id));
  if (usingAssignments.length > 0) {
    const names = usingAssignments.map((a) => a.name).join(", ");
    return {
      ok: false,
      reason: "in_use",
      message: `This rubric is used by ${usingAssignments.length} assignment${usingAssignments.length === 1 ? "" : "s"} (${names}) — rubrics in use can't be deleted.`,
    };
  }

  try {
    db.transaction((tx) => {
      tx.delete(rubrics).where(eq(rubrics.id, id)).run();
    });
  } catch {
    return {
      ok: false,
      reason: "referenced",
      message: "This rubric can't be deleted because grade history still refers to it.",
    };
  }

  await writeAudit(actor, { action: "rubric.delete", targetType: "rubric", targetId: id, detail: { name: rubric.name } });
  revalidatePath("/rubrics");
  return { ok: true };
}

/**
 * Deep-clones a rubric: new rubric row, new criteria rows, new level rows,
 * fully independent from the source (never a live reference). Exported (with
 * its own check, since every export in a "use server" file is independently
 * RPC-reachable) so copyCourse() (src/actions/courses.ts) can reuse it for
 * per-assignment rubric cloning — the only difference from duplicateRubric()
 * is whether the "(Copy)" suffix is applied.
 */
export async function cloneRubric(id: number, nameOverride?: string) {
  await requireCapability("course.edit");
  const original = await getRubric(id);
  if (!original) return null;
  return createRubric({
    name: nameOverride ?? original.name,
    description: original.description ?? undefined,
    settings: original.settings ?? undefined,
    criteria: original.criteria.map((c) => ({
      name: c.name,
      description: c.description ?? undefined,
      weight: c.weight,
      levels: c.levels.map((l) => ({ level: l.level, label: l.label, description: l.description, points: l.points })),
    })),
  });
}

export async function duplicateRubric(id: number) {
  const original = await getRubric(id);
  if (!original) return null;
  return cloneRubric(id, `${original.name} (Copy)`);
}

export async function exportRubricToJSON(id: number): Promise<RubricJSON | AuthoredRubric | null> {
  await requireCapability("course.view");
  const rubric = await getRubric(id);
  if (!rubric) return null;

  if (isShareModel({ settings: rubric.settings ?? null })) {
    return {
      version: 1,
      name: rubric.name,
      description: rubric.description ?? undefined,
      bandEdges: rubric.settings?.bandEdges,
      criteria: rubric.criteria.map((c) => ({
        name: c.name,
        description: c.description ?? undefined,
        share: c.weight,
        levels: [...c.levels]
          .sort((a, b) => a.level - b.level)
          .map((l) => ({ label: l.label, description: l.description })),
      })),
    };
  }

  return {
    name: rubric.name,
    description: rubric.description ?? undefined,
    settings: rubric.settings ?? undefined,
    criteria: rubric.criteria.map((c) => ({
      name: c.name,
      description: c.description ?? undefined,
      weight: c.weight,
      // Legacy/v3 rubrics always have a real number here.
      levels: c.levels.map((l) => ({ level: l.level, label: l.label, description: l.description, points: l.points ?? 0 })),
    })),
  };
}
