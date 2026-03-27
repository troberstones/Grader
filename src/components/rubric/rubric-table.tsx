"use client";

import { RubricCell } from "./rubric-cell";
import { RubricScoreSummary } from "./rubric-score-summary";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface RubricLevel {
  id?: number;
  level: number; // 0=lowest, 3=highest
  label: string;
  description: string;
  points: number;
}

export interface RubricCriterionData {
  id?: number;
  name: string;
  weight: number;
  levels: RubricLevel[];
}

export interface GradeEntry {
  criteriaId: number;
  levelId?: number | null;
  score?: number | null;
  comment?: string;
}

interface RubricTableProps {
  criteria: RubricCriterionData[];
  pointsPossible?: number;
  // Grading mode props (omit for read-only preview)
  gradeEntries?: GradeEntry[];
  onSelectLevel?: (criteriaId: number, levelId: number, points: number) => void;
  onCommentChange?: (criteriaId: number, comment: string) => void;
}

export function RubricTable({
  criteria,
  pointsPossible,
  gradeEntries,
  onSelectLevel,
  onCommentChange,
}: RubricTableProps) {
  const isGrading = !!onSelectLevel;

  // Sort levels highest first for display
  const sortedCriteria = criteria.map((c) => ({
    ...c,
    levels: [...c.levels].sort((a, b) => b.level - a.level),
  }));

  function getEntry(criteriaId: number | undefined) {
    if (!criteriaId || !gradeEntries) return null;
    return gradeEntries.find((e) => e.criteriaId === criteriaId) ?? null;
  }

  const scoreEntries = sortedCriteria.map((c) => {
    const entry = getEntry(c.id);
    const maxScore = Math.max(...c.levels.map((l) => l.points));
    return { criterionName: c.name, score: entry?.score ?? null, maxScore };
  });

  return (
    <div className="space-y-4">
      {sortedCriteria.map((criterion) => {
        const entry = getEntry(criterion.id);
        const levelCount = criterion.levels.length;

        return (
          <div key={criterion.id ?? criterion.name} className="space-y-1">
            {/* Criterion header row */}
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-sm">{criterion.name}</h4>
              {entry?.score != null && (
                <span className="text-xs text-primary font-medium ml-auto">
                  {entry.score} pts
                </span>
              )}
            </div>

            {/* Level cells grid */}
            <div className={cn("grid gap-2", {
              "grid-cols-2": levelCount === 2,
              "grid-cols-3": levelCount === 3,
              "grid-cols-4": levelCount >= 4,
            })}>
              {criterion.levels.map((lvl) => (
                <RubricCell
                  key={lvl.id ?? lvl.level}
                  label={lvl.label}
                  description={lvl.description}
                  points={lvl.points}
                  selected={entry?.levelId === lvl.id}
                  interactive={isGrading}
                  onClick={() => {
                    if (criterion.id && lvl.id) {
                      onSelectLevel?.(criterion.id, lvl.id, lvl.points);
                    }
                  }}
                />
              ))}
            </div>

            {/* Per-criterion comment (grading mode only) */}
            {isGrading && criterion.id && (
              <Textarea
                placeholder="Optional comment for this criterion..."
                value={entry?.comment ?? ""}
                onChange={(e) => onCommentChange?.(criterion.id!, e.target.value)}
                className="text-xs resize-none mt-1"
                rows={2}
              />
            )}
          </div>
        );
      })}

      {/* Score summary (grading mode only) */}
      {isGrading && gradeEntries && (
        <div className="border rounded-lg p-4 bg-muted/30 mt-4">
          <h4 className="font-semibold text-sm mb-3">Score Summary</h4>
          <RubricScoreSummary
            entries={scoreEntries}
            pointsPossible={pointsPossible ?? Math.max(...sortedCriteria.map((c) => Math.max(...c.levels.map((l) => l.points))))}
          />
        </div>
      )}
    </div>
  );
}
