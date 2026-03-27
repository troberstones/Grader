"use server";

import { db } from "@/db";
import { rubrics, rubricCriteria, rubricLevels } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { RubricJSON, RubricCriterion } from "@/types/rubric";

export async function getRubrics() {
  return db.select().from(rubrics).orderBy(desc(rubrics.updatedAt));
}

export async function getRubric(id: number) {
  const rubric = await db.select().from(rubrics).where(eq(rubrics.id, id));
  if (!rubric[0]) return null;

  const criteria = await db
    .select()
    .from(rubricCriteria)
    .where(eq(rubricCriteria.rubricId, id))
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

  return { ...rubric[0], criteria: criteriaWithLevels };
}

export async function createRubric(data: {
  name: string;
  description?: string;
  criteria: Array<{
    name: string;
    description?: string;
    weight: number;
    levels: Array<{ level: number; label: string; description: string; points: number }>;
  }>;
}) {
  const rubric = await db.insert(rubrics).values({ name: data.name, description: data.description }).returning();
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
    criteria: Array<{
      id?: number;
      name: string;
      description?: string;
      weight: number;
      levels: Array<{ id?: number; level: number; label: string; description: string; points: number }>;
    }>;
  }
) {
  await db.update(rubrics).set({ name: data.name, description: data.description, updatedAt: new Date().toISOString() }).where(eq(rubrics.id, id));

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

export async function deleteRubric(id: number) {
  const criteria = await db.select().from(rubricCriteria).where(eq(rubricCriteria.rubricId, id));
  for (const c of criteria) {
    await db.delete(rubricLevels).where(eq(rubricLevels.criteriaId, c.id));
  }
  await db.delete(rubricCriteria).where(eq(rubricCriteria.rubricId, id));
  await db.delete(rubrics).where(eq(rubrics.id, id));
  revalidatePath("/rubrics");
}

export async function duplicateRubric(id: number) {
  const original = await getRubric(id);
  if (!original) return null;
  return createRubric({
    name: `${original.name} (Copy)`,
    description: original.description ?? undefined,
    criteria: original.criteria.map((c) => ({
      name: c.name,
      description: c.description ?? undefined,
      weight: c.weight,
      levels: c.levels.map((l) => ({ level: l.level, label: l.label, description: l.description, points: l.points })),
    })),
  });
}

export async function importRubricFromJSON(json: RubricJSON) {
  return createRubric({
    name: json.name,
    description: json.description,
    criteria: json.criteria.map((c) => ({
      name: c.name,
      description: c.description,
      weight: c.weight,
      levels: c.levels,
    })),
  });
}

export async function exportRubricToJSON(id: number): Promise<RubricJSON | null> {
  const rubric = await getRubric(id);
  if (!rubric) return null;
  return {
    name: rubric.name,
    description: rubric.description ?? undefined,
    criteria: rubric.criteria.map((c) => ({
      name: c.name,
      description: c.description ?? undefined,
      weight: c.weight,
      levels: c.levels.map((l) => ({ level: l.level, label: l.label, description: l.description, points: l.points })),
    })),
  };
}
