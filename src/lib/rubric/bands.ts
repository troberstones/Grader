import type { BandEdges, Level, Nudge } from "./types";

/**
 * Band edges, letter grades, and the arithmetic that turns a level selection
 * into a fraction.
 *
 * The one thing to understand before changing anything here: percentage-of-
 * credit is not a quality scale. Academic grading compresses everything usable
 * into roughly 55–100, and below 60 is a single undifferentiated F. Spreading
 * four quality levels evenly across 0–100 puts three of them at or below
 * failing, which is exactly what the v1 rubrics did — work described as "Good
 * with Minor Flaws" in every category earned a C-.
 *
 * Four levels have the top ~45 points to work with, not 100.
 */

/** The house vocabulary, used whenever an authored level omits its label. */
export const HOUSE_LABELS: readonly [string, string, string, string] = [
  "Little / No Effort",
  "Lacking Key Aspects",
  "Good with Minor Flaws",
  "Professional / Mastery",
];

/**
 * Calibration presets. The choice between them is pedagogical, not cosmetic:
 * it answers "is level 3 something a good student in this course actually
 * achieves?"
 *
 * - `advanced` — level 3 is genuinely reachable, so B+ is the honest ceiling
 *   for good-but-flawed work.
 * - `foundation` — level 3 means professional and almost nobody will reach it.
 *   Without this a foundation class caps at B+ however well it is taught.
 */
export const BAND_PRESETS: Record<"advanced" | "foundation", BandEdges> = {
  advanced: [0.55, 0.74, 0.88],
  foundation: [0.6, 0.8, 0.92],
};

export const DEFAULT_BAND_EDGES: BandEdges = BAND_PRESETS.advanced;

/** All four levels as fractions. Level 3 is always 1.0. */
export function levelFractions(edges: BandEdges): [number, number, number, number] {
  return [edges[0], edges[1], edges[2], 1];
}

/**
 * The fraction earned by a level, optionally nudged a third of the way toward
 * the neighbouring band.
 *
 * The nudge exists so four descriptive states do not force a coarse instrument:
 * without it there is no way to say "solidly good, nearly mastery" and the
 * grader must round to 88% or 100%. Three positions per level gives ten
 * effective values while keeping four descriptions to write.
 *
 * Nudging down from level 0 has no band below it to aim at, so the gap is
 * extrapolated from the 0→1 gap. Nudging up from mastery does nothing, since
 * there is nothing above 100%.
 */
export function fractionFor(edges: BandEdges, level: Level, nudge: Nudge = 0): number {
  const f = levelFractions(edges);

  if (nudge === 0) return clamp(f[level]);

  if (nudge > 0) {
    if (level === 3) return 1;
    return clamp(f[level] + (f[level + 1] - f[level]) / 3);
  }

  const below = level === 0 ? f[0] - (f[1] - f[0]) : f[level - 1];
  return clamp(f[level] - (f[level] - below) / 3);
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Are these edges usable? Strictly increasing and strictly inside (0, 1).
 *
 * Zero is excluded deliberately: a level-0 floor of 0% makes submitted-but-poor
 * work identical to submitting nothing, which is both wrong and wastes the
 * bottom of the scale. Non-submission is a grade *status*, not a rubric level.
 */
export function bandEdgesProblem(edges: readonly number[]): string | null {
  if (edges.length !== 3) return "needs exactly three numbers, for levels 0, 1 and 2";
  for (const e of edges) {
    if (typeof e !== "number" || !Number.isFinite(e)) return "must all be numbers";
    if (e <= 0 || e >= 1) return "must all be between 0 and 1, exclusive";
  }
  if (!(edges[0] < edges[1] && edges[1] < edges[2])) return "must increase from level 0 to level 2";
  return null;
}

/** US letter scale. Used for the authoring preview, not for any stored grade. */
export const DEFAULT_LETTER_SCALE: ReadonlyArray<readonly [number, string]> = [
  [93, "A"], [90, "A-"], [87, "B+"], [83, "B"], [80, "B-"],
  [77, "C+"], [73, "C"], [70, "C-"], [67, "D+"], [60, "D"],
];

export function letterFor(
  percent: number,
  scale: ReadonlyArray<readonly [number, string]> = DEFAULT_LETTER_SCALE,
): string {
  for (const [floor, letter] of scale) {
    if (percent >= floor) return letter;
  }
  return "F";
}

/**
 * Round to one decimal place, guarding the float representation so that values
 * like 0.15 do not round down.
 */
export function round1(n: number): number {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}
