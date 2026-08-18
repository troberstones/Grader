"use client";

import { cn } from "@/lib/utils";
import { HOUSE_LABELS } from "@/lib/rubric";
import type { Level } from "@/lib/rubric";
import type { ShareGrading } from "@/hooks/use-rubric-grading";

interface Props {
  grading: ShareGrading;
}

/**
 * Rows = criteria, 4 big tap targets per row — the "4 choice per category"
 * touch-first grading view. No drag, no nudge; a level is either selected
 * or it isn't.
 */
export function ShareGradingMatrixView({ grading }: Props) {
  const { criteria, selections, setSelection } = grading;

  return (
    <div className="space-y-3">
      {criteria.map((criterion) => {
        const current = selections[criterion.id];
        return (
          <div key={criterion.id} className="rounded-lg border p-3">
            <div className="mb-2">
              <div className="text-sm font-medium">{criterion.name}</div>
              {criterion.description && (
                <div className="text-xs text-muted-foreground">{criterion.description}</div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([0, 1, 2, 3] as const).map((level) => {
                const levelRow = criterion.levels.find((l) => l.level === level);
                const isSelected = current?.level === level;
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setSelection(criterion.id, level as Level, 0)}
                    className={cn(
                      "min-h-[68px] rounded-lg border p-2.5 text-left text-xs transition-colors",
                      isSelected
                        ? "border-primary bg-primary/10 font-medium ring-1 ring-primary/30"
                        : "border-border bg-background hover:border-primary/60 hover:bg-primary/5",
                    )}
                  >
                    <div className="font-semibold">{HOUSE_LABELS[level]}</div>
                    <div className="mt-1 line-clamp-3 text-muted-foreground">
                      {levelRow?.description || "No description"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
