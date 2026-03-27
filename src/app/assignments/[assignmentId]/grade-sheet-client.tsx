"use client";

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { saveGrade, exportGradesCSV, clearGrade } from "@/actions/grades";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  RotateCcw,
  CheckCircle2,
  Clock,
  Circle,
  Users,
  Video,
} from "lucide-react";
import type { StudentWithGrade } from "@/actions/grades";
import type { getAssignment } from "@/actions/assignments";

type Assignment = NonNullable<Awaited<ReturnType<typeof getAssignment>>>;

interface GradeSheetClientProps {
  assignment: Assignment;
  students: StudentWithGrade[];
  gradedCount: number;
  inProgressCount: number;
  initialStudentId?: number;
}

// Local state for one student's entries: criteriaId → { levelId, score }
type EntryMap = Record<number, { levelId: number; score: number }>;

export function GradeSheetClient({
  assignment,
  students: initialStudents,
  gradedCount: initialGraded,
  inProgressCount: initialInProgress,
  initialStudentId,
}: GradeSheetClientProps) {
  const [students, setStudents] = useState(initialStudents);

  // If the caller passed a studentId (from ?studentId= param), start there;
  // otherwise fall back to the first student in the list.
  const startStudent =
    (initialStudentId
      ? initialStudents.find((s) => s.id === initialStudentId)
      : undefined) ?? initialStudents[0];

  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(
    startStudent?.id ?? null
  );
  const [entryMap, setEntryMap] = useState<EntryMap>(() => {
    const map: EntryMap = {};
    for (const entry of startStudent?.grade?.entries ?? []) {
      if (entry.levelId !== null && entry.score !== null) {
        map[entry.criteriaId] = { levelId: entry.levelId, score: entry.score };
      }
    }
    return map;
  });
  const [feedback, setFeedback] = useState(startStudent?.grade?.feedback ?? "");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dirty, setDirty] = useState(false);

  const selectedStudent = students.find((s) => s.id === selectedStudentId) ?? null;
  const criteria = assignment.rubric?.criteria ?? [];

  // Load a student's saved grade into local state
  const loadStudent = useCallback(
    (studentId: number) => {
      const student = students.find((s) => s.id === studentId);
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
    [students]
  );

  function selectStudent(studentId: number) {
    if (dirty) {
      if (!confirm("You have unsaved changes. Discard them?")) return;
    }
    setSelectedStudentId(studentId);
    loadStudent(studentId);
  }

  function selectLevel(criteriaId: number, levelId: number, score: number) {
    setEntryMap((prev) => {
      // Toggle off if already selected
      if (prev[criteriaId]?.levelId === levelId) {
        const next = { ...prev };
        delete next[criteriaId];
        return next;
      }
      return { ...prev, [criteriaId]: { levelId, score } };
    });
    setDirty(true);
  }

  const totalScore = Object.values(entryMap).reduce((sum, e) => sum + e.score, 0);
  const gradedCriteria = Object.keys(entryMap).length;
  const allGraded = criteria.length > 0 && gradedCriteria === criteria.length;

  async function handleSave(markComplete = false) {
    if (!selectedStudentId) return;
    setSaving(true);
    try {
      const entries = Object.entries(entryMap).map(([criteriaId, e]) => ({
        criteriaId: Number(criteriaId),
        levelId: e.levelId,
        score: e.score,
      }));

      // If markComplete, ensure all criteria are selected
      if (markComplete && !allGraded) {
        toast.warning("Select a level for every criterion before marking complete");
        return;
      }

      const result = await saveGrade({
        assignmentId: assignment.id,
        studentId: selectedStudentId,
        entries: markComplete ? entries : entries,
        feedback,
      });

      // Update local student list to reflect new status
      setStudents((prev) =>
        prev.map((s) =>
          s.id === selectedStudentId
            ? {
                ...s,
                grade: {
                  id: s.grade?.id ?? 0,
                  totalScore: result.totalScore,
                  feedback,
                  status: result.status,
                  gradedAt: result.status === "graded" ? new Date().toISOString() : null,
                  exportedAt: s.grade?.exportedAt ?? null,
                  entries: Object.entries(entryMap).map(([cid, e]) => ({
                    criteriaId: Number(cid),
                    levelId: e.levelId,
                    score: e.score,
                    comment: null,
                  })),
                },
              }
            : s
        )
      );

      toast.success(markComplete ? "Graded ✓" : "Saved");
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
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!selectedStudentId) return;
    if (!confirm("Clear this student's grade and start over?")) return;
    setSaving(true);
    try {
      await clearGrade(assignment.id, selectedStudentId);
      setEntryMap({});
      setFeedback("");
      setDirty(false);
      setStudents((prev) =>
        prev.map((s) => (s.id === selectedStudentId ? { ...s, grade: null } : s))
      );
      toast.success("Grade cleared");
    } catch {
      toast.error("Failed to clear grade");
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const csv = await exportGradesCSV(assignment.id);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${assignment.name.replace(/\s+/g, "_")}_grades.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Grades exported for Learning Suite");
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  }

  const gradedCount = students.filter((s) => s.grade?.status === "graded").length;
  const pct = students.length > 0 ? Math.round((gradedCount / students.length) * 100) : 0;

  // Nav between students
  const currentIdx = students.findIndex((s) => s.id === selectedStudentId);
  const prevStudent = currentIdx > 0 ? students[currentIdx - 1] : null;
  const nextStudent = currentIdx < students.length - 1 ? students[currentIdx + 1] : null;

  type Level = { id: number; level: number; label: string; description: string; points: number };

  // Levels ordered high→low for display
  const levelsHighToLow = (levels: Level[]) =>
    [...levels].sort((a, b) => b.level - a.level);

  return (
    <TooltipProvider>
      <div className="flex gap-0 -mx-6 border-t" style={{ minHeight: "calc(100vh - 180px)" }}>
        {/* ── Left: student list ─────────────────────────────────── */}
        <div className="w-64 shrink-0 border-r flex flex-col">
          {/* Progress */}
          <div className="px-4 py-3 border-b">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {students.length} students
              </span>
              <span>{gradedCount} graded</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* Export button */}
          <div className="px-3 py-2 border-b">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={handleExport}
              disabled={exporting || gradedCount === 0}
            >
              <Download className="h-3 w-3 mr-1.5" />
              {exporting ? "Exporting…" : "Export to LMS"}
            </Button>
          </div>

          {/* Student list */}
          <div className="flex-1 overflow-y-auto">
            {students.map((student) => {
              const status = student.grade?.status ?? "ungraded";
              const score = student.grade?.totalScore;
              const isSelected = student.id === selectedStudentId;

              return (
                <button
                  key={student.id}
                  onClick={() => selectStudent(student.id)}
                  className={cn(
                    "w-full text-left px-4 py-2.5 flex items-center gap-2 text-sm border-b last:border-b-0 transition-colors hover:bg-muted/50",
                    isSelected && "bg-primary/8 border-l-2 border-l-primary"
                  )}
                >
                  <StatusIcon status={status} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{student.sortName}</div>
                    {student.netId && (
                      <div className="text-xs text-muted-foreground">{student.netId}</div>
                    )}
                  </div>
                  {score !== null && score !== undefined && (
                    <span className="text-xs tabular-nums shrink-0 text-muted-foreground">
                      {score}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Right: grading panel ───────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedStudent ? (
            <>
              {/* Student header */}
              <div className="px-6 py-3 border-b flex items-center justify-between gap-4 bg-muted/30">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="font-semibold">{selectedStudent.name}</div>
                    {selectedStudent.netId && (
                      <div className="text-xs text-muted-foreground">{selectedStudent.netId}</div>
                    )}
                  </div>
                  <StatusBadge status={selectedStudent.grade?.status ?? "ungraded"} />
                </div>

                <div className="flex items-center gap-2">
                  {/* Prev / Next */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => prevStudent && selectStudent(prevStudent.id)}
                    disabled={!prevStudent}
                    title="Previous student"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {currentIdx + 1} / {students.length}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => nextStudent && selectStudent(nextStudent.id)}
                    disabled={!nextStudent}
                    title="Next student"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>

                  {/* Reset */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleClear}
                    disabled={saving || !selectedStudent.grade}
                    title="Clear grade"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>

                  {/* Review — links to the review page with this student pre-selected */}
                  <LinkButton
                    href={`/assignments/${assignment.id}/review?studentId=${selectedStudentId}`}
                    variant="outline"
                    size="sm"
                    className="ml-1"
                  >
                    <Video className="h-3.5 w-3.5" />
                    Review
                  </LinkButton>
                </div>
              </div>

              {/* Rubric table */}
              {criteria.length > 0 ? (
                <div className="flex-1 overflow-auto px-6 py-4">
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
                                                : "border-border bg-background"
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

                  {/* Feedback + total */}
                  <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Feedback (optional)</label>
                      <Textarea
                        value={feedback}
                        onChange={(e) => {
                          setFeedback(e.target.value);
                          setDirty(true);
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

                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => handleSave(false)}
                          disabled={saving || !dirty}
                        >
                          {saving ? "Saving…" : "Save Draft"}
                        </Button>
                        <Button
                          onClick={() => handleSave(true)}
                          disabled={saving || !allGraded}
                          className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1.5" />
                          {saving ? "Saving…" : "Mark Graded →"}
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
      </div>
    </TooltipProvider>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "graded")
    return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "in_progress")
    return <Clock className="h-4 w-4 text-yellow-500 shrink-0" />;
  return <Circle className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "graded")
    return <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">Graded</Badge>;
  if (status === "in_progress")
    return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 text-xs">In Progress</Badge>;
  return (
    <Badge variant="outline" className="text-xs text-muted-foreground">
      Ungraded
    </Badge>
  );
}
