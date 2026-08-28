"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RUBRIC_GRADING_VIEWS } from "@/components/rubric/grading-registry";
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

/**
 * Switches on `grading.model` rather than indexing `RUBRIC_GRADING_VIEWS`
 * generically — a plain index makes the "grading" prop's type the
 * intersection of every registered view's prop type (TypeScript can't know
 * in advance which one a given key resolves to), which collapses to `never`
 * since `PointsGrading`/`ShareGrading` conflict. A switch lets each branch's
 * `grading` narrow for real.
 */
function GradingView({ grading, sharePref }: { grading: RubricGrading; sharePref: "share-slider" | "share-matrix" }) {
  switch (grading.model) {
    case "points": {
      const isV3 = grading.assignment.rubric?.settings?.gradingMode === "v3";
      const View = isV3 ? RUBRIC_GRADING_VIEWS.v3 : RUBRIC_GRADING_VIEWS.legacy;
      return <View grading={grading} />;
    }
    case "share": {
      const View = sharePref === "share-slider" ? RUBRIC_GRADING_VIEWS["share-slider"] : RUBRIC_GRADING_VIEWS["share-matrix"];
      return <View grading={grading} />;
    }
  }
}

/** {displayScore, gradedCount, totalCount, complete}, read off whichever model is active. */
function summarize(grading: RubricGrading) {
  if (grading.model === "share") {
    const r = grading.scoreResult;
    return {
      displayScore: r?.points ?? 0,
      gradedCount: r?.scored ?? 0,
      totalCount: r?.total ?? grading.criteria.length,
      complete: r?.complete ?? false,
    };
  }
  return {
    displayScore: grading.totalScore,
    gradedCount: grading.gradedCriteria,
    totalCount: grading.criteria.length,
    complete: grading.allGraded,
  };
}

/**
 * The rubric scoring surface. Rendered full-width on the grade sheet and inside
 * the dock on the review route; both drive the same `useRubricGrading` state, so
 * a score entered in one place is the same save as in the other.
 *
 * Dispatches to a registered grading view (grading-registry.ts) by model —
 * legacy/v3 render exactly as they always have; a share-model rubric offers a
 * slider/matrix toggle, since comparing those two is the point of building
 * both.
 */
export function RubricGradingPanel({ grading, dense = false }: Props) {
  const { assignment, criteria, feedback, setFeedback, saving, handleSave } = grading;

  // Deliberately deferred to an effect rather than a lazy useState
  // initializer: this component renders during SSR, where localStorage
  // isn't available, so reading it synchronously would mismatch what the
  // client then renders. Always paints "share-matrix" first, corrects right
  // after mount if a stored preference differs.
  const [sharePref, setSharePref] = useState<"share-slider" | "share-matrix">("share-matrix");
  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_PREF_KEY);
    if (stored === "share-slider" || stored === "share-matrix") setSharePref(stored);
  }, []);
  function chooseSharePref(pref: "share-slider" | "share-matrix") {
    setSharePref(pref);
    window.localStorage.setItem(VIEW_PREF_KEY, pref);
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
      {grading.model === "share" && (
        <div className="mb-2 flex items-center gap-1 rounded-md border text-xs overflow-hidden self-start w-fit">
          <button
            type="button"
            onClick={() => chooseSharePref("share-matrix")}
            className={cn(
              "px-2.5 py-1 transition-colors",
              sharePref === "share-matrix"
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Matrix
          </button>
          <button
            type="button"
            onClick={() => chooseSharePref("share-slider")}
            className={cn(
              "px-2.5 py-1 transition-colors",
              sharePref === "share-slider"
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Slider
          </button>
        </div>
      )}

      <GradingView grading={grading} sharePref={sharePref} />

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
