"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  /**
   * True once a save (autosave or explicit) has failed and hasn't been
   * retried successfully yet. `dirty` alone doesn't distinguish "not saved
   * yet" from "tried and failed" — this does, so the panel can show a
   * persistent retry affordance instead of a toast that's already gone by
   * the time anyone notices the edit never landed.
   */
  saveFailed: boolean;
  saving: boolean;
  exporting: boolean;
  /** Resolves false if the save failed — callers must not treat it as done. */
  handleSave: (markComplete?: boolean) => Promise<boolean>;
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
    flushHandlerRef,
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

  const [saveFailed, setSaveFailed] = useState(false);

  const savingRef = useRef(saving);
  savingRef.current = saving;

  const selectedStudentIdRef = useRef(selectedStudentId);
  selectedStudentIdRef.current = selectedStudentId;

  // Bumped on every local edit. A save started before an edit lands must not
  // clear `dirty` once it resolves — that edit would otherwise look saved
  // when it never left the browser (see handleSave below).
  const revisionRef = useRef(0);

  const loadStudent = useCallback(
    (studentId: number) => {
      const student = (students as StudentWithGrade[]).find((s) => s.id === studentId);
      if (!student) return;
      setSelections(selectionsOf(student, criteria));
      setFeedbackState(student.grade?.feedback ?? "");
      setDirty(false);
      setSaveFailed(false);
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
  const handleSaveRef = useRef<(markComplete?: boolean) => Promise<boolean>>(() =>
    Promise.resolve(true),
  );
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    // Captured now, not read from a ref when the timer fires: this timer
    // saves the student it was scheduled for, never whoever happens to be
    // selected 1.5s from now.
    const targetStudentId = selectedStudentIdRef.current;
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      // Mark complete / mark missing / clear all cancel this timer up front,
      // so firing here with nothing dirty, or after the student changed out
      // from under it, means some other path already handled the save (or
      // there's nothing to save) — belt and suspenders against the two ever
      // disagreeing.
      if (!dirtyRef.current || selectedStudentIdRef.current !== targetStudentId) return;
      void handleSaveRef.current(false);
    }, 1500);
  }, []);

  /**
   * Cancels any pending timer and saves right now if there's anything dirty.
   * Returns false if that save failed, so a caller that's about to navigate
   * away (a student switch, a route change) can keep the user right where
   * they are instead of carrying them off with unsaved work.
   *
   * Loops rather than checking dirty once: an edit that lands while the save
   * above is in flight leaves `dirty` true again (see handleSave), and that
   * edit needs its own flush before this is allowed to report "clean".
   */
  const flushAutoSave = useCallback(async (): Promise<boolean> => {
    // Re-loops on the revision counter, not dirtyRef: dirtyRef only catches up
    // on the next render, and a save that's a no-op (unconverted rubric) never
    // clears dirty at all — either would spin this loop. Bounded as a backstop.
    for (let attempt = 0; attempt < 5; attempt++) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      if (attempt === 0 && !dirtyRef.current) return true;
      const revision = revisionRef.current;
      const ok = await handleSaveRef.current(false);
      if (!ok) return false;
      if (revisionRef.current === revision) return true;
    }
    return true;
  }, []);

  const allGraded = criteria.length > 0 && (scoreResult?.complete ?? false);

  /** Resolves false if the save failed — see ShareGrading.handleSave. */
  async function handleSave(markComplete = false): Promise<boolean> {
    // A manual Save/Mark-complete cancels whatever autosave was pending —
    // otherwise that timer can go on to fire after this function has already
    // moved the panel to the next student, saving empty entries over them.
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    if (!selectedStudentId) return true;
    // Saving an unconverted rubric would write an empty entry set over
    // whatever the archived editor recorded, so it never happens.
    if (unconverted) return true;

    if (markComplete && !allGraded) {
      toast.warning("Select a level for every criterion before marking complete");
      return false;
    }

    const targetStudentId = selectedStudentId;
    const targetFeedback = feedback;
    // Snapshot which edit this save is for. If setSelection/setFeedback bump
    // this again before the save below resolves, that's a newer edit than
    // what we're about to send — dirty must survive the save that follows.
    const startRevision = revisionRef.current;

    const entries = criteria
      .map((c) => {
        const sel = selections[c.id];
        if (!sel) return null;
        const levelRow = c.levels.find((l) => l.level === sel.level);
        if (!levelRow) return null;
        return { criteriaId: c.id, levelId: levelRow.id, nudge: sel.nudge };
      })
      .filter((e): e is { criteriaId: number; levelId: number; nudge: Nudge } => e !== null);

    const result = await saveShare({ assignmentId: assignment.id, studentId: targetStudentId, entries, feedback: targetFeedback });

    if (!result) {
      setSaveFailed(true);
      return false;
    }
    setSaveFailed(false);

    const contextEntries = entries.map((e) => {
      const outcome = normalRubric && scoreResult
        ? scoreResult.perCriterion.find((o) => criteria[o.criterionIndex]?.id === e.criteriaId)
        : undefined;
      const score = normalRubric && outcome ? criterionPoints(normalRubric, outcome, assignment.pointsPossible) : null;
      return { criteriaId: e.criteriaId, levelId: e.levelId, score, comment: null, nudge: e.nudge };
    });

    const currentFull = (students as StudentWithGrade[]).find((s) => s.id === targetStudentId);
    // Keeps GradingContext's copy current — the docked rubric on the review
    // route reads this same list, and a stale copy there is what used to let
    // a remount show (and then re-save) feedback from before this save.
    updateStudentGrade(targetStudentId, {
      id: currentFull?.grade?.id ?? 0,
      totalScore: result.totalScore,
      feedback: targetFeedback,
      status: result.status,
      gradedAt: result.status === "graded" ? new Date().toISOString() : null,
      exportedAt: currentFull?.grade?.exportedAt ?? null,
      entries: contextEntries,
    });

    if (markComplete) toast.success("Graded ✓");
    // Only clear dirty if nothing changed locally while this save was in
    // flight — otherwise an edit made mid-save would look saved when it
    // never left the browser.
    if (revisionRef.current === startRevision) setDirty(false);

    if (markComplete) {
      const currentIdx = students.findIndex((s) => s.id === targetStudentId);
      const next = students.find((s, i) => i > currentIdx && s.grade?.status !== "graded");
      if (next) {
        setSelectedStudentId(next.id);
        loadStudent(next.id);
      }
    }

    return true;
  }
  handleSaveRef.current = handleSave;

  async function handleClear() {
    if (!selectedStudentId) return;
    if (!confirm("Clear this student's grade and start over?")) return;
    // Confirmed — this supersedes whatever autosave was pending for this
    // student, same reasoning as the top of handleSave.
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    const ok = await clear(selectedStudentId);
    if (!ok) return;
    setSelections({});
    setFeedbackState("");
    setDirty(false);
    setSaveFailed(false);
    updateStudentGrade(selectedStudentId, null);
    toast.success("Grade cleared");
  }

  async function handleMarkMissing() {
    if (!selectedStudentId) return;
    // Same reasoning as handleSave/handleClear: this supersedes any pending
    // autosave for this student.
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    const ok = await markStudentMissing(selectedStudentId);
    if (!ok) return;
    setSelections({});
    setFeedbackState("");
    setDirty(false);
    setSaveFailed(false);
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
      // A failed flush keeps the panel on the current student — walking away
      // from a save that didn't land is how "missing" or a cleared grade
      // silently reverts to whatever the next student happened to have.
      const ok = await flushAutoSave();
      if (!ok) return;
      setSelectedStudentId(studentId);
      loadStudent(studentId);
    })();
  };

  useLayoutEffect(() => {
    selectHandlerRef.current = (id) => guardRef.current(id);
    // Lets ViewSwitch (a sibling, not a child of this hook) flush before it
    // pushes a route — the same trip a student switch takes through
    // guardRef, just triggered by the Rubric/Artwork toggle instead.
    flushHandlerRef.current = flushAutoSave;
    return () => {
      selectHandlerRef.current = (id) => setSelectedStudentId(id);
      flushHandlerRef.current = async () => true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Saves on the way out — unmount (route change, dock toggled off), and a
  // real tab close/reload. Neither used to save anything: the autosave timer
  // just kept ticking in the background (harmless if the SPA shell survives,
  // silently lost if the tab actually closes first).
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      // Fire-and-forget: the component is already gone, so nothing here can
      // await the result or react to a failure. It's a best-effort flush for
      // the common case (GradingProvider outlives this hook across a route
      // change) — the resync effect below picks it up if it lands late.
      if (dirtyRef.current) void handleSaveRef.current(false);
    };
    // Mount/unmount only — reads live refs, not this render's closure.
  }, []);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current && !savingRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Re-syncs local selections/feedback when the *same* student's entry in
  // GradingContext changes out from under this instance — e.g. the
  // fire-and-forget unmount save above lands after this instance already
  // remounted and read the pre-save copy. A real student switch is handled
  // by loadStudent via the guard, not here; and a live edit is never
  // clobbered, dirty always wins.
  const lastSeenStudentRef = useRef(selectedStudent);
  useEffect(() => {
    const prev = lastSeenStudentRef.current;
    lastSeenStudentRef.current = selectedStudent;
    if (!selectedStudent || !prev) return;
    if (prev.id !== selectedStudent.id) return;
    if (prev === selectedStudent) return;
    if (dirtyRef.current) return;
    setSelections(selectionsOf(selectedStudent as StudentWithGrade, criteria));
    setFeedbackState((selectedStudent as StudentWithGrade).grade?.feedback ?? "");
  }, [selectedStudent, criteria]);

  /** Level + optional nudge for one criterion. */
  function setSelection(criteriaId: number, level: Level, nudge: Nudge = 0) {
    setSelections((prev) => ({ ...prev, [criteriaId]: { level, nudge } }));
    setDirty(true);
    revisionRef.current += 1;
    scheduleAutoSave();
  }

  function setFeedback(text: string) {
    setFeedbackState(text);
    setDirty(true);
    revisionRef.current += 1;
    scheduleAutoSave();
  }

  return {
    assignment,
    criteria,
    selectedStudent,
    feedback,
    setFeedback,
    dirty,
    saveFailed,
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
