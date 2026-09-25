"use client";

import { useState } from "react";
import { toast } from "sonner";
import { saveShareGrade, clearGrade, exportGradesCSV, markMissing } from "@/actions/grades";
import type { StudentGrade } from "@/actions/grades";

type ShareSavePayload = Parameters<typeof saveShareGrade>[0];

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
   * (src/lib/rubric/). Returns the new status and total score so the caller
   * can update display state. Shows a toast on error.
   *
   * `saveShareGrade` can also report a "stale" conflict (someone else saved
   * this grade since it was last read) via `{ success: false }` — no caller
   * today passes `baseUpdatedAt`, so that branch can't yet be hit, but it's
   * handled here rather than left as a type escape hatch. Wiring a real
   * conflict UI for it is later work.
   */
  async function saveShare(
    payload: ShareSavePayload,
  ): Promise<{ status: StudentGrade["status"]; totalScore: number } | null> {
    setSaving(true);
    try {
      const result = await saveShareGrade(payload);
      if (!result.success) {
        toast.error("This grade changed elsewhere — reload before saving again.");
        return null;
      }
      return { status: result.status, totalScore: result.totalScore };
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      setSaving(false);
    }
  }

  /**
   * Marks a student as having submitted nothing — distinct from graded at
   * the lowest level. Shows a toast on error. Returns true on success.
   */
  async function markStudentMissing(studentId: number): Promise<boolean> {
    try {
      await markMissing(assignmentId, studentId);
      return true;
    } catch {
      toast.error("Failed to mark missing");
      return false;
    }
  }

  /**
   * Clear a student's grade entirely. Shows a toast on error.
   * Returns true on success.
   */
  async function clear(studentId: number): Promise<boolean> {
    try {
      await clearGrade(assignmentId, studentId);
      return true;
    } catch {
      toast.error("Failed to clear grade");
      return false;
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
