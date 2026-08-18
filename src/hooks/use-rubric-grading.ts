"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useGrading } from "@/components/shared/grading-context";
import { useGradeActions } from "@/hooks/use-grade-actions";
import type { StudentWithGrade } from "@/actions/grades";
import type { getAssignment } from "@/actions/assignments";
import { computeScore, criterionPoints, isShareModel, toNormalRubric } from "@/lib/rubric";
import type { Level, NormalRubric, Nudge, ScoreResult, Selection } from "@/lib/rubric";
import { toast } from "sonner";

type Assignment = NonNullable<Awaited<ReturnType<typeof getAssignment>>>;
type RubricCriteria = NonNullable<Assignment["rubric"]>["criteria"];

/** One student's entries: criteriaId → { levelId, score }. Legacy (points) model only. */
export type EntryMap = Record<number, { levelId: number; score: number }>;

/** One student's selections: criteriaId → { level, nudge }. Share model only. */
export type SelectionMap = Record<number, { level: Level; nudge: Nudge }>;

interface SharedGrading {
  assignment: Assignment;
  criteria: RubricCriteria;
  selectedStudent: ReturnType<typeof useGrading>["students"][number] | null;
  feedback: string;
  setFeedback: (text: string) => void;
  dirty: boolean;
  saving: boolean;
  exporting: boolean;
  handleSave: (markComplete?: boolean) => Promise<void>;
  handleClear: () => Promise<void>;
  handleMarkMissing: () => Promise<void>;
  exportCsv: (assignmentName: string) => Promise<boolean>;
  loadStudent: (studentId: number) => void;
}

export interface PointsGrading extends SharedGrading {
  model: "points";
  entryMap: EntryMap;
  totalScore: number;
  gradedCriteria: number;
  allGraded: boolean;
  selectLevel: (criteriaId: number, levelId: number, score: number) => void;
  setEntries: (entries: { criteriaId: number; levelId: number; score: number }[]) => void;
}

export interface ShareGrading extends SharedGrading {
  model: "share";
  selections: SelectionMap;
  scoreResult: ScoreResult | null;
  setSelection: (criteriaId: number, level: Level, nudge?: Nudge) => void;
}

export type RubricGrading = PointsGrading | ShareGrading;

/**
 * Everything needed to score one student against a rubric: local selection
 * state, debounced auto-save, and the guard that flushes a pending save
 * before the selection moves to another student.
 *
 * This used to live inside GradeSheetClient. It came out so the rubric can be
 * scored from two places — the full grade sheet and the panel docked beside the
 * art reviewer — without either one owning the save logic.
 *
 * Mount this ONCE per page. It claims `selectHandlerRef`, so a second live
 * instance would fight the first over who flushes before a student switch.
 *
 * Branches on `isShareModel(assignment.rubric)`: the legacy (points) branch is
 * untouched from before this rubric carried two models — same entryMap, same
 * additive totalScore, since that arithmetic is correct for its absolute-
 * points data. The share branch computes everything from `src/lib/rubric/`'s
 * pure engine, client-side, via useMemo — no round trip needed for the live
 * number as the grader drags a slider or taps a level.
 */
export function useRubricGrading(assignment: Assignment): RubricGrading {
  const {
    students,
    updateStudentGrade,
    selectedStudentId,
    setSelectedStudentId,
    selectHandlerRef,
  } = useGrading();
  const { save, saveShare, markStudentMissing, clear, exportCsv, saving, exporting } = useGradeActions(assignment.id);

  const selectedStudent = students.find((s) => s.id === selectedStudentId) ?? null;
  // Own useMemo so the fallback `[]` isn't a fresh reference on every render
  // — it's a dependency of loadStudent/selectionsList below.
  const criteria = useMemo(() => assignment.rubric?.criteria ?? [], [assignment.rubric]);
  const isShare = isShareModel({ settings: assignment.rubric?.settings ?? null });

  const [entryMap, setEntryMap] = useState<EntryMap>(() =>
    entriesOf(selectedStudent as StudentWithGrade | null),
  );
  const [selections, setSelections] = useState<SelectionMap>(() =>
    selectionsOf(selectedStudent as StudentWithGrade | null, criteria),
  );
  const [feedback, setFeedbackState] = useState(
    (selectedStudent as StudentWithGrade | null)?.grade?.feedback ?? "",
  );
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const loadStudent = useCallback(
    (studentId: number) => {
      const student = (students as StudentWithGrade[]).find((s) => s.id === studentId);
      if (!student) return;
      setEntryMap(entriesOf(student));
      setSelections(selectionsOf(student, criteria));
      setFeedbackState(student.grade?.feedback ?? "");
      setDirty(false);
    },
    [students, criteria],
  );

  // ── Share-model live scoring (pure, client-side) ────────────────────────
  const normalRubric = useMemo<NormalRubric | null>(() => {
    if (!isShare || !assignment.rubric) return null;
    return toNormalRubric({
      name: assignment.rubric.name,
      description: null,
      settings: assignment.rubric.settings ?? null,
      criteria: assignment.rubric.criteria.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        share: c.weight,
        levels: c.levels,
      })),
    });
  }, [isShare, assignment.rubric]);

  const selectionsList = useMemo<Selection[]>(() => {
    if (!normalRubric) return [];
    const list: Selection[] = [];
    criteria.forEach((c, i) => {
      const sel = selections[c.id];
      if (sel) list.push({ criterionIndex: i, level: sel.level, nudge: sel.nudge });
    });
    return list;
  }, [normalRubric, criteria, selections]);

  const scoreResult = useMemo<ScoreResult | null>(() => {
    if (!normalRubric) return null;
    return computeScore(normalRubric, selectionsList, assignment.pointsPossible);
  }, [normalRubric, selectionsList, assignment.pointsPossible]);

  // ── Auto-save ─────────────────────────────────────────────────────────────
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

  const totalScore = isShare
    ? scoreResult?.points ?? 0
    : Object.values(entryMap).reduce((sum, e) => sum + e.score, 0);
  const gradedCriteria = isShare ? scoreResult?.scored ?? 0 : Object.keys(entryMap).length;
  const allGraded = isShare
    ? scoreResult?.complete ?? false
    : criteria.length > 0 && gradedCriteria === criteria.length;

  async function handleSave(markComplete = false) {
    if (!selectedStudentId) return;

    if (markComplete && !allGraded) {
      toast.warning("Select a level for every criterion before marking complete");
      return;
    }

    let result: { status: import("@/types/grading").GradeStatus; totalScore: number } | null;
    let contextEntries: { criteriaId: number; levelId: number | null; score: number | null; comment: null; nudge: number | null }[];

    if (isShare) {
      const entries = criteria
        .map((c) => {
          const sel = selections[c.id];
          if (!sel) return null;
          const levelRow = c.levels.find((l) => l.level === sel.level);
          if (!levelRow) return null;
          return { criteriaId: c.id, levelId: levelRow.id, nudge: sel.nudge };
        })
        .filter((e): e is { criteriaId: number; levelId: number; nudge: Nudge } => e !== null);

      result = await saveShare({ assignmentId: assignment.id, studentId: selectedStudentId, entries, feedback });
      contextEntries = entries.map((e) => {
        const outcome = normalRubric && scoreResult
          ? scoreResult.perCriterion.find((o) => criteria[o.criterionIndex]?.id === e.criteriaId)
          : undefined;
        const score = normalRubric && outcome ? criterionPoints(normalRubric, outcome, assignment.pointsPossible) : null;
        return { criteriaId: e.criteriaId, levelId: e.levelId, score, comment: null, nudge: e.nudge };
      });
    } else {
      const entries = Object.entries(entryMap).map(([criteriaId, e]) => ({
        criteriaId: Number(criteriaId),
        levelId: e.levelId,
        score: e.score,
      }));
      result = await save({ assignmentId: assignment.id, studentId: selectedStudentId, entries, feedback });
      contextEntries = entries.map((e) => ({ ...e, comment: null, nudge: null }));
    }

    if (!result) return;

    const currentFull = (students as StudentWithGrade[]).find((s) => s.id === selectedStudentId);
    updateStudentGrade(selectedStudentId, {
      id: currentFull?.grade?.id ?? 0,
      totalScore: result.totalScore,
      feedback,
      status: result.status,
      gradedAt: result.status === "graded" ? new Date().toISOString() : null,
      exportedAt: currentFull?.grade?.exportedAt ?? null,
      entries: contextEntries,
    });

    if (markComplete) toast.success("Graded ✓");
    setDirty(false);

    if (markComplete) {
      const currentIdx = students.findIndex((s) => s.id === selectedStudentId);
      const next = students.find((s, i) => i > currentIdx && s.grade?.status !== "graded");
      if (next) {
        setSelectedStudentId(next.id);
        loadStudent(next.id);
      }
    }
  }
  handleSaveRef.current = handleSave;

  async function handleClear() {
    if (!selectedStudentId) return;
    if (!confirm("Clear this student's grade and start over?")) return;
    const ok = await clear(selectedStudentId);
    if (!ok) return;
    setEntryMap({});
    setSelections({});
    setFeedbackState("");
    setDirty(false);
    updateStudentGrade(selectedStudentId, null);
    toast.success("Grade cleared");
  }

  async function handleMarkMissing() {
    if (!selectedStudentId) return;
    const ok = await markStudentMissing(selectedStudentId);
    if (!ok) return;
    setEntryMap({});
    setSelections({});
    setFeedbackState("");
    setDirty(false);
    updateStudentGrade(selectedStudentId, {
      id: 0,
      totalScore: 0,
      feedback: null,
      status: "missing",
      gradedAt: new Date().toISOString(),
      exportedAt: null,
      entries: [],
    });
    toast.success("Marked missing");
  }

  const guardRef = useRef<(id: number) => void>(() => {});
  guardRef.current = (studentId: number) => {
    void (async () => {
      await flushAutoSave();
      setSelectedStudentId(studentId);
      loadStudent(studentId);
    })();
  };

  useLayoutEffect(() => {
    selectHandlerRef.current = (id) => guardRef.current(id);
    return () => {
      selectHandlerRef.current = (id) => setSelectedStudentId(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Toggle one level on a criterion — clicking the selected level clears it. Legacy (points) model only. */
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

  /** Wholesale replacement, as V3GradingView reports it. Legacy (points) model only. */
  function setEntries(entries: { criteriaId: number; levelId: number; score: number }[]) {
    const next: EntryMap = {};
    for (const e of entries) next[e.criteriaId] = { levelId: e.levelId, score: e.score };
    setEntryMap(next);
    setDirty(true);
    scheduleAutoSave();
  }

  /** Share model only — level + optional nudge for one criterion. */
  function setSelection(criteriaId: number, level: Level, nudge: Nudge = 0) {
    setSelections((prev) => ({ ...prev, [criteriaId]: { level, nudge } }));
    setDirty(true);
    scheduleAutoSave();
  }

  function setFeedback(text: string) {
    setFeedbackState(text);
    setDirty(true);
    scheduleAutoSave();
  }

  const sharedFields = {
    assignment,
    criteria,
    selectedStudent,
    feedback,
    setFeedback,
    dirty,
    saving,
    exporting,
    handleSave,
    handleClear,
    handleMarkMissing,
    exportCsv,
    loadStudent,
  };

  if (isShare) {
    return {
      ...sharedFields,
      model: "share",
      selections,
      scoreResult,
      setSelection,
    };
  }

  return {
    ...sharedFields,
    model: "points",
    entryMap,
    totalScore,
    gradedCriteria,
    allGraded,
    selectLevel,
    setEntries,
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

function selectionsOf(
  student: StudentWithGrade | null,
  criteria: { id: number; levels: { id: number; level: number }[] }[],
): SelectionMap {
  const map: SelectionMap = {};
  for (const entry of student?.grade?.entries ?? []) {
    if (entry.levelId === null) continue;
    const criterion = criteria.find((c) => c.id === entry.criteriaId);
    const levelRow = criterion?.levels.find((l) => l.id === entry.levelId);
    if (!levelRow) continue;
    const nudge: Nudge = entry.nudge === -1 || entry.nudge === 1 ? entry.nudge : 0;
    map[entry.criteriaId] = { level: levelRow.level as Level, nudge };
  }
  return map;
}
