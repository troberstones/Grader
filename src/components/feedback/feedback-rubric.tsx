import { cn } from "@/lib/utils";
import type { FeedbackModel } from "@/lib/feedback/model";

/**
 * The graded rubric as a student sees it on their feedback page — the same
 * shape as the grading grid (share-grading-matrix-view.tsx): one card per
 * criterion, its levels side by side, the chosen one highlighted. Letters
 * only, never points; FeedbackModel carries none.
 */
export function FeedbackRubric({ model }: { model: FeedbackModel }) {
  return (
    <div className="space-y-2">
      {model.criteria.map((c) => (
        <div key={c.name} className="rounded-lg border p-2.5">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium">{c.name}</div>
              {c.description && <div className="text-xs text-muted-foreground">{c.description}</div>}
            </div>
            <div className="shrink-0 text-sm font-semibold tabular-nums">
              {c.letter ?? <span className="text-xs font-normal text-muted-foreground">Not scored</span>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            {c.levels.map((level, i) => {
              const on = c.selected === i;
              return (
                <div
                  key={i}
                  className={cn(
                    "min-h-[52px] rounded-lg border p-2 text-xs",
                    on ? "border-primary bg-primary/10 font-medium ring-1 ring-primary/30" : "border-border opacity-60",
                  )}
                >
                  <div className="font-semibold">{level.label}</div>
                  <div className="mt-0.5 text-muted-foreground">{level.description || "No description"}</div>
                </div>
              );
            })}
          </div>
          {c.comment && <p className="mt-2 whitespace-pre-line text-sm italic">{c.comment}</p>}
        </div>
      ))}
    </div>
  );
}
