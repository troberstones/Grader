"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RUBRIC_GRADING_VIEWS, GRADING_VIEW_LABELS, type RubricGradingViewKey } from "@/components/rubric/grading-registry";
import { UnconvertedRubricNotice } from "@/components/rubric/unconverted-rubric-notice";
import type { RubricGrading } from "@/hooks/use-rubric-grading";
import { cn, formatScore } from "@/lib/utils";

const VIEW_PREF_KEY = "rubric-grading-view-pref";

interface Props {
  grading: RubricGrading;
  /**
   * Docked beside the art reviewer rather than filling the page: tighter
   * padding, and the score/feedback block stacks instead of sitting in a
   * two-column grid. The grading view itself is unchanged — it scrolls
   * sideways inside its own container, which is what it already did on a
   * narrow window.
   */
  dense?: boolean;
}

/** {displayScore, gradedCount, totalCount, complete} for the score readout. */
function summarize(grading: RubricGrading) {
  const r = grading.scoreResult;
  return {
    displayScore: r?.points ?? 0,
    gradedCount: r?.scored ?? 0,
    totalCount: r?.total ?? grading.criteria.length,
    complete: r?.complete ?? false,
  };
}

/**
 * The stored preference predates the rename from "share-matrix"/"share-slider"
 * — the prefix stopped meaning anything once the points views were archived.
 * Old values are read and rewritten rather than discarded, so nobody's chosen
 * view silently resets.
 */
function readViewPref(raw: string | null): RubricGradingViewKey | null {
  if (raw === "matrix" || raw === "share-matrix") return "matrix";
  if (raw === "slider" || raw === "share-slider") return "slider";
  return null;
}

/**
 * The rubric scoring surface. Rendered full-width on the grade sheet and inside
 * the dock on the review route; both drive the same `useRubricGrading` state, so
 * a score entered in one place is the same save as in the other.
 *
 * Renders one of the two grading views (grading-registry.ts) — grid or slider
 * — with the choice remembered per browser. They write the same thing, so the
 * toggle is ergonomic: the grid is faster on a tablet, the slider is the only
 * one that reaches the nudge positions between bands.
 */
export function RubricGradingPanel({ grading, dense = false }: Props) {
  const { assignment, criteria, feedback, setFeedback, saving, handleSave } = grading;

  // Deliberately deferred to an effect rather than a lazy useState
  // initializer: this component renders during SSR, where localStorage
  // isn't available, so reading it synchronously would mismatch what the
  // client then renders. Always paints the grid first, corrects right
  // after mount if a stored preference differs.
  const [view, setView] = useState<RubricGradingViewKey>("matrix");
  useEffect(() => {
    const stored = readViewPref(window.localStorage.getItem(VIEW_PREF_KEY));
    if (stored) {
      setView(stored);
      window.localStorage.setItem(VIEW_PREF_KEY, stored);
    }
  }, []);
  function chooseView(next: RubricGradingViewKey) {
    setView(next);
    window.localStorage.setItem(VIEW_PREF_KEY, next);
  }

  if (grading.unconverted) {
    return (
      <div className={cn("flex-1 overflow-auto", dense ? "px-3 py-3" : "px-6 py-4")}>
        <UnconvertedRubricNotice name={assignment.rubric?.name} />
      </div>
    );
  }

  if (criteria.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 p-8">
        <p className="text-sm">This assignment has no rubric attached.</p>
        <p className="text-xs">
          You can still enter a total score manually by{" "}
          <Link href={`/assignments/${assignment.id}/edit`} className="underline">
            editing the assignment
          </Link>{" "}
          to add a rubric.
        </p>
      </div>
    );
  }

  const { displayScore, gradedCount, totalCount, complete } = summarize(grading);

  return (
    <div className={cn("flex-1 overflow-auto", dense ? "px-3 py-3" : "px-6 py-3")}>
      <div className="mb-2 flex items-center gap-1 rounded-md border text-xs overflow-hidden self-start w-fit">
        {(Object.keys(RUBRIC_GRADING_VIEWS) as RubricGradingViewKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => chooseView(key)}
            className={cn(
              "px-2.5 py-1 transition-colors",
              view === key
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {GRADING_VIEW_LABELS[key]}
          </button>
        ))}
      </div>

      {(() => {
        const View = RUBRIC_GRADING_VIEWS[view];
        return <View grading={grading} />;
      })()}

      {/* Feedback + total */}
      <div className={cn("mt-4 grid grid-cols-1 gap-4", !dense && "md:grid-cols-[1fr_auto]")}>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Feedback (optional)</label>
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Overall feedback for this student…"
            rows={2}
          />
        </div>

        <div
          className={cn(
            "flex gap-3",
            dense ? "flex-row flex-wrap items-center justify-between" : "flex-col items-end justify-end",
          )}
        >
          <div className={dense ? "text-left min-w-0" : "text-right"}>
            <div className={cn("font-bold tabular-nums", dense ? "text-2xl" : "text-3xl")}>
              {formatScore(displayScore)}
              <span className="text-base font-normal text-muted-foreground ml-1">/ {assignment.pointsPossible}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {gradedCount} of {totalCount} criteria
            </div>
          </div>

          <div className="flex items-center gap-3">
            {saving && <span className="text-xs text-muted-foreground animate-pulse">Saving…</span>}
            <Button
              onClick={() => handleSave(true)}
              disabled={saving || !complete}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              Mark Graded →
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
