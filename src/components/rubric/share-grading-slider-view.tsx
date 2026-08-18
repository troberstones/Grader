"use client";

import { fractionFor, HOUSE_LABELS, letterFor } from "@/lib/rubric";
import type { BandEdges, Level, Nudge } from "@/lib/rubric";
import type { ShareGrading } from "@/hooks/use-rubric-grading";

interface Props {
  grading: ShareGrading;
}

type Anchor = { level: Level; nudge: Nudge; pct: number };

/** Every valid (level, nudge) combination as a position on a 0-100 scale, ascending. */
function anchorsFor(edges: BandEdges): Anchor[] {
  const raw: Anchor[] = [];
  for (const level of [0, 1, 2, 3] as Level[]) {
    for (const nudge of [-1, 0, 1] as Nudge[]) {
      raw.push({ level, nudge, pct: fractionFor(edges, level, nudge) * 100 });
    }
  }
  // Some combinations coincide (e.g. mastery's nudge has nowhere to go) — dedupe by rounded position.
  const seen = new Set<number>();
  return raw
    .filter((a) => {
      const key = Math.round(a.pct * 10);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.pct - b.pct);
}

function nearest(anchors: Anchor[], pct: number): Anchor {
  return anchors.reduce((best, a) => (Math.abs(a.pct - pct) < Math.abs(best.pct - pct) ? a : best));
}

/**
 * One continuous slider per criterion — drag position snaps to the nearest
 * {level, nudge}, computed from the same `fractionFor` table
 * `band-calibration.tsx` renders while authoring, so this and the authoring
 * preview provably agree. The mockup-echoing version, for comparison against
 * the discrete matrix view.
 */
export function ShareGradingSliderView({ grading }: Props) {
  const { criteria, selections, setSelection, assignment } = grading;
  const bandEdges: BandEdges = assignment.rubric?.settings?.bandEdges ?? [0.55, 0.74, 0.88];
  const anchors = anchorsFor(bandEdges);

  return (
    <div className="space-y-5">
      {criteria.map((criterion) => {
        const selection = selections[criterion.id];
        const pct = selection
          ? (anchors.find((a) => a.level === selection.level && a.nudge === selection.nudge)?.pct ?? 50)
          : 50;
        const snapped = nearest(anchors, pct);
        const levelRow = criterion.levels.find((l) => l.level === snapped.level);

        return (
          <div key={criterion.id} className="rounded-lg border p-3">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{criterion.name}</div>
                {criterion.description && (
                  <div className="text-xs text-muted-foreground">{criterion.description}</div>
                )}
              </div>
              {selection && (
                <div className="shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
                  {HOUSE_LABELS[snapped.level]} ({letterFor(snapped.pct)})
                </div>
              )}
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={0.5}
              value={pct}
              onChange={(e) => {
                const s = nearest(anchors, Number(e.target.value));
                setSelection(criterion.id, s.level, s.nudge);
              }}
              className="w-full accent-primary"
            />
            <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
              {selection ? levelRow?.description || "No description" : "Drag to select a level"}
            </p>
          </div>
        );
      })}
    </div>
  );
}
