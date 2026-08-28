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

/** One student's selections: criteriaId → { level, nudge }. */
export type SelectionMap = Record<number, { level: Level; nudge: Nudge }>;

/**
 * Everything the grading views and the panel read. One shape now — the
 * points-model half of this union went to the archive with the editors that
 * wrote it (src/components/rubric/_archive/).
 */
export interface ShareGrading {
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
  selections: SelectionMap;
  scoreResult: ScoreResult | null;
  setSelection: (criteriaId: number, level: Level, nudge?: Nudge) => void;
  /**
   * True when this assignment's rubric predates the share model and has not
   * been converted — see scripts/convert-legacy-rubrics-to-share.mjs.
   *
   * It is not enough to render a warning and carry on: an unconverted rubric
   * has no `bandEdges`, so scoring it would silently apply the *default*
   * calibration to level points that were written against a different one,
   * and quietly change what every student earns. So nothing is scored, no
   * criteria are exposed, and saving is refused outright.
   */
  unconverted: boolean;
}

/** The name the panel and the views use. */
export type RubricGrading = ShareGrading;

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
 * Everything is computed from `src/lib/rubric/`'s pure engine, client-side, via
 * useMemo — no round trip is needed for the live number as the grader drags a
 * slider or taps a level. The server recomputes the same figures from the
 * stored levels when the save lands, so nothing here is trusted as arithmetic
 * of record.
 *
 * A rubric that predates the share model is refused rather than scored: see
 * `unconverted` on ShareGrading.
 */
export function useRubricGrading(assignment: Assignment): RubricGrading {
  const {
    students,
    updateStudentGrade,
    selectedStudentId,
    setSelectedStudentId,
    selectHandlerRef,
  } = useGrading();
  const { saveShare, markStudentMissing, clear, exportCsv, saving, exporting } = useGradeActions(assignment.id);

  const selectedStudent = students.find((s) => s.id === selectedStudentId) ?? null;
  // Own useMemo so the fallback `[]` isn't a fresh reference on every render
  // — it's a dependency of loadStudent/selectionsList below.
  const isShare = isShareModel({ settings: assignment.rubric?.settings ?? null });
  const unconverted = !!assignment.rubric && !isShare;
  // An unconverted rubric exposes no criteria at all, so every downstream
  // consumer — the panel, the save path, the completeness check — treats it
  // the same as an assignment with no rubric rather than scoring it wrongly.
  const criteria = useMemo(
    () => (unconverted ? [] : assignment.rubric?.criteria ?? []),
    [assignment.rubric, unconverted],
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

  const allGraded = criteria.length > 0 && (scoreResult?.complete ?? false);

  async function handleSave(markComplete = false) {
    if (!selectedStudentId) return;
    // Saving an unconverted rubric would write an empty entry set over
    // whatever the archived editor recorded, so it never happens.
    if (unconverted) return;

    if (markComplete && !allGraded) {
      toast.warning("Select a level for every criterion before marking complete");
      return;
    }

    const entries = criteria
      .map((c) => {
        const sel = selections[c.id];
        if (!sel) return null;
        const levelRow = c.levels.find((l) => l.level === sel.level);
        if (!levelRow) return null;
        return { criteriaId: c.id, levelId: levelRow.id, nudge: sel.nudge };
      })
      .filter((e): e is { criteriaId: number; levelId: number; nudge: Nudge } => e !== null);

    const result = await saveShare({ assignmentId: assignment.id, studentId: selectedStudentId, entries, feedback });
    const contextEntries = entries.map((e) => {
      const outcome = normalRubric && scoreResult
        ? scoreResult.perCriterion.find((o) => criteria[o.criterionIndex]?.id === e.criteriaId)
        : undefined;
      const score = normalRubric && outcome ? criterionPoints(normalRubric, outcome, assignment.pointsPossible) : null;
      return { criteriaId: e.criteriaId, levelId: e.levelId, score, comment: null, nudge: e.nudge };
    });

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

  /** Level + optional nudge for one criterion. */
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

  return {
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
    selections,
    scoreResult,
    setSelection,
    unconverted,
  };
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
