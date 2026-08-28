"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { CheckCircle2, Clock, Circle, Users } from "lucide-react";
import { cn, formatScore } from "@/lib/utils";
import { isReviewRoute } from "@/lib/grading-routes";
import { useGrading } from "./grading-context";
import { useIsReviewing } from "./session-mode";
import type { GradeStatus } from "@/types/grading";

/**
 * Shared student sidebar that lives in the grading layout.
 * Persists (including scroll position) across grade ↔ review navigation.
 *
 * On the grade sheet each row carries the net ID and the score, because that is
 * the view where you are looking things up. On the review route it is names
 * only, which buys back both the second line of every row and 48px of width for
 * the artwork — and keeps a column of everyone's marks off a screen that may be
 * mirrored to a projector. See docs/security.md.
 *
 * A review *session* goes further than the review *route*: the per-student
 * status dots and the "n graded" bar come off too. Those say who has been
 * marked and who has not, which is nobody else's business in a room full of
 * students — and in a session that cannot grade, they are progress against work
 * you are not here to do.
 */
export function StudentSidebar() {
  const { students, selectedStudentId, selectStudent, scrollRef } = useGrading();
  const reviewing = useIsReviewing();
  const onReviewRoute = isReviewRoute(usePathname());
  const detailed = !reviewing && !onReviewRoute;

  const gradedCount = students.filter((s) => s.grade?.status === "graded").length;
  const pct = students.length > 0 ? Math.round((gradedCount / students.length) * 100) : 0;

  // Scroll the selected student into view on first mount
  const didScrollRef = useRef(false);
  useEffect(() => {
    if (didScrollRef.current || !selectedStudentId) return;
    didScrollRef.current = true;
    // Small delay so the DOM has rendered
    requestAnimationFrame(() => {
      const el = document.getElementById(`student-${selectedStudentId}`);
      el?.scrollIntoView({ block: "nearest" });
    });
  }, [selectedStudentId]);

  return (
    <div
      className={cn(
        "shrink-0 border-r flex flex-col bg-sidebar transition-[width]",
        detailed ? "w-56" : "w-44",
      )}
    >
      {/* Progress summary — grading progress, so only in a grading session. */}
      {!reviewing && (
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
      )}

      {/* Student list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {students.map((student) => {
          const status = student.grade?.status ?? "ungraded";
          const score = student.grade?.totalScore;
          const isSelected = student.id === selectedStudentId;

          return (
            <button
              key={student.id}
              id={`student-${student.id}`}
              onClick={() => selectStudent(student.id)}
              className={cn(
                "w-full text-left px-4 py-2.5 flex items-center gap-2 text-sm border-b last:border-b-0 transition-colors hover:bg-muted/50",
                isSelected && "bg-primary/8 border-l-2 border-l-primary",
              )}
            >
              {!reviewing && <StatusIcon status={status} />}
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{student.sortName}</div>
                {detailed && student.netId && (
                  <div className="text-xs text-muted-foreground">{student.netId}</div>
                )}
              </div>
              {detailed && score !== null && score !== undefined && (
                <span className="text-xs tabular-nums shrink-0 text-muted-foreground">
                  {formatScore(score)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: GradeStatus }) {
  if (status === "graded")
    return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "in_progress")
    return <Clock className="h-4 w-4 text-yellow-500 shrink-0" />;
  return <Circle className="h-4 w-4 text-muted-foreground shrink-0" />;
}
