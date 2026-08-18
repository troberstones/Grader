"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PointsGrading } from "@/hooks/use-rubric-grading";
import { cn } from "@/lib/utils";

type Level = PointsGrading["criteria"][number]["levels"][number];

const levelsHighToLow = (levels: Level[]) => [...levels].sort((a, b) => b.level - a.level);

interface Props {
  grading: PointsGrading;
}

/**
 * The v1/v2 grading grid — clickable level cells, discrete only. Extracted
 * verbatim out of what used to be inline in RubricGradingPanel; no behavior
 * change, just a real registered implementation instead of buried JSX.
 */
export function LegacyGradingView({ grading }: Props) {
  const { criteria, entryMap, selectLevel } = grading;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="text-left py-2 pr-4 font-semibold w-40 shrink-0 align-bottom">Criterion</th>
            {levelsHighToLow(criteria[0]?.levels ?? []).map((lvl) => (
              <th key={lvl.level} className="text-center px-2 py-2 font-semibold min-w-[160px] align-bottom">
                <div>{lvl.label}</div>
                <div className="text-xs font-normal text-muted-foreground">{lvl.points ?? 0} pts</div>
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
                    <div className="text-xs text-muted-foreground mt-0.5">{criterion.description}</div>
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
                              onClick={() => selectLevel(criterion.id, lvl.id, lvl.points ?? 0)}
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
                            {lvl.description || <span className="text-muted-foreground italic">No description</span>}
                          </div>
                          {isSelected && (
                            <div className="mt-1.5 text-primary font-semibold">✓ {lvl.points ?? 0} pts</div>
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
  );
}
