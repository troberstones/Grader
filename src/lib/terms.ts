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

/**
 * The last day of a term, as the moment feedback links stop working.
 *
 * Deliberately a little generous rather than exact: BYU's published end dates
 * move by a few days each year, and a link that dies the morning a student
 * goes to look at their final feedback is worse than one that lasts until the
 * end of the month. Winter runs January–April, Spring May–June, Summer
 * July–August, Fall September–December.
 */
const TERM_LAST_MONTH: Record<Term, number> = {
  winter: 4,
  spring: 6,
  summer: 8,
  fall: 12,
};

export function termEndDate(year: number, term: Term): Date {
  // Day 0 of the following month is the last day of this one; 23:59:59 UTC so
  // the whole final day counts in every US timezone.
  return new Date(Date.UTC(year, TERM_LAST_MONTH[term], 0, 23, 59, 59));
}
