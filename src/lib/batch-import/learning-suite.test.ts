import { describe, expect, it } from "vitest";
import { detectImporter, isJunkEntry } from "./index";
import { learningSuiteImporter } from "./learning-suite";
import type { RosterEntry } from "./types";

const roster: RosterEntry[] = [
  { studentId: 1, netId: "calliem3", name: "Callie Michaelis", sortName: "Michaelis, Callie" },
  { studentId: 2, netId: "rosegray", name: "Rose Gray", sortName: "Gray, Rose" },
  { studentId: 3, netId: "emrilj", name: "Emri Johnson", sortName: "Johnson, Emri" },
  { studentId: 4, netId: "jdlc9", name: "Juan de la Cruz", sortName: "de la Cruz, Juan" },
];

/** Names from a real Gradebook Bundled Download (Sep 2026). */
describe("learningSuiteImporter.match", () => {
  it("strips the Last_First_netid_ prefix", () => {
    expect(learningSuiteImporter.match("Michaelis_Callie_calliem3_Michaelis_Callie_Substance_Object1.png", roster)).toEqual({
      studentId: 1,
      fileName: "Michaelis_Callie_Substance_Object1.png",
    });
  });

  it("keeps spaces in the student's own file name", () => {
    expect(learningSuiteImporter.match("Gray_Rose_rosegray_Screenshot 2026-09-23 at 2.43.46 PM.png", roster)).toEqual({
      studentId: 2,
      fileName: "Screenshot 2026-09-23 at 2.43.46 PM.png",
    });
  });

  it("finds the net ID after a surname that contains underscores", () => {
    expect(learningSuiteImporter.match("de_la_Cruz_Juan_jdlc9_chair.mp4", roster)).toEqual({
      studentId: 4,
      fileName: "chair.mp4",
    });
  });

  it("matches net IDs case-insensitively and inside folders", () => {
    expect(learningSuiteImporter.match("bundle/Johnson_Emri_EMRILJ_johnson_emri-subpscreen.png", roster)).toEqual({
      studentId: 3,
      fileName: "johnson_emri-subpscreen.png",
    });
  });

  it("returns null for a student not on the roster", () => {
    expect(learningSuiteImporter.match("Galloway_Olivia_og114_Turnaround.mov", roster)).toBeNull();
  });
});

describe("detectImporter", () => {
  it("picks Learning Suite for a bundled download", () => {
    const names = ["Gray_Rose_rosegray_Searchlight_Turnaround.mp4", "__MACOSX/._x", ".DS_Store"];
    expect(detectImporter(names, roster)?.id).toBe("learning-suite");
  });

  it("returns null when nothing matches the roster", () => {
    expect(detectImporter(["render.png", "notes.txt"], roster)).toBeNull();
  });

  it("ignores zip clutter", () => {
    expect(isJunkEntry("__MACOSX/._a.png")).toBe(true);
    expect(isJunkEntry("folder/")).toBe(true);
    expect(isJunkEntry(".DS_Store")).toBe(true);
    expect(isJunkEntry("Gray_Rose_rosegray_a.png")).toBe(false);
  });
});
