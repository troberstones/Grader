"use client";

import { useState } from "react";
import { toast } from "sonner";
import { saveGrade, saveShareGrade, clearGrade, exportGradesCSV, markMissing } from "@/actions/grades";
import type { StudentGrade } from "@/actions/grades";

type SavePayload = Parameters<typeof saveGrade>[0];
type ShareSavePayload = Parameters<typeof saveShareGrade>[0];

/**
 * Wraps the three grade server actions with loading state so GradeSheetClient
 * never has to manage setSaving / setExporting or import action names directly.
 *
 * Returns stable async functions — callers decide what to do with the result.
 */
export function useGradeActions(assignmentId: number) {
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  /**
   * Save or update a student's grade. Returns the new status and total score
   * so the caller can update display state. Shows a toast on error.
   */
  async function save(
    payload: SavePayload,
  ): Promise<{ status: StudentGrade["status"]; totalScore: number } | null> {
    setSaving(true);
    try {
      return await saveGrade(payload);
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      setSaving(false);
    }
  }

  /** Same job as `save`, for a share-model rubric (src/lib/rubric/). */
  async function saveShare(
    payload: ShareSavePayload,
  ): Promise<{ status: StudentGrade["status"]; totalScore: number } | null> {
    setSaving(true);
    try {
      return await saveShareGrade(payload);
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
      const csv = await exportGradesCSV(assignmentId);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${assignmentName.replace(/\s+/g, "_")}_grades.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Grades exported for Learning Suite");
      return true;
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      setExporting(false);
    }
  }

  return { save, saveShare, clear, markStudentMissing, exportCsv, saving, exporting };
}
