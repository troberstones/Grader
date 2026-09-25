"use client";

import { useState } from "react";
import { toast } from "sonner";
import { saveShareGrade, clearGrade, exportGradesCSV, markMissing } from "@/actions/grades";
import type { StudentGrade } from "@/actions/grades";

type ShareSavePayload = Parameters<typeof saveShareGrade>[0];

/**
 * Failure half of a grade-writing action's outcome, as seen by
 * use-rubric-grading.ts.
 *
 * `"auth"` is distinct from a plain thrown error precisely because the
 * caller reacts differently to it: it keeps the edit and offers a
 * sign-in-then-retry banner, rather than the transient, already-toasted
 * failure a generic `"error"` is.
 */
export type ActionFailure = { ok: false; reason: "auth" } | { ok: false; reason: "error" };

/**
 * Wraps the grade server actions with loading state so GradeSheetClient
 * never has to manage setSaving / setExporting or import action names directly.
 *
 * Returns stable async functions — callers decide what to do with the result.
 */
export function useGradeActions(assignmentId: number) {
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  /**
   * Save or update a student's grade for a share-model rubric
   * (src/lib/rubric/). Returns the new status/score/updatedAt so the caller
   * can update display state and advance its conflict-detection baseline.
   *
   * `saveShareGrade` can also report a "stale" conflict (someone else saved
   * this grade since it was last read, via `baseUpdatedAt`) or an "auth"
   * failure (session missing/expired, or capability revoked) — both are
   * passed through rather than toasted, so use-rubric-grading.ts can show
   * its persistent conflict/session banners instead.
   */
  async function saveShare(
    payload: ShareSavePayload,
  ): Promise<
    | { ok: true; status: StudentGrade["status"]; totalScore: number; updatedAt: string }
    | { ok: false; reason: "stale"; current: StudentGrade }
    | ActionFailure
  > {
    setSaving(true);
    try {
      const result = await saveShareGrade(payload);
      if (!result.success) {
        if (result.reason === "auth") return { ok: false, reason: "auth" };
        return { ok: false, reason: "stale", current: result.current };
      }
      return { ok: true, status: result.status, totalScore: result.totalScore, updatedAt: result.updatedAt };
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, reason: "error" };
    } finally {
      setSaving(false);
    }
  }

  /**
   * Marks a student as having submitted nothing — distinct from graded at
   * the lowest level. Shows a toast on a generic error; an "auth" failure is
   * passed through instead, for the same reason as `saveShare`.
   */
  async function markStudentMissing(studentId: number): Promise<{ ok: true; updatedAt: string } | ActionFailure> {
    try {
      const result = await markMissing(assignmentId, studentId);
      if (!result.success) return { ok: false, reason: "auth" };
      return { ok: true, updatedAt: result.updatedAt };
    } catch {
      toast.error("Failed to mark missing");
      return { ok: false, reason: "error" };
    }
  }

  /**
   * Clear a student's grade entirely. Shows a toast on a generic error; an
   * "auth" failure is passed through instead, for the same reason as
   * `saveShare`.
   */
  async function clear(studentId: number): Promise<{ ok: true } | ActionFailure> {
    try {
      const result = await clearGrade(assignmentId, studentId);
      if (!result.success) return { ok: false, reason: "auth" };
      return { ok: true };
    } catch {
      toast.error("Failed to clear grade");
      return { ok: false, reason: "error" };
    }
  }

  /**
   * Export all grades as a CSV string for Learning Suite.
   * Handles download trigger and error toast internally.
   * Returns true on success.
   */
  async function exportCsv(assignmentName: string): Promise<boolean> {
    setExporting(true);
    try {
      const { grades: gradesCsv, missing: missingCsv } = await exportGradesCSV(assignmentId);
      const safeName = assignmentName.replace(/\s+/g, "_");
      downloadCsv(gradesCsv, `${safeName}_grades.csv`);
      // Staggered so the browser treats it as a second, distinct download
      // rather than dropping it as a duplicate of the one just triggered.
      if (missingCsv) {
        setTimeout(() => downloadCsv(missingCsv, `${safeName}-missing.csv`), 300);
      }
      toast.success("Grades exported for Learning Suite");
      return true;
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      setExporting(false);
    }
  }

  return { saveShare, clear, markStudentMissing, exportCsv, saving, exporting };
}

/**
 * Triggers a browser download of `csv` as `filename`. The object URL is
 * revoked after a delay rather than immediately after `click()` — some
 * browsers (Safari in particular) need the URL to stay alive slightly past
 * the click, and firing two downloads back-to-back both need their URLs to
 * survive long enough to actually start. See
 * packages/art-review/src/react/components/InputLog.tsx's `save()` for the
 * same pattern.
 */
function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
