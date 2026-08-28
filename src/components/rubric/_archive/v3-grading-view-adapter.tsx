"use client";

import { V3GradingView } from "./v3-grading-view";
import type { PointsGrading } from "@/hooks/use-rubric-grading";

/** Adapts the untouched V3GradingView's own prop shape to the {grading} shape the registry expects. */
export function V3GradingViewAdapter({ grading }: { grading: PointsGrading }) {
  return (
    <V3GradingView
      criteria={grading.criteria}
      pointsPossible={grading.assignment.pointsPossible}
      bandEdges={grading.assignment.rubric?.settings?.bandEdges ?? [20, 45, 70]}
      initialEntries={Object.entries(grading.entryMap).map(([cid, e]) => ({
        criteriaId: Number(cid),
        levelId: e.levelId,
        score: e.score,
      }))}
      onEntriesChange={(entries) => grading.setEntries(entries)}
    />
  );
}
