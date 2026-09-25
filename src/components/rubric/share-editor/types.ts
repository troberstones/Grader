/**
 * The editor's in-progress state for one criterion: no points — just what a
 * professor edits directly. `id` is carried along (never edited directly by
 * the UI) so a save can tell "renamed this row" from "removed it and added a
 * new one" — see AuthoredCriterion's doc comment. Absent for a criterion that
 * didn't come from the database yet: blank/template start, paste-import, or
 * AI generation.
 */
export interface DraftCriterion {
  id?: number;
  name: string;
  description: string;
  share: number;
  /** Index is the level, 0-3 — same convention as the pure engine (src/lib/rubric/). */
  levels: [string, string, string, string];
}
