import path from "path";
import type { BatchImporter, RosterEntry } from "./types";
import { learningSuiteImporter } from "./learning-suite";

export type { BatchImporter, RosterEntry, EntryMatch } from "./types";

/** Every known bundle format. Add new importers here. */
export const IMPORTERS: BatchImporter[] = [learningSuiteImporter];

/** Zip clutter that is never a submission: macOS resource forks, Finder metadata, folders. */
export function isJunkEntry(entryPath: string): boolean {
  if (entryPath.endsWith("/")) return true;
  if (entryPath.startsWith("__MACOSX/")) return true;
  const base = path.posix.basename(entryPath);
  return base.startsWith(".") || base === "Thumbs.db" || base === "desktop.ini";
}

/**
 * The importer that can place the most files in this zip on the roster, or
 * null if none can place any. Scoring by matches rather than asking each
 * format whether it recognizes itself means a zip that is only mostly one
 * format still imports what it can, and two formats that happen to overlap
 * resolve toward whichever fits this class.
 */
export function detectImporter(entryPaths: string[], roster: RosterEntry[]): BatchImporter | null {
  const files = entryPaths.filter((p) => !isJunkEntry(p));
  let best: BatchImporter | null = null;
  let bestCount = 0;
  for (const importer of IMPORTERS) {
    const count = files.filter((p) => importer.match(p, roster) !== null).length;
    if (count > bestCount) {
      best = importer;
      bestCount = count;
    }
  }
  return best;
}
