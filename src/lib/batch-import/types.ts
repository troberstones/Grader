/**
 * A zip of student submissions, as some LMS bundles them for download, and
 * how to tell which student each file inside belongs to.
 *
 * Each LMS names its bundle differently, so each format is its own importer
 * and the zip picks one by detection rather than by the instructor saying
 * which it is. To support a new format, add an importer and register it in
 * ./index.ts — nothing else changes.
 */

export interface RosterEntry {
  studentId: number;
  netId: string | null;
  name: string;
  sortName: string;
}

export interface EntryMatch {
  studentId: number;
  /** The student's own file name, with whatever the LMS prepended removed. */
  fileName: string;
}

export interface BatchImporter {
  id: string;
  /** Shown to the instructor, e.g. "Learning Suite batch download". */
  label: string;
  /**
   * Which student a file in the zip belongs to, or null if this importer
   * can't tell. `entryPath` is the full path inside the zip ("a/b/c.png"), so
   * a folder-per-student format can read the folder name.
   */
  match(entryPath: string, roster: RosterEntry[]): EntryMatch | null;
}
