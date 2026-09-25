import path from "path";
import type { BatchImporter, RosterEntry } from "./types";

/**
 * Learning Suite's Gradebook "Bundled Download": every file flat at the zip
 * root, named `Last_First_netid_originalName.ext`, e.g.
 *
 *   Michaelis_Callie_calliem3_Michaelis_Callie_Substance_Object1.png
 *   Gray_Rose_rosegray_Screenshot 2026-09-23 at 2.43.46 PM.png
 *
 * Names can contain underscores themselves (a two-part surname, a hyphen
 * turned into `_`), so the net ID can't be found by position. Instead this
 * scans the underscore-separated parts for the first one that is a net ID on
 * the roster, with at least a last and first name before it. The net ID is
 * the only part that identifies the student; the name parts in front are
 * ignored.
 */
export const learningSuiteImporter: BatchImporter = {
  id: "learning-suite",
  label: "Learning Suite batch download",

  match(entryPath: string, roster: RosterEntry[]) {
    const base = path.posix.basename(entryPath);
    const parts = base.split("_");
    if (parts.length < 4) return null;

    const byNetId = new Map<string, number>();
    for (const s of roster) if (s.netId) byNetId.set(s.netId.toLowerCase(), s.studentId);

    // Start at 2: a last name and a first name come first. Stop before the
    // last part: something has to be left for the student's own file name.
    for (let i = 2; i < parts.length - 1; i++) {
      const studentId = byNetId.get(parts[i].toLowerCase());
      if (studentId == null) continue;
      const fileName = parts.slice(i + 1).join("_");
      if (!path.extname(fileName)) continue;
      return { studentId, fileName };
    }
    return null;
  },
};
