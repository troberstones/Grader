"use client";

interface ScoreEntry {
  criterionName: string;
  score: number | null;
  maxScore: number;
}

interface RubricScoreSummaryProps {
  entries: ScoreEntry[];
  pointsPossible: number;
}

export function RubricScoreSummary({ entries, pointsPossible }: RubricScoreSummaryProps) {
  const total = entries.reduce((sum, e) => sum + (e.score ?? 0), 0);
  const allScored = entries.every((e) => e.score !== null);
  const pct = pointsPossible > 0 ? Math.round((total / pointsPossible) * 100) : 0;

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {entries.map((e) => (
          <div key={e.criterionName} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground truncate">{e.criterionName}</span>
            <span className={e.score !== null ? "font-medium" : "text-muted-foreground"}>
              {e.score !== null ? `${e.score} / ${e.maxScore}` : "—"}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t pt-2 flex items-center justify-between">
        <span className="font-semibold">Total</span>
        <span className="text-lg font-bold">
          {allScored ? (
            <>
              {total} / {pointsPossible}
              <span className="text-sm font-normal text-muted-foreground ml-2">({pct}%)</span>
            </>
          ) : (
            <span className="text-muted-foreground text-sm">Incomplete</span>
          )}
        </span>
      </div>
    </div>
  );
}
