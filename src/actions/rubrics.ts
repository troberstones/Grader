"use server";

import { db } from "@/db";
import { rubrics, rubricCriteria, rubricLevels, gradeEntries } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { RubricJSON, RubricCriterion, RubricSettings } from "@/types/rubric";
import { requireCapability } from "@/lib/auth/require";
import { validateRubric, isShareModel, type AuthoredRubric } from "@/lib/rubric";
import { writeAudit } from "@/lib/audit";

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

export async function updateRubric(
  id: number,
  data: {
    name: string;
    description?: string;
    settings?: RubricSettings;
    criteria: Array<{
      id?: number;
      name: string;
      description?: string;
      weight: number;
      levels: Array<{ id?: number; level: number; label: string; description: string; points: number }>;
    }>;
  }
) {
  await requireCapability("course.edit");
  await db.update(rubrics).set({
    name: data.name,
    description: data.description,
    settings: data.settings ? JSON.stringify(data.settings) : null,
    updatedAt: new Date().toISOString(),
  }).where(eq(rubrics.id, id));

  // Delete existing criteria and re-insert (simplest for reordering)
  const existingCriteria = await db.select().from(rubricCriteria).where(eq(rubricCriteria.rubricId, id));
  for (const c of existingCriteria) {
    await db.delete(rubricLevels).where(eq(rubricLevels.criteriaId, c.id));
  }
  await db.delete(rubricCriteria).where(eq(rubricCriteria.rubricId, id));

  for (let i = 0; i < data.criteria.length; i++) {
    const c = data.criteria[i];
    const criterion = await db
      .insert(rubricCriteria)
      .values({ rubricId: id, name: c.name, description: c.description, sortOrder: i, weight: c.weight })
      .returning();

    for (const level of c.levels) {
      await db.insert(rubricLevels).values({ criteriaId: criterion[0].id, level: level.level, label: level.label, description: level.description, points: level.points });
    }
  }

  revalidatePath("/rubrics");
  revalidatePath(`/rubrics/${id}`);
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
 * reconciled by NAME, not array position: matching by position would
 * silently reassign a row's identity the moment two criteria are reordered,
 * which would make a student's existing grade for "Lighting" read back as
 * belonging to whatever criterion now occupies that row. A criterion whose
 * name disappears is archived (not deleted) if it has grade history, so
 * those grades stay FK-valid and readable; otherwise it's removed outright.
 *
 * Known, accepted limitation: a plain rename is indistinguishable from
 * remove-and-add-under-a-new-name, since AuthoredCriterion carries no id
 * (correctly — it also has to accept fresh AI-pasted JSON, which never
 * will). Worst case: an unnecessary archive of a criterion that still reads
 * fine under its old name in grade history. Reorder — the common, dangerous
 * case — is handled exactly right by this.
 */
export async function updateShareRubric(id: number, data: AuthoredRubric): Promise<void> {
  await requireCapability("course.edit");
  const result = validateRubric(data);
  if (!result.ok || !result.rubric) {
    throw new Error(result.errors.map((e) => `${e.where}: ${e.message}`).join("; "));
  }
  const normal = result.rubric;

  db.transaction((tx) => {
    tx.update(rubrics)
      .set({
        name: normal.name,
        description: normal.description,
        settings: JSON.stringify({ model: "share", bandEdges: normal.bandEdges }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(rubrics.id, id))
      .run();

    const existing = tx
      .select()
      .from(rubricCriteria)
      .where(and(eq(rubricCriteria.rubricId, id), eq(rubricCriteria.archived, 0)))
      .all();
    const existingByName = new Map(existing.map((c) => [c.name.toLowerCase(), c]));
    const matchedIds = new Set<number>();

    normal.criteria.forEach((criterion, i) => {
      const match = existingByName.get(criterion.name.toLowerCase());
      if (match) {
        matchedIds.add(match.id);
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
  });

  revalidatePath("/rubrics");
  revalidatePath(`/rubrics/${id}`);
}

export async function deleteRubric(id: number) {
  const actor = await requireCapability("course.edit");
  const [rubric] = await db.select({ name: rubrics.name }).from(rubrics).where(eq(rubrics.id, id));
  const criteria = await db.select().from(rubricCriteria).where(eq(rubricCriteria.rubricId, id));
  for (const c of criteria) {
    await db.delete(rubricLevels).where(eq(rubricLevels.criteriaId, c.id));
  }
  await db.delete(rubricCriteria).where(eq(rubricCriteria.rubricId, id));
  await db.delete(rubrics).where(eq(rubrics.id, id));
  await writeAudit(actor, { action: "rubric.delete", targetType: "rubric", targetId: id, detail: { name: rubric?.name } });
  revalidatePath("/rubrics");
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

export async function importRubricFromJSON(json: RubricJSON) {
  await requireCapability("course.edit");
  return createRubric({
    name: json.name,
    description: json.description,
    settings: json.settings,
    criteria: json.criteria.map((c) => ({
      name: c.name,
      description: c.description,
      weight: c.weight,
      levels: c.levels,
    })),
  });
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
