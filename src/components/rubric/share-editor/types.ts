/** The editor's in-progress state for one criterion: no ids, no points — just what a professor edits directly. */
export interface DraftCriterion {
  name: string;
  description: string;
  share: number;
  /** Index is the level, 0-3 — same convention as the pure engine (src/lib/rubric/). */
  levels: [string, string, string, string];
}
