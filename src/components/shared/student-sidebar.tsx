"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { CheckCircle2, Clock, Circle, Mail, MailWarning, Users } from "lucide-react";
import { cn, formatScore } from "@/lib/utils";
import { isReviewRoute } from "@/lib/grading-routes";
import { useGrading } from "./grading-context";
import { useIsReviewing } from "./session-mode";
import type { GradeStatus, GradingStudent } from "@/types/grading";
import { fullDateTime } from "@/lib/feedback/format";
import { letterFor } from "@/lib/rubric";

/**
 * Shared student sidebar that lives in the grading layout.
 * Persists (including scroll position) across grade ↔ review navigation.
 *
 * On the grade sheet each row carries the net ID and the score with its letter
 * grade, because that is the view where you are looking things up. On the
 * review route it is names only, which buys back both the second line of every
 * row and 48px of width for
 * the artwork — and keeps a column of everyone's marks off a screen that may be
 * mirrored to a projector. See docs/security.md.
 *
 * A review *session* goes further than the review *route*: the per-student
 * status dots and the "n graded" bar come off too. Those say who has been
 * marked and who has not, which is nobody else's business in a room full of
 * students — and in a session that cannot grade, they are progress against work
 * you are not here to do.
 */
export function StudentSidebar({
  pointsPossible,
  variant = "docked",
}: {
  pointsPossible: number;
  /**
   * "docked" lives beside the page and steps down with the window: full at
   * xl, an initials strip from 900px, gone below that (the shell's Students
   * button opens the "sheet" variant instead). "sheet" is always full width.
   */
  variant?: "docked" | "sheet";
}) {
  const sheet = variant === "sheet";
  // What only the full-width sidebar shows.
  const full = sheet ? "" : "max-xl:hidden";
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
        "shrink-0 border-r flex flex-col bg-sidebar",
        sheet
          ? "w-full h-full"
          : cn("max-[899px]:hidden min-[900px]:w-12", detailed ? "xl:w-56" : "xl:w-44"),
      )}
    >
      {/* Progress summary — grading progress, so only in a grading session. */}
      {!reviewing && (
      <div className={cn("px-4 py-3 border-b", full)}>
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
          const override = student.grade?.overrideLetter;
          const isSelected = student.id === selectedStudentId;

          return (
            <button
              key={student.id}
              id={`student-${student.id}`}
              onClick={() => selectStudent(student.id)}
              className={cn(
                "w-full text-left py-2.5 flex items-center gap-2 text-sm border-b last:border-b-0 transition-colors hover:bg-muted/50",
                sheet ? "px-4" : "max-xl:justify-center max-xl:px-0 xl:px-4",
                isSelected && "bg-primary/8 border-l-2 border-l-primary",
              )}
            >
              {!reviewing && (
                <span className={cn("shrink-0 flex", !sheet && "max-xl:hidden")}>
                  <StatusIcon status={status} />
                </span>
              )}
              {!sheet && (
                <span
                  title={student.sortName}
                  className="xl:hidden text-xs font-medium tabular-nums"
                >
                  {initials(student.name)}
                </span>
              )}
              <div className={cn("flex-1 min-w-0", full)}>
                <div className="truncate font-medium">{student.sortName}</div>
              </div>
              {detailed && student.feedbackMail && (
                <span className={cn("shrink-0 flex", full)}>
                  <FeedbackMailIcon mail={student.feedbackMail} />
                </span>
              )}
              {detailed && score !== null && score !== undefined && (
                <span className={cn("text-xs tabular-nums shrink-0 text-muted-foreground", full)}>
                  {formatScore(score)}
                  {override ? (
                    <span
                      title={`Overridden${student.grade?.overrideReason ? `: ${student.grade.overrideReason}` : ""}`}
                      className="ml-1.5 inline-block w-5 font-medium text-amber-600 dark:text-amber-400"
                    >
                      {override}
                    </span>
                  ) : (
                    pointsPossible > 0 && (
                      <span className="ml-1.5 inline-block w-5 font-medium text-foreground">
                        {letterFor((score / pointsPossible) * 100)}
                      </span>
                    )
                  )}
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

/**
 * Feedback-email state, grade sheet only (`detailed`): like the score beside
 * it, who has been sent what is not for a projected review screen.
 */
function FeedbackMailIcon({ mail }: { mail: NonNullable<GradingStudent["feedbackMail"]> }) {
  const when = fullDateTime(mail.sentAt);
  if (mail.changed) {
    return (
      <span title={`Grade changed since feedback was emailed ${when}`} className="shrink-0">
        <MailWarning className="h-3.5 w-3.5 text-yellow-500" />
      </span>
    );
  }
  return (
    <span title={`Feedback emailed ${when}`} className="shrink-0">
      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}
