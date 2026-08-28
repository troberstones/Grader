import { BAND_PRESETS, DEFAULT_BAND_EDGES, bandEdgesProblem, round1 } from "./bands";
import { validateRubric } from "./validate";
import type { AuthoredRubric, BandEdges } from "./types";

/**
 * Converting a rubric authored by the archived v1/v2/v3 editors into the
 * share model.
 *
 * Those editors stored an absolute point value on every level, and a `weight`
 * that has been 1.0 on every criterion ever written. The share model stores
 * neither: a criterion carries a relative `share`, the rubric carries three
 * `bandEdges`, and points are computed from the assignment. So the conversion
 * runs the old arithmetic backwards.
 *
 * **The rule this module exists to honour: a converted rubric must award every
 * already-graded student exactly the percentage they have now.** A legacy
 * criterion scored `points[level]` out of `points[3]`, and the rubric total was
 * the sum across criteria. Expressed as fractions that is precisely the share
 * model — `share` is the criterion's maximum, and each band edge is that
 * level's points as a fraction of the maximum. Nothing is re-weighted and
 * nothing is re-calibrated here. Recalibration is a decision the professor
 * makes afterwards in the editor, where `previewOutcomes` shows what it does
 * before it is applied to anyone.
 *
 * Two things the old shape can express and the new one cannot, both reported
 * rather than silently papered over:
 *
 * 1. **Per-criterion band families.** Band edges are a property of the rubric,
 *    not the criterion. A legacy rubric whose criteria used different point
 *    families cannot be represented exactly; the dominant family is chosen and
 *    the divergence is reported per criterion.
 * 2. **A zero-point bottom level.** `bandEdges` must be strictly inside (0, 1)
 *    — a 0% floor makes submitted-but-poor work identical to submitting
 *    nothing, which is what the `missing` status is for. Such a rubric is
 *    refused rather than quietly given a floor it never had.
 */

/** How closely two point families have to agree to count as the same one. */
const RATIO_PRECISION = 4;

export interface ConversionNote {
  /** Human-facing location, matching validate.ts's `Issue.where`. */
  where: string;
  message: string;
}

export interface ConversionResult {
  ok: boolean;
  rubric: AuthoredRubric | null;
  /** Why the conversion failed. Empty when `ok`. */
  errors: ConversionNote[];
  /**
   * Converted, but worth a human's attention — an inexact band family, or a
   * rubric that grades fine yet would fail the editor's own validation if it
   * were saved without a wording fix.
   */
  warnings: ConversionNote[];
  /**
   * True when every already-recorded grade against this rubric keeps its exact
   * percentage. False means the band family was not uniform and the reported
   * criteria will shift.
   */
  exact: boolean;
}

export interface LegacyLevel {
  level: number;
  label: string;
  description: string;
  points: number | null;
}

export interface LegacyCriterion {
  name: string;
  description?: string | null;
  weight: number;
  levels: LegacyLevel[];
}

export interface LegacyRubric {
  name: string;
  description?: string | null;
  settings?: { gradingMode?: string; bandEdges?: number[] } | null;
  criteria: LegacyCriterion[];
}

export interface ConversionOptions {
  /**
   * Force a calibration instead of deriving one from the stored points.
   *
   * The escape hatch for a rubric that cannot be converted faithfully — in
   * practice one with a 0-point bottom level, which the share model has no way
   * to express. Grades already recorded against such a rubric WILL move, so
   * this is never a default: the caller has to ask for it, and should report
   * the movement to whoever is deciding.
   */
  bandEdges?: BandEdges;
}

export function convertLegacyRubric(legacy: LegacyRubric, options: ConversionOptions = {}): ConversionResult {
  const errors: ConversionNote[] = [];
  const warnings: ConversionNote[] = [];
  const err = (where: string, message: string) => errors.push({ where, message });
  const warn = (where: string, message: string) => warnings.push({ where, message });

  if (!legacy.criteria?.length) {
    return { ok: false, rubric: null, errors: [{ where: "the rubric", message: "has no criteria to convert." }], warnings, exact: true };
  }

  // ── Per-criterion: the maximum becomes the share, the ratios become a
  //    candidate band family. ────────────────────────────────────────────
  const converted: Array<{
    name: string;
    description?: string;
    share: number;
    /** This criterion's OWN band family, or null when its points cannot express one. */
    ratios: [number, number, number] | null;
    levels: { description: string }[];
  }> = [];

  legacy.criteria.forEach((criterion, i) => {
    const where = `criterion ${i + 1}${criterion.name ? ` ("${criterion.name}")` : ""}`;
    const levels = [...criterion.levels].sort((a, b) => a.level - b.level);

    if (levels.length !== 4) {
      err(where, `has ${levels.length} levels; the share model's grid is exactly four.`);
      return;
    }

    const points = levels.map((l) => l.points ?? 0);
    const max = points[3];

    if (!(max > 0)) {
      err(where, `has a top level worth ${max} points, so there is nothing to express the other levels as a fraction of.`);
      return;
    }

    const ratios = [points[0] / max, points[1] / max, points[2] / max] as [number, number, number];
    const problem = bandEdgesProblem(ratios);
    if (problem && options.bandEdges) {
      // Forced calibration: the criterion's own ratios are unusable, but its
      // maximum still gives an honest share, which is all that is needed.
      warn(where, `had level points of ${points.join(" / ")}, which the share model cannot express. It has been given the calibration you chose, so grades already recorded against this criterion change.`);
      converted.push({
        name: criterion.name,
        description: criterion.description ?? undefined,
        share: max,
        ratios: null,
        levels: levels.map((l) => ({ description: l.description })),
      });
      return;
    }
    if (problem) {
      err(
        where,
        points[0] === 0
          ? `awards 0 points at its lowest level. The share model has no 0% band — submitted work that misses the mark is not the same as nothing submitted, which is what the "missing" status records. Choose a calibration preset for this rubric by hand instead.`
          : `has level points of ${points.join(" / ")}, which as fractions ${problem}.`,
      );
      return;
    }

    // `weight` is deliberately not folded in. The v2/v3 editors derived each
    // criterion's maximum FROM its weight, so the points already carry the
    // weighting; multiplying by it again would count it twice. It has also
    // never held a value other than 1.0 in practice.
    if (criterion.weight !== 1) {
      warn(where, `carried weight ${criterion.weight}, which is ignored: its point maximum (${round1(max)}) already reflects that weighting and now becomes the share.`);
    }

    converted.push({
      name: criterion.name,
      description: criterion.description ?? undefined,
      share: max,
      ratios,
      levels: levels.map((l) => ({ description: l.description })),
    });
  });

  if (errors.length) return { ok: false, rubric: null, errors, warnings, exact: false };

  // ── One band family for the rubric. ──────────────────────────────────────
  const derived = chooseBandEdges(converted);
  const edges = options.bandEdges ?? derived.edges;
  // Exact means every criterion's own points already said exactly this. A
  // criterion with no usable family of its own never qualifies.
  const exact = converted.every((c) => c.ratios !== null && sameFamily(c.ratios, edges));
  const dissenters = options.bandEdges ? [] : derived.dissenters;

  if (options.bandEdges && !exact) {
    warn("the rubric", `has been given the ${presetName(options.bandEdges)} calibration (${formatFamily(options.bandEdges)} / 100%) rather than one derived from its points. Every grade already recorded against it changes.`);
  }

  for (const d of dissenters) {
    warn(
      d.where,
      `used a different point family (${d.family}) from the rest of the rubric (${formatFamily(edges)}). It has been given the rubric's family, so grades already recorded against this criterion shift by up to ${d.driftPercent}%.`,
    );
  }

  const rubric: AuthoredRubric = {
    version: 1,
    name: legacy.name,
    description: legacy.description ?? undefined,
    bandEdges: edges,
    criteria: converted.map((c) => ({
      name: c.name,
      description: c.description,
      share: round1(c.share),
      // Labels are dropped on purpose: every legacy rubric used the house
      // vocabulary, and omitting them lets the house labels apply, which is
      // what the share model expects from authored input.
      levels: c.levels,
    })),
  };

  // A rubric can be perfectly gradable and still fail the import validator —
  // duplicate level wording is the usual one. Grading keeps working either
  // way, but saving from the editor would be refused, so say so now rather
  // than at the moment the professor tries to fix a typo.
  const check = validateRubric(rubric);
  if (!check.ok) {
    for (const e of check.errors) {
      warn(e.where, `${e.message} The rubric still grades correctly, but the editor will refuse to save it until this is fixed.`);
    }
  }

  // v3 stored its own bandEdges. The stored points are what actually produced
  // every recorded grade, so they win — but a disagreement means the editor
  // was showing the professor something the grades did not reflect.
  const declared = legacy.settings?.bandEdges;
  if (declared?.length === 3 && !sameFamily(declared as BandEdges, edges)) {
    warn("the rubric", `declared band edges of ${formatFamily(declared as BandEdges)} in its settings, but its stored points work out to ${formatFamily(edges)}. The points were used, since those are what produced the grades on record.`);
  }

  return { ok: true, rubric, errors, warnings, exact };
}

/**
 * The band family the rubric as a whole is converted to.
 *
 * Chosen by share, not by headcount: if the family used by the two criteria
 * worth 60% of the assignment differs from the one used by the three small
 * ones, following the small ones would move more grade than following the
 * large ones.
 */
function chooseBandEdges(criteria: Array<{ name: string; share: number; ratios: [number, number, number] | null }>): {
  edges: BandEdges;
  dissenters: Array<{ where: string; family: string; driftPercent: number }>;
} {
  const families = new Map<string, { edges: BandEdges; share: number }>();
  for (const c of criteria) {
    if (!c.ratios) continue;
    const key = c.ratios.map((r) => r.toFixed(RATIO_PRECISION)).join("|");
    const existing = families.get(key);
    if (existing) existing.share += c.share;
    else families.set(key, { edges: c.ratios, share: c.share });
  }

  // Every criterion unusable: only reachable with a forced calibration, which
  // the caller supplies and which overrides this anyway.
  const winner = [...families.values()].sort((a, b) => b.share - a.share)[0];
  const edges = winner?.edges ?? DEFAULT_BAND_EDGES;

  if (families.size <= 1) return { edges, dissenters: [] };

  const dissenters = criteria
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.ratios !== null && !sameFamily(c.ratios, edges))
    .map(({ c, i }) => ({
      where: `criterion ${i + 1} ("${c.name}")`,
      family: formatFamily(c.ratios!),
      driftPercent: round1(Math.max(...c.ratios!.map((r, level) => Math.abs(r - edges[level]))) * 100),
    }));

  return { edges, dissenters };
}

function sameFamily(a: BandEdges | readonly number[], b: BandEdges): boolean {
  return [0, 1, 2].every((i) => a[i].toFixed(RATIO_PRECISION) === b[i].toFixed(RATIO_PRECISION));
}

function presetName(edges: BandEdges): string {
  for (const [name, preset] of Object.entries(BAND_PRESETS)) {
    if (sameFamily(edges, preset)) return name;
  }
  return "custom";
}

function formatFamily(edges: BandEdges | readonly number[]): string {
  return edges.map((e) => `${round1(e * 100)}%`).join(" / ");
}
