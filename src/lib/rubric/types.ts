/**
 * Rubric authoring and scoring types.
 *
 * The central idea: **an authored rubric carries no point values.** It carries
 * band edges (what fraction of a criterion each level is worth) and per-criterion
 * shares (relative importance). The assignment supplies the points, and the score
 * is computed. See docs/rubric-authoring.md for why.
 *
 * Two shapes exist. `AuthoredRubric` is what arrives from outside — a professor's
 * paste from a chat assistant — where everything optional really is optional.
 * `NormalRubric` is what validation returns: same data with every default filled
 * in, so nothing downstream has to ask "was this omitted?".
 */

/** 0 = lowest, 3 = mastery. The index in a `levels` array IS the level. */
export type Level = 0 | 1 | 2 | 3;

/** Fine adjustment within a level: a third of the way toward the neighbour. */
export type Nudge = -1 | 0 | 1;

/**
 * Levels 0, 1 and 2 as fractions of a criterion's maximum. Level 3 is always
 * 1.0 and is therefore not stored.
 */
export type BandEdges = [number, number, number];

// ─── Authored (untrusted input) ─────────────────────────────────────────

export interface AuthoredLevel {
  label?: string;
  description: string;
}

export interface AuthoredCriterion {
  /**
   * The database row this criterion came from, when editing an existing
   * rubric — absent for a brand-new criterion (blank/template/paste-import/
   * AI-generated). Lets updateShareRubric() (src/actions/rubrics.ts) tell a
   * rename from a remove-and-add, so grade history survives a rename. Never
   * trust this across rubrics: the caller must reject an id that doesn't
   * belong to the rubric being saved.
   */
  id?: number;
  name: string;
  description?: string;
  share?: number;
  levels: AuthoredLevel[];
}

export interface AuthoredRubric {
  version: 1;
  name: string;
  description?: string;
  bandEdges?: BandEdges;
  criteria: AuthoredCriterion[];
}

// ─── Normalised (post-validation) ───────────────────────────────────────

export interface NormalLevel {
  label: string;
  description: string;
}

export interface NormalCriterion {
  /** Carried through from AuthoredCriterion.id unchanged — see its doc comment. */
  id?: number;
  name: string;
  description: string | null;
  share: number;
  levels: [NormalLevel, NormalLevel, NormalLevel, NormalLevel];
}

export interface NormalRubric {
  version: 1;
  name: string;
  description: string | null;
  bandEdges: BandEdges;
  criteria: NormalCriterion[];
}

// ─── Scoring ────────────────────────────────────────────────────────────

/** One grader decision: which level this criterion's work sits at. */
export interface Selection {
  criterionIndex: number;
  level: Level;
  nudge?: Nudge;
}

export interface CriterionOutcome {
  criterionIndex: number;
  name: string;
  share: number;
  level: Level;
  nudge: Nudge;
  /** This criterion's earned fraction, 0–1. */
  fraction: number;
}

export interface ScoreResult {
  /** How many criteria have a selection, and how many exist. */
  scored: number;
  total: number;
  complete: boolean;
  /**
   * Weighted mean fraction over the *scored* criteria only, so a part-graded
   * rubric reports the grade so far rather than a misleading low number.
   * `null` when nothing has been scored.
   */
  fraction: number | null;
  /** `fraction` as a percentage, rounded for display. */
  percent: number | null;
  /** Points out of the assignment's total. Rounded exactly once, here. */
  points: number | null;
  perCriterion: CriterionOutcome[];
}
