import { DEFAULT_BAND_EDGES } from "./bands";
import type { BandEdges, Level, NormalCriterion, NormalLevel, NormalRubric, Nudge, Selection } from "./types";

/**
 * The boundary between persisted rows (ids, DB-shaped nullability) and the
 * pure engine (array indices, no ids at all — see Selection in types.ts).
 *
 * Duck-typed against plain shapes rather than importing from `@/db/schema`,
 * so this stays a dependency-free module like the rest of `src/lib/rubric/`
 * — compiled and tested standalone by scripts/build-rubric-test.sh, with no
 * Next.js/Drizzle in the loop.
 */

export interface DbLevelRow {
  id: number;
  level: number;
  label: string;
  description: string;
}

export interface DbCriterionRow {
  id: number;
  name: string;
  description: string | null;
  share: number;
  levels: DbLevelRow[];
}

export interface DbRubricRow {
  name: string;
  description: string | null;
  settings: { model?: string; bandEdges?: BandEdges } | null;
  criteria: DbCriterionRow[];
}

export interface DbSelectionRow {
  criteriaId: number;
  levelId: number | null;
  nudge?: number | null;
}

/** Is this rubric authored by the share-model editor, vs. the legacy v1/v2/v3 ones? */
export function isShareModel(rubric: Pick<DbRubricRow, "settings">): boolean {
  return rubric.settings?.model === "share";
}

export function toNormalRubric(rubric: DbRubricRow): NormalRubric {
  return {
    version: 1,
    name: rubric.name,
    description: rubric.description,
    bandEdges: rubric.settings?.bandEdges ?? DEFAULT_BAND_EDGES,
    criteria: rubric.criteria.map(toNormalCriterion),
  };
}

function toNormalCriterion(criterion: DbCriterionRow): NormalCriterion {
  const byLevel = new Map(criterion.levels.map((l) => [l.level, l]));
  const levels = ([0, 1, 2, 3] as const).map((level): NormalLevel => {
    const row = byLevel.get(level);
    return { label: row?.label ?? "", description: row?.description ?? "" };
  }) as [NormalLevel, NormalLevel, NormalLevel, NormalLevel];

  return {
    name: criterion.name,
    description: criterion.description,
    share: criterion.share,
    levels,
  };
}

/** DB rows (criteriaId/levelId) → the engine's index-based Selection[]. Entries with no level chosen yet are skipped. */
export function toSelections(criteria: DbCriterionRow[], entries: DbSelectionRow[]): Selection[] {
  const selections: Selection[] = [];
  for (const entry of entries) {
    if (entry.levelId == null) continue;
    const criterionIndex = criteria.findIndex((c) => c.id === entry.criteriaId);
    if (criterionIndex === -1) continue;
    const levelRow = criteria[criterionIndex].levels.find((l) => l.id === entry.levelId);
    if (!levelRow) continue;
    selections.push({
      criterionIndex,
      level: levelRow.level as Level,
      nudge: normalizeNudge(entry.nudge),
    });
  }
  return selections;
}

/** The engine's Selection[] → rows ready to persist as grade_entries. */
export function fromSelections(
  criteria: DbCriterionRow[],
  selections: readonly Selection[],
): { criteriaId: number; levelId: number; nudge: Nudge }[] {
  const out: { criteriaId: number; levelId: number; nudge: Nudge }[] = [];
  for (const selection of selections) {
    const criterion = criteria[selection.criterionIndex];
    if (!criterion) continue;
    const levelRow = criterion.levels.find((l) => l.level === selection.level);
    if (!levelRow) continue;
    out.push({ criteriaId: criterion.id, levelId: levelRow.id, nudge: selection.nudge ?? 0 });
  }
  return out;
}

function normalizeNudge(n: number | null | undefined): Nudge {
  return n === -1 || n === 1 ? n : 0;
}
