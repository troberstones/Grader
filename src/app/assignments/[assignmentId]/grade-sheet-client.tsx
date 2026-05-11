"use client";

import { useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StudentNavBar } from "@/components/shared/student-nav-bar";
import { useGrading } from "@/components/shared/grading-context";
import { useGradeActions } from "@/hooks/use-grade-actions";
import type { StudentWithGrade } from "@/actions/grades";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Download,
  RotateCcw,
  CheckCircle2,
  Video,
  CloudDownload,
  Upload,
  Link,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { getAssignment } from "@/actions/assignments";
import { useLsBridge } from "@/hooks/use-ls-bridge";
import { V3GradingView } from "@/components/rubric/v3-grading-view";

type Assignment = NonNullable<Awaited<ReturnType<typeof getAssignment>>>;

interface GradeSheetClientProps {
  assignment: Assignment;
}

// Local state for one student's entries: criteriaId → { levelId, score }
type EntryMap = Record<number, { levelId: number; score: number }>;

export function GradeSheetClient({ assignment }: GradeSheetClientProps) {
  const router = useRouter();
  const {
    students,
    updateStudentGrade,
    selectedStudentId,
    setSelectedStudentId,
    selectHandlerRef,
  } = useGrading();
  const { save, clear, exportCsv, saving, exporting } = useGradeActions(assignment.id);
  const { status: lsStatus, busy: lsBusy, syncSubmissions, pushGrades } = useLsBridge();
  const lsReady = lsStatus === "ready";
  const [discussionDialogOpen, setDiscussionDialogOpen] = useState(false);
  const [discussionUrlInput, setDiscussionUrlInput] = useState(assignment.lmsDiscussionUrl ?? "");
  const [savingDiscussionUrl, setSavingDiscussionUrl] = useState(false);

  async function handleSaveDiscussionUrl() {
    const raw = discussionUrlInput.trim();
    // Accept full URL or just the short ID (e.g. "5LB6")
    const shortUrl = raw.match(/\/id-([\w-]+)/)?.[1] ?? raw;
    if (!shortUrl) return;
    setSavingDiscussionUrl(true);
    await fetch(`/api/assignments/${assignment.id}/discussion-url`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lmsDiscussionUrl: shortUrl }),
    });
    setSavingDiscussionUrl(false);
    setDiscussionDialogOpen(false);
    toast.success("Discussion URL saved");
    router.refresh();
  }

  async function handleFetchSubmissions() {
    if (!assignment.lmsDiscussionUrl) {
      setDiscussionDialogOpen(true);
      return;
    }
    const result = await syncSubmissions(assignment.id);
    if (!result) return;
    const { synced, errors } = result;
    if (synced > 0) {
      toast.success(`${synced} submission${synced !== 1 ? "s" : ""} downloaded from LS`);
      router.refresh();
    } else {
      toast.info("No new submissions found in Learning Suite");
    }
    if (errors.length > 0) {
      toast.error(`${errors.length} failed — check console for details`);
      console.error("[LS Bridge] submission errors:", errors);
    }
  }

  async function handlePushGrades() {
    const result = await pushGrades(assignment.id);
    if (!result) return;
    const { pushed, errors } = result;
    if (pushed > 0) {
      toast.success(`${pushed} grade${pushed !== 1 ? "s" : ""} pushed to Learning Suite`);
    } else {
      toast.info("No graded submissions to push");
    }
    if (errors.length > 0) {
      toast.error(`${errors.length} failed — check console for details`);
      console.error("[LS Bridge] push errors:", errors);
    }
  }

  const selectedStudent = students.find((s) => s.id === selectedStudentId) ?? null;
  const criteria = assignment.rubric?.criteria ?? [];

  // ── Local form state for the selected student ──────────────────────────
  const [entryMap, setEntryMap] = useState<EntryMap>(() => {
    // selectedStudent comes from context which stores StudentWithGrade[] internally.
    // Cast is safe: the provider always initialises from getGradeSheet() data.
    const full = selectedStudent as StudentWithGrade | null;
    const map: EntryMap = {};
    for (const entry of full?.grade?.entries ?? []) {
      if (entry.levelId !== null && entry.score !== null) {
        map[entry.criteriaId] = { levelId: entry.levelId, score: entry.score };
      }
    }
    return map;
  });
  const [feedback, setFeedback] = useState(
    (selectedStudent as StudentWithGrade | null)?.grade?.feedback ?? "",
  );
  const [dirty, setDirty] = useState(false);
  // Ref so async callbacks always read current dirty state without stale closures.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Load a student's saved grade into local state.
  // Casts students to StudentWithGrade[] to access entries/feedback —
  // the context stores the full type internally; GradingStudent is the
  // narrow public view used by sidebar/nav components.
  const loadStudent = useCallback(
    (studentId: number) => {
      const student = (students as StudentWithGrade[]).find((s) => s.id === studentId);
      if (!student) return;
      const map: EntryMap = {};
      for (const entry of student.grade?.entries ?? []) {
        if (entry.levelId !== null && entry.score !== null) {
          map[entry.criteriaId] = { levelId: entry.levelId, score: entry.score };
        }
      }
      setEntryMap(map);
      setFeedback(student.grade?.feedback ?? "");
      setDirty(false);
    },
    [students],
  );

  // ── Auto-save ─────────────────────────────────────────────────────────────
  // handleSaveRef is reassigned every render so timer callbacks always call
  // the version that closes over the current entryMap/feedback/etc.
  const handleSaveRef = useRef<(markComplete?: boolean) => Promise<void>>(() => Promise.resolve());
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleAutoSave() {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      void handleSaveRef.current(false);
    }, 1500);
  }

  async function flushAutoSave() {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (dirtyRef.current) {
      await handleSaveRef.current(false);
    }
  }

  // Keep the latest version of the selection guard in a local ref so the
  // context-level handler wrapper never goes stale without needing re-registration.
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
    return () => { selectHandlerRef.current = (id) => setSelectedStudentId(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keyboard shortcut: "t" toggles to review page ───────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "t") return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
      e.preventDefault();
      router.push(
        `/assignments/${assignment.id}/review?studentId=${selectedStudentId ?? ""}`,
      );
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [assignment.id, selectedStudentId, router]);

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

    // Push updated grade into context so sidebar reflects new status/score.
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

    // Auto-advance to next ungraded student
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
    setFeedback("");
    setDirty(false);
    updateStudentGrade(selectedStudentId, null);
    toast.success("Grade cleared");
  }

  async function handleExport() {
    await exportCsv(assignment.name);
  }

  const gradedCount = students.filter((s) => s.grade?.status === "graded").length;

  type Level = { id: number; level: number; label: string; description: string; points: number };

  const levelsHighToLow = (levels: Level[]) =>
    [...levels].sort((a, b) => b.level - a.level);

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full">
        {selectedStudent ? (
          <>
            {/* Student nav bar */}
            <StudentNavBar
              actions={
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleClear}
                    disabled={saving || !selectedStudent.grade}
                    title="Clear grade"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                  {lsReady && (
                    <>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => { setDiscussionUrlInput(assignment.lmsDiscussionUrl ?? ""); setDiscussionDialogOpen(true); }}
                              title="Set LS discussion URL"
                            >
                              <Link className={`h-3.5 w-3.5 ${assignment.lmsDiscussionUrl ? "text-primary" : "text-muted-foreground"}`} />
                            </Button>
                          }
                        />
                        <TooltipContent>{assignment.lmsDiscussionUrl ? `Discussion: ${assignment.lmsDiscussionUrl}` : "Link LS discussion URL"}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={handleFetchSubmissions}
                              disabled={lsBusy || saving}
                              title="Fetch submissions from LS"
                            >
                              {lsBusy ? (
                                <CloudDownload className="h-3.5 w-3.5 animate-pulse" />
                              ) : (
                                <CloudDownload className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          }
                        />
                        <TooltipContent>Fetch submissions from Learning Suite</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={handlePushGrades}
                              disabled={lsBusy || saving || gradedCount === 0}
                              title="Push grades to LS"
                            >
                              <Upload className="h-3.5 w-3.5" />
                            </Button>
                          }
                        />
                        <TooltipContent>Push grades to Learning Suite</TooltipContent>
                      </Tooltip>
                    </>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={handleExport}
                    disabled={exporting || gradedCount === 0}
                  >
                    <Download className="h-3 w-3 mr-1.5" />
                    {exporting ? "Exporting…" : "Export"}
                  </Button>
                </div>
              }
              pageLink={
                <LinkButton
                  href={`/assignments/${assignment.id}/review?studentId=${selectedStudentId}`}
                  variant="outline"
                  size="sm"
                >
                  <Video className="h-3.5 w-3.5" />
                  Review
                </LinkButton>
              }
            />

            {/* Rubric grading area */}
            {criteria.length > 0 ? (
              <div className="flex-1 overflow-auto px-6 py-4">
                {assignment.rubric?.settings?.gradingMode === "v3" ? (
                  <V3GradingView
                    criteria={criteria}
                    pointsPossible={assignment.pointsPossible}
                    bandEdges={assignment.rubric.settings?.bandEdges ?? [20, 45, 70]}
                    initialEntries={Object.entries(entryMap).map(([cid, e]) => ({
                      criteriaId: Number(cid),
                      levelId: e.levelId,
                      score: e.score,
                    }))}
                    onEntriesChange={(entries, totalScore) => {
                      const newMap: EntryMap = {};
                      for (const e of entries) newMap[e.criteriaId] = { levelId: e.levelId, score: e.score };
                      setEntryMap(newMap);
                      setDirty(true);
                      scheduleAutoSave();
                      void totalScore; // used by parent save logic via entryMap
                    }}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <th className="text-left py-2 pr-4 font-semibold w-40 shrink-0 align-bottom">
                            Criterion
                          </th>
                          {levelsHighToLow(criteria[0]?.levels ?? []).map((lvl) => (
                            <th key={lvl.level} className="text-center px-2 py-2 font-semibold min-w-[160px] align-bottom">
                              <div>{lvl.label}</div>
                              <div className="text-xs font-normal text-muted-foreground">
                                {lvl.points} pts
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {criteria.map((criterion) => {
                          const selected = entryMap[criterion.id];
                          return (
                            <tr key={criterion.id} className="border-t">
                              <td className="py-2 pr-4 align-top">
                                <div className="font-medium">{criterion.name}</div>
                                {criterion.description && (
                                  <div className="text-xs text-muted-foreground mt-0.5">
                                    {criterion.description}
                                  </div>
                                )}
                              </td>
                              {levelsHighToLow(criterion.levels).map((lvl) => {
                                const isSelected = selected?.levelId === lvl.id;
                                return (
                                  <td key={lvl.id} className="px-2 py-2 align-top">
                                    <Tooltip>
                                      <TooltipTrigger
                                        render={
                                          <button
                                            type="button"
                                            onClick={() => selectLevel(criterion.id, lvl.id, lvl.points)}
                                            className={cn(
                                              "w-full text-left p-2.5 rounded border text-xs transition-all min-h-[80px]",
                                              "hover:border-primary/60 hover:bg-primary/5",
                                              isSelected
                                                ? "border-primary bg-primary/10 font-medium ring-1 ring-primary/30"
                                                : "border-border bg-background",
                                            )}
                                          />
                                        }
                                      >
                                        <div className="line-clamp-4">
                                          {lvl.description || (
                                            <span className="text-muted-foreground italic">
                                              No description
                                            </span>
                                          )}
                                        </div>
                                        {isSelected && (
                                          <div className="mt-1.5 text-primary font-semibold">
                                            ✓ {lvl.points} pts
                                          </div>
                                        )}
                                      </TooltipTrigger>
                                      {lvl.description && (
                                        <TooltipContent
                                          side="bottom"
                                          className="max-w-xs text-xs"
                                        >
                                          {lvl.description}
                                        </TooltipContent>
                                      )}
                                    </Tooltip>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Feedback + total */}
                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Feedback (optional)</label>
                    <Textarea
                      value={feedback}
                      onChange={(e) => {
                        setFeedback(e.target.value);
                        setDirty(true);
                        scheduleAutoSave();
                      }}
                      placeholder="Overall feedback for this student…"
                      rows={3}
                    />
                  </div>

                  <div className="flex flex-col items-end justify-end gap-3">
                    <div className="text-right">
                      <div className="text-3xl font-bold tabular-nums">
                        {totalScore}
                        <span className="text-base font-normal text-muted-foreground ml-1">
                          / {assignment.pointsPossible}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {gradedCriteria} of {criteria.length} criteria
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {saving && (
                        <span className="text-xs text-muted-foreground animate-pulse">
                          Saving…
                        </span>
                      )}
                      <Button
                        onClick={() => handleSave(true)}
                        disabled={saving || !allGraded}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1.5" />
                        Mark Graded →
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 p-8">
                <p className="text-sm">This assignment has no rubric attached.</p>
                <p className="text-xs">
                  You can still enter a total score manually by{" "}
                  <a href={`/assignments/new`} className="underline">
                    editing the assignment
                  </a>{" "}
                  to add a rubric.
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <p className="text-sm">Select a student from the list to begin grading.</p>
          </div>
        )}
      </div>

      <Dialog open={discussionDialogOpen} onOpenChange={setDiscussionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link LS Discussion</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              In Learning Suite, open the discussion for this assignment and copy the page URL.
              Paste it below — or just the short ID at the end (e.g.{" "}
              <code className="text-xs bg-muted px-1 rounded">5LB6</code>).
            </p>
            <Input
              placeholder="https://learningsuite.byu.edu/.../discuss/discussion/id-5LB6"
              value={discussionUrlInput}
              onChange={(e) => setDiscussionUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && discussionUrlInput.trim() && handleSaveDiscussionUrl()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscussionDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!discussionUrlInput.trim() || savingDiscussionUrl}
              onClick={handleSaveDiscussionUrl}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
