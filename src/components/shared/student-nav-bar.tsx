"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GradeStatus } from "@/types/grading";
import { useGrading } from "./grading-context";

interface StudentNavBarProps {
  /**
   * Page-specific utility controls (e.g. Reset icon, Zoom controls).
   * Rendered between the navigation arrows and the page-link button.
   */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Unified student navigation bar used on both the grade-sheet and review pages.
 * Reads students and the current selection directly from GradingContext.
 *
 * Layout:  [◀]  name · netId  ● status  [x of n]  [▶]  │  [actions]
 *
 * This used to carry a `pageLink` slot for the Review ↔ Grade Sheet trip, which
 * each page had to fill in itself. The art reviewer never did, so once it became
 * the default viewer there was no way back to the rubric. The switch now lives
 * in the grading shell, where every grading route gets it without opting in.
 */
export function StudentNavBar({ actions, className }: StudentNavBarProps) {
  const { students, selectedStudentId, selectStudent } = useGrading();

  const idx = students.findIndex((s) => s.id === selectedStudentId);
  const student = idx >= 0 ? students[idx] : null;
  const prev = idx > 0 ? students[idx - 1] : null;
  const next = idx < students.length - 1 ? students[idx + 1] : null;

  return (
    <div
      className={cn(
        "shrink-0 h-11 px-3 border-b flex items-center gap-1.5 bg-background",
        className,
      )}
    >
      {/* ◀ Prev */}
      <button
        onClick={() => prev && selectStudent(prev.id)}
        disabled={!prev}
        title="Previous student (↑)"
        className="p-1.5 rounded hover:bg-muted disabled:opacity-25 transition-colors shrink-0"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {/* Name + meta — flex-1 keeps the arrows pinned to their edges */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5 px-1">
        <span className="text-sm font-medium truncate">{student?.name ?? "—"}</span>
        {student?.netId && (
          <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
            {student.netId}
          </span>
        )}
        <StatusDot status={(student?.grade?.status ?? "ungraded") as GradeStatus} />
      </div>

      {/* x of n */}
      <span className="text-xs text-muted-foreground tabular-nums shrink-0 px-1">
        {idx + 1} of {students.length}
      </span>

      {/* ▶ Next */}
      <button
        onClick={() => next && selectStudent(next.id)}
        disabled={!next}
        title="Next student (↓)"
        className="p-1.5 rounded hover:bg-muted disabled:opacity-25 transition-colors shrink-0"
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {/* Page-specific utility actions (Reset, Zoom, …) — right side */}
      {actions && (
        <>
          <div className="w-px h-5 bg-border mx-1 shrink-0" />
          {actions}
        </>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: GradeStatus }) {
  return (
    <span
      title={status === "graded" ? "Graded" : status === "in_progress" ? "In progress" : "Ungraded"}
      className={cn(
        "inline-block h-1.5 w-1.5 rounded-full shrink-0",
        status === "graded"      && "bg-green-500",
        status === "in_progress" && "bg-yellow-500",
        status === "ungraded"    && "bg-muted-foreground/30",
      )}
    />
  );
}
