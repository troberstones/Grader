/**
 * Academic terms.
 *
 * Ordinal, not alphabetical — alphabetical order puts Fall before Spring,
 * which is wrong every single year. `termOrder` fixes a term's position
 * within its year; `termSortKey` combines it with the year so a list of
 * courses across years sorts correctly with one comparison.
 */

export const TERMS = ["winter", "spring", "summer", "fall"] as const;
export type Term = (typeof TERMS)[number];

export function isTerm(value: unknown): value is Term {
  return typeof value === "string" && (TERMS as readonly string[]).includes(value);
}

export const TERM_LABELS: Record<Term, string> = {
  winter: "Winter",
  spring: "Spring",
  summer: "Summer",
  fall: "Fall",
};

export function termOrder(term: Term): number {
  return TERMS.indexOf(term) + 1;
}

export function termSortKey(year: number, term: Term): number {
  return year * 10 + termOrder(term);
}

export function formatTerm(year: number, term: Term): string {
  return `${TERM_LABELS[term]} ${year}`;
}
