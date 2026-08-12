"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { V3GradingView } from "@/components/rubric/v3-grading-view";
import type { RubricGrading } from "@/hooks/use-rubric-grading";
import { cn } from "@/lib/utils";

type Level = {
  id: number;
  level: number;
  label: string;
  description: string;
  points: number;
};

const levelsHighToLow = (levels: Level[]) => [...levels].sort((a, b) => b.level - a.level);

/**
 * Weighted V3 scores are sums of floats, so a total lands as 91.60000000000001
 * often enough to matter. Two decimals is finer than any rubric resolves to,
 * and this is display only — the saved score keeps its full precision.
 */
const formatScore = (n: number) => String(Number(n.toFixed(2)));

interface Props {
  grading: RubricGrading;
  /**
   * Docked beside the art reviewer rather than filling the page: tighter
   * padding, and the score/feedback block stacks instead of sitting in a
   * two-column grid. The criterion table is unchanged — it scrolls sideways
   * inside its own container, which is what it already did on a narrow window.
   */
  dense?: boolean;
}

/**
 * The rubric scoring surface. Rendered full-width on the grade sheet and inside
 * the dock on the review route; both drive the same `useRubricGrading` state, so
 * a score entered in one place is the same save as in the other.
 */
export function RubricGradingPanel({ grading, dense = false }: Props) {
  const {
    assignment,
    criteria,
    entryMap,
    feedback,
    setFeedback,
    totalScore,
    gradedCriteria,
    allGraded,
    saving,
    selectLevel,
    setEntries,
    handleSave,
  } = grading;

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

  return (
    <div className={cn("flex-1 overflow-auto", dense ? "px-3 py-3" : "px-6 py-4")}>
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
          onEntriesChange={(entries) => setEntries(entries)}
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
                  <th
                    key={lvl.level}
                    className="text-center px-2 py-2 font-semibold min-w-[160px] align-bottom"
                  >
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
                              <TooltipContent side="bottom" className="max-w-xs text-xs">
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
      <div
        className={cn(
          "mt-6 grid grid-cols-1 gap-4",
          !dense && "md:grid-cols-[1fr_auto]",
        )}
      >
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Feedback (optional)</label>
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Overall feedback for this student…"
            rows={3}
          />
        </div>

        <div
          className={cn(
            "flex gap-3",
            dense
              ? "flex-row flex-wrap items-center justify-between"
              : "flex-col items-end justify-end",
          )}
        >
          <div className={dense ? "text-left min-w-0" : "text-right"}>
            <div
              className={cn(
                "font-bold tabular-nums",
                dense ? "text-2xl" : "text-3xl",
              )}
            >
              {formatScore(totalScore)}
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
              <span className="text-xs text-muted-foreground animate-pulse">Saving…</span>
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
  );
}
