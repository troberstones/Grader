"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useGrading } from "@/components/shared/grading-context";
import { useGradeActions } from "@/hooks/use-grade-actions";
import type { StudentWithGrade } from "@/actions/grades";
import type { getAssignment } from "@/actions/assignments";
import { toast } from "sonner";

type Assignment = NonNullable<Awaited<ReturnType<typeof getAssignment>>>;

/** One student's entries: criteriaId → { levelId, score }. */
export type EntryMap = Record<number, { levelId: number; score: number }>;

export type RubricGrading = ReturnType<typeof useRubricGrading>;

/**
 * Everything needed to score one student against a rubric: local entry state,
 * debounced auto-save, and the guard that flushes a pending save before the
 * selection moves to another student.
 *
 * This used to live inside GradeSheetClient. It came out so the rubric can be
 * scored from two places — the full grade sheet and the panel docked beside the
 * art reviewer — without either one owning the save logic.
 *
 * Mount this ONCE per page. It claims `selectHandlerRef`, so a second live
 * instance would fight the first over who flushes before a student switch.
 */
export function useRubricGrading(assignment: Assignment) {
  const {
    students,
    updateStudentGrade,
    selectedStudentId,
    setSelectedStudentId,
    selectHandlerRef,
  } = useGrading();
  const { save, clear, exportCsv, saving, exporting } = useGradeActions(assignment.id);

  const selectedStudent = students.find((s) => s.id === selectedStudentId) ?? null;
  const criteria = assignment.rubric?.criteria ?? [];

  const [entryMap, setEntryMap] = useState<EntryMap>(() =>
    entriesOf(selectedStudent as StudentWithGrade | null),
  );
  const [feedback, setFeedbackState] = useState(
    (selectedStudent as StudentWithGrade | null)?.grade?.feedback ?? "",
  );
  const [dirty, setDirty] = useState(false);
  // Ref so async callbacks always read current dirty state without stale closures.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Load a student's saved grade into local state.
  // Casts students to StudentWithGrade[] to access entries/feedback — the
  // context stores the full type internally; GradingStudent is the narrow
  // public view used by sidebar/nav components.
  const loadStudent = useCallback(
    (studentId: number) => {
      const student = (students as StudentWithGrade[]).find((s) => s.id === studentId);
      if (!student) return;
      setEntryMap(entriesOf(student));
      setFeedbackState(student.grade?.feedback ?? "");
      setDirty(false);
    },
    [students],
  );

  // ── Auto-save ─────────────────────────────────────────────────────────────
  // handleSaveRef is reassigned every render so timer callbacks always call the
  // version that closes over the current entryMap/feedback/etc.
  const handleSaveRef = useRef<(markComplete?: boolean) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      void handleSaveRef.current(false);
    }, 1500);
  }, []);

  const flushAutoSave = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (dirtyRef.current) await handleSaveRef.current(false);
  }, []);

  const totalScore = Object.values(entryMap).reduce((sum, e) => sum + e.score, 0);
  const gradedCriteria = Object.keys(entryMap).length;
  const allGraded = criteria.length > 0 && gradedCriteria === criteria.length;

  async function handleSave(markComplete = false) {
    if (!selectedStudentId) return;

    if (markComplete && !allGraded) {
      toast.warning("Select a level for every criterion before marking complete");
      return;
    }

    const entries = Object.entries(entryMap).map(([criteriaId, e]) => ({
      criteriaId: Number(criteriaId),
      levelId: e.levelId,
      score: e.score,
    }));

    const result = await save({
      assignmentId: assignment.id,
      studentId: selectedStudentId,
      entries,
      feedback,
    });
    if (!result) return;

    // Push updated grade into context so the sidebar reflects new status/score.
    const currentFull = (students as StudentWithGrade[]).find(
      (s) => s.id === selectedStudentId,
    );
    updateStudentGrade(selectedStudentId, {
      id: currentFull?.grade?.id ?? 0,
      totalScore: result.totalScore,
      feedback,
      status: result.status,
      gradedAt: result.status === "graded" ? new Date().toISOString() : null,
      exportedAt: currentFull?.grade?.exportedAt ?? null,
      entries: entries.map((e) => ({ ...e, comment: null })),
    });

    if (markComplete) toast.success("Graded ✓");
    setDirty(false);

    // Auto-advance to the next ungraded student.
    if (markComplete) {
      const currentIdx = students.findIndex((s) => s.id === selectedStudentId);
      const next = students.find((s, i) => i > currentIdx && s.grade?.status !== "graded");
      if (next) {
        setSelectedStudentId(next.id);
        loadStudent(next.id);
      }
    }
  }
  // Always point the ref at the latest render's closure so timers stay fresh.
  handleSaveRef.current = handleSave;

  async function handleClear() {
    if (!selectedStudentId) return;
    if (!confirm("Clear this student's grade and start over?")) return;
    const ok = await clear(selectedStudentId);
    if (!ok) return;
    setEntryMap({});
    setFeedbackState("");
    setDirty(false);
    updateStudentGrade(selectedStudentId, null);
    toast.success("Grade cleared");
  }

  // Keep the latest version of the selection guard in a local ref so the
  // context-level handler wrapper never goes stale without re-registration.
  const guardRef = useRef<(id: number) => void>(() => {});
  guardRef.current = (studentId: number) => {
    // Flush any pending auto-save before switching students.
    void (async () => {
      await flushAutoSave();
      setSelectedStudentId(studentId);
      loadStudent(studentId);
    })();
  };

  // Register a stable wrapper once on mount; restore the default on unmount.
  useLayoutEffect(() => {
    selectHandlerRef.current = (id) => guardRef.current(id);
    return () => {
      selectHandlerRef.current = (id) => setSelectedStudentId(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Toggle one level on a criterion — clicking the selected level clears it. */
  function selectLevel(criteriaId: number, levelId: number, score: number) {
    setEntryMap((prev) => {
      if (prev[criteriaId]?.levelId === levelId) {
        const next = { ...prev };
        delete next[criteriaId];
        return next;
      }
      return { ...prev, [criteriaId]: { levelId, score } };
    });
    setDirty(true);
    scheduleAutoSave();
  }

  /** Wholesale replacement, as the V3 view reports it. */
  function setEntries(entries: { criteriaId: number; levelId: number; score: number }[]) {
    const next: EntryMap = {};
    for (const e of entries) next[e.criteriaId] = { levelId: e.levelId, score: e.score };
    setEntryMap(next);
    setDirty(true);
    scheduleAutoSave();
  }

  function setFeedback(text: string) {
    setFeedbackState(text);
    setDirty(true);
    scheduleAutoSave();
  }

  return {
    assignment,
    criteria,
    selectedStudent,
    entryMap,
    feedback,
    setFeedback,
    dirty,
    totalScore,
    gradedCriteria,
    allGraded,
    saving,
    exporting,
    selectLevel,
    setEntries,
    handleSave,
    handleClear,
    exportCsv,
    loadStudent,
  };
}

function entriesOf(student: StudentWithGrade | null): EntryMap {
  const map: EntryMap = {};
  for (const entry of student?.grade?.entries ?? []) {
    if (entry.levelId !== null && entry.score !== null) {
      map[entry.criteriaId] = { levelId: entry.levelId, score: entry.score };
    }
  }
  return map;
}
