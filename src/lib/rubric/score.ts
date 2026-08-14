import { fractionFor, letterFor, levelFractions, round1 } from "./bands";
import type {
  BandEdges,
  CriterionOutcome,
  Level,
  NormalRubric,
  ScoreResult,
  Selection,
} from "./types";

/**
 * Turning level selections into a grade.
 *
 * The rubric is dimensionless — bands and shares, no points — and the
 * assignment supplies the total. One rubric therefore works unchanged on a
 * 50-point and a 200-point assignment, which is what makes a linked rubric
 * shared across course offerings viable.
 */

/**
 * Score a set of selections against a rubric.
 *
 * Two decisions worth knowing about:
 *
 * **Rounding happens exactly once, at the end.** Rounding each criterion and
 * summing introduces drift, which is where v1's 6.7 / 13.3 / 25.4 point values
 * came from. `CriterionOutcome` deliberately exposes a fraction and no points,
 * so there is nothing per-criterion to sum and round by mistake.
 *
 * **Part-graded rubrics report the grade so far.** The mean is taken over the
 * criteria that have selections, not over all of them, so a half-finished
 * rubric does not read as a failing grade to whoever glances at it mid-session.
 * Use `complete` to tell the two states apart.
 */
export function computeScore(
  rubric: NormalRubric,
  selections: readonly Selection[],
  pointsPossible: number,
): ScoreResult {
  const byIndex = new Map<number, Selection>();
  for (const s of selections) {
    if (s.criterionIndex >= 0 && s.criterionIndex < rubric.criteria.length) {
      byIndex.set(s.criterionIndex, s);
    }
  }

  const perCriterion: CriterionOutcome[] = [];
  let weighted = 0;
  let shareTotal = 0;

  rubric.criteria.forEach((criterion, i) => {
    const selection = byIndex.get(i);
    if (!selection) return;

    const nudge = selection.nudge ?? 0;
    const fraction = fractionFor(rubric.bandEdges, selection.level, nudge);

    perCriterion.push({
      criterionIndex: i,
      name: criterion.name,
      share: criterion.share,
      level: selection.level,
      nudge,
      fraction,
    });

    weighted += criterion.share * fraction;
    shareTotal += criterion.share;
  });

  const scored = perCriterion.length;
  const total = rubric.criteria.length;

  if (scored === 0 || shareTotal === 0) {
    return { scored: 0, total, complete: total === 0, fraction: null, percent: null, points: null, perCriterion };
  }

  const fraction = weighted / shareTotal;

  return {
    scored,
    total,
    complete: scored === total,
    fraction,
    percent: round1(fraction * 100),
    points: round1(fraction * pointsPossible),
    perCriterion,
  };
}

// ─── Authoring preview ──────────────────────────────────────────────────

export interface PreviewRow {
  label: string;
  /** How many criteria sit at each level, indexed 0–3. */
  counts: [number, number, number, number];
  percent: number;
  letter: string;
}

/**
 * What a set of band edges actually produces, for a rubric of `criteriaCount`
 * equally weighted criteria.
 *
 * This exists to be rendered in the rubric editor while the professor is still
 * authoring. The v1 miscalibration was discovered by grading test students and
 * noticing they failed; nobody should have to find it that way. Professors
 * calibrate from outcomes, not by reasoning about fractions.
 *
 * Weights are assumed equal — the preview is about calibrating bands, and
 * mixing in unequal shares would make each row depend on which criteria the
 * levels landed on.
 */
export function previewOutcomes(edges: BandEdges, criteriaCount: number): PreviewRow[] {
  const n = Math.max(1, Math.floor(criteriaCount));
  const half = Math.floor(n / 2);
  const rest = n - half;

  const mixes: Array<[string, [number, number, number, number]]> = [
    ["all mastery", [0, 0, 0, n]],
    ["all good, minor flaws", [0, 0, n, 0]],
    ["all lacking key aspects", [0, n, 0, 0]],
    ["all little / no effort", [n, 0, 0, 0]],
  ];

  if (n >= 2) {
    mixes.splice(1, 0, ["mastery except one good", [0, 0, 1, n - 1]]);
    mixes.splice(3, 0, ["half mastery, half good", [0, 0, half, rest]]);
    mixes.splice(5, 0, ["half good, half lacking", [0, half, rest, 0]]);
    mixes.push(["mastery except one no effort", [1, 0, 0, n - 1]]);
  }

  const f = levelFractions(edges);

  return mixes.map(([label, counts]) => {
    const sum = counts.reduce((acc, c, level) => acc + c * f[level], 0);
    const percent = round1((sum / n) * 100);
    return { label, counts, percent, letter: letterFor(percent) };
  });
}

/**
 * The fraction table for one set of band edges, including nudged positions.
 * Rendered beside the preset picker so the effect of a nudge is visible before
 * anyone relies on it.
 */
export function bandTable(edges: BandEdges): Array<{
  level: Level;
  minus: number;
  base: number;
  plus: number;
}> {
  return ([0, 1, 2, 3] as Level[]).map((level) => ({
    level,
    minus: round1(fractionFor(edges, level, -1) * 100),
    base: round1(fractionFor(edges, level, 0) * 100),
    plus: round1(fractionFor(edges, level, 1) * 100),
  }));
}
