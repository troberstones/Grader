"use client";

/**
 * V3GradingView — Fluid-slider grading panel for V3 rubrics.
 *
 * Displays one fluid slider per criterion. Computes band-based scores and
 * calls onEntriesChange whenever any slider changes.
 */

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

// ─── Constants (copied from rubric-editor-v3, module-private there) ──────────

const TOTAL_PTS = 100;

const CRITERION_COLORS = [
  "#7a9bbf", "#bf7a9b", "#9bbf7a", "#bfae7a", "#9b7abf", "#7abfbf", "#bf997a",
];

const BANDS = [
  { letter: "A",  color: "#7bbf82", label: "Mastery"  },
  { letter: "B+", color: "#b9c97a", label: "Good"     },
  { letter: "B−", color: "#d4a85a", label: "Lacking"  },
  { letter: "C",  color: "#c97070", label: "Little"   },
] as const;

type BandEdges = [number, number, number];

function cMax(weight: number, totalWeight: number): number {
  return totalWeight > 0 ? (weight / totalWeight) * TOTAL_PTS : 0;
}

function lPts(max: number, ratio: number): number {
  return Math.round((max * ratio) / 100 * 10) / 10;
}

function getBandIdx(pct: number, edges: BandEdges): number {
  if (pct <= edges[0]) return 0;
  if (pct <= edges[1]) return 1;
  if (pct <= edges[2]) return 2;
  return 3;
}

function getBand(pct: number, edges: BandEdges) {
  return BANDS[getBandIdx(pct, edges)];
}

function pctTo4(pct: number): string {
  return (4 * (1 - pct / 100)).toFixed(2);
}

function ratioFromBandEdge(levelIdx: number, edges: BandEdges): number {
  if (levelIdx === 0) return 100;
  return 100 - edges[levelIdx - 1];
}

/** Midpoint of a band given its display index */
function bandMidpoint(di: number, edges: BandEdges): number {
  const ranges: [number, number][] = [
    [0, edges[0]],
    [edges[0], edges[1]],
    [edges[1], edges[2]],
    [edges[2], 100],
  ];
  const [lo, hi] = ranges[di] ?? [0, 100];
  return (lo + hi) / 2;
}

// ─── Fluid Slider ─────────────────────────────────────────────────────────────

function FluidSlider({
  score,
  bandEdges,
  onChange,
}: {
  score: number;
  bandEdges: BandEdges;
  onChange: (v: number) => void;
}) {
  const trackBands = [
    { from: 0,             to: bandEdges[0], color: BANDS[0].color },
    { from: bandEdges[0],  to: bandEdges[1], color: BANDS[1].color },
    { from: bandEdges[1],  to: bandEdges[2], color: BANDS[2].color },
    { from: bandEdges[2],  to: 100,          color: BANDS[3].color },
  ];
  const band = getBand(score, bandEdges);

  return (
    <div className="relative h-6">
      {/* Colored band track */}
      <div className="absolute left-0 right-0 top-[9px] h-2 rounded-full overflow-hidden border border-border/40 flex">
        {trackBands.map((b, i) => (
          <div
            key={i}
            style={{
              width: `${b.to - b.from}%`,
              background: `linear-gradient(180deg, ${b.color}99, ${b.color}55)`,
              borderRight:
                i < trackBands.length - 1 ? "1px solid hsl(var(--background) / 0.5)" : "none",
            }}
          />
        ))}
      </div>

      {/* Anchor tick marks */}
      {[0, 25, 50, 75, 100].map((t) => (
        <div
          key={t}
          className="absolute w-px bg-foreground/20"
          style={{ left: `${t}%`, top: 5, height: 16 }}
        />
      ))}

      {/* Invisible range input */}
      <input
        type="range"
        min={0}
        max={100}
        value={score}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 w-full opacity-0 cursor-grab z-10"
      />

      {/* Visible puck */}
      <div
        className="absolute top-[2px] w-4 h-4 rounded-full border-2 border-background pointer-events-none transition-[left] duration-75"
        style={{
          left: `calc(${score}% - 8px)`,
          background: band.color,
          boxShadow: `0 0 0 3px ${band.color}44, 0 1px 4px rgba(0,0,0,0.25)`,
        }}
      />
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Level {
  id: number;
  level: number;
  label: string;
  description: string;
  // Never read below — points are recomputed from weight+bandEdges. Null
  // only for share-model criteria, which this view never renders.
  points: number | null;
}

interface Criterion {
  id: number;
  name: string;
  description?: string | null;
  weight: number;
  levels: Level[];
}

interface GradeEntry {
  criteriaId: number;
  levelId: number;
  score: number;
}

interface V3GradingViewProps {
  criteria: Criterion[];
  pointsPossible: number;
  bandEdges?: [number, number, number];
  initialEntries: GradeEntry[];
  onEntriesChange: (entries: GradeEntry[], totalScore: number) => void;
}

// ─── V3GradingView ────────────────────────────────────────────────────────────

export function V3GradingView({
  criteria,
  pointsPossible,
  bandEdges = [20, 45, 70],
  initialEntries,
  onEntriesChange,
}: V3GradingViewProps) {
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);

  /**
   * Initialize slider positions from existing entries.
   * For each criterion, find the stored levelId, determine which display index (di)
   * that level maps to (levels sorted descending by level integer → di=0 is best),
   * then set slider to midpoint of that band.
   */
  const [scores, setScores] = useState<number[]>(() =>
    criteria.map((c) => {
      const entry = initialEntries.find((e) => e.criteriaId === c.id);
      if (!entry) return 30; // default: somewhere in A band

      // Sort levels descending to get display index
      const sortedDesc = [...c.levels].sort((a, b) => b.level - a.level);
      const di = sortedDesc.findIndex((l) => l.id === entry.levelId);
      if (di === -1) return 30;
      return bandMidpoint(di, bandEdges);
    })
  );

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [allOpen, setAllOpen] = useState(false);

  // Sync scores length when criteria change
  useEffect(() => {
    setScores((prev) => {
      if (prev.length === criteria.length) return prev;
      const next = [...prev];
      while (next.length < criteria.length) next.push(30);
      return next.slice(0, criteria.length);
    });
  }, [criteria.length]);

  /**
   * Compute entries and total score, then call onEntriesChange.
   * We also scale the total to pointsPossible.
   */
  const computeAndNotify = useCallback(
    (newScores: number[]) => {
      const entries: GradeEntry[] = criteria.map((c, i) => {
        const score = newScores[i] ?? 30;
        const di = getBandIdx(score, bandEdges);
        const max = cMax(c.weight, totalWeight);
        const pts = lPts(max, ratioFromBandEdge(di, bandEdges));

        // Map di → levelId: sort levels descending → di=0 is highest level integer
        const sortedDesc = [...c.levels].sort((a, b) => b.level - a.level);
        const levelId = sortedDesc[di]?.id ?? sortedDesc[0]?.id ?? 0;

        return { criteriaId: c.id, levelId, score: pts };
      });

      const rawTotal = entries.reduce((s, e) => s + e.score, 0);
      // Scale from TOTAL_PTS (100) to pointsPossible
      const totalScore = totalWeight > 0
        ? Math.round((rawTotal / TOTAL_PTS) * pointsPossible * 10) / 10
        : rawTotal;

      onEntriesChange(entries, totalScore);
    },
    [criteria, bandEdges, totalWeight, pointsPossible, onEntriesChange]
  );

  function handleSliderChange(i: number, v: number) {
    setScores((prev) => {
      const next = prev.map((s, j) => (j === i ? v : s));
      computeAndNotify(next);
      return next;
    });
  }

  function toggleRow(i: number) {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  }

  function toggleAll() {
    if (allOpen) {
      setExpanded(new Set());
      setAllOpen(false);
    } else {
      setExpanded(new Set(criteria.map((_, i) => i)));
      setAllOpen(true);
    }
  }

  // Weighted-average slider position → overall letter
  const weightedPct =
    totalWeight > 0
      ? criteria.reduce((s, c, i) => s + (scores[i] ?? 30) * c.weight, 0) / totalWeight
      : 30;

  const overall = getBand(weightedPct, bandEdges);

  // Total pts out of TOTAL_PTS (100)
  const totalPts = criteria.reduce((sum, c, i) => {
    const s = scores[i] ?? 30;
    const di = getBandIdx(s, bandEdges);
    const max = cMax(c.weight, totalWeight);
    return sum + lPts(max, ratioFromBandEdge(di, bandEdges));
  }, 0);

  const scaledTotal = totalWeight > 0
    ? Math.round((totalPts / TOTAL_PTS) * pointsPossible * 10) / 10
    : totalPts;

  const overallScore4 = ((totalPts / TOTAL_PTS) * 4).toFixed(2);

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div
        className="rounded-lg border p-3 flex items-center gap-4 flex-wrap"
        style={{
          background: `linear-gradient(90deg, ${overall.color}14, transparent 60%)`,
          borderColor: `${overall.color}66`,
        }}
      >
        <span className="text-3xl font-bold leading-none" style={{ color: overall.color }}>
          {overall.letter}
        </span>
        <div>
          <div className="text-sm font-medium">{overallScore4} / 4.0 weighted</div>
          <div className="text-xs text-muted-foreground font-mono">
            {scaledTotal} / {pointsPossible} pts · {overall.label}
          </div>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={toggleAll}
          className="text-xs border rounded-full px-2.5 py-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          {allOpen ? "▾ collapse all" : "▸ show all descriptions"}
        </button>
      </div>

      {/* Criterion rows */}
      <div className="rounded-lg border overflow-hidden">
        {criteria.map((c, i) => {
          const score = scores[i] ?? 30;
          const di = getBandIdx(score, bandEdges);
          const band = BANDS[di];
          const max = cMax(c.weight, totalWeight);
          const pts = lPts(max, ratioFromBandEdge(di, bandEdges));
          const isOpen = expanded.has(i);
          const color = CRITERION_COLORS[i % CRITERION_COLORS.length];

          // Sort levels desc for display (index 0 = best = Mastery)
          const levelsDesc = [...c.levels].sort((a, b) => b.level - a.level);

          // Active level for highlight: di maps directly to display index
          const activeDisplayIdx = di;

          return (
            <div
              key={c.id}
              className={cn("border-b last:border-b-0", isOpen && "bg-muted/5")}
              style={{ borderLeft: `3px solid ${color}55` }}
            >
              {/* Compact row */}
              <div
                className="grid items-center gap-3 px-3 py-2.5"
                style={{ gridTemplateColumns: "24px 1fr 44px 1fr 80px" }}
              >
                {/* Expand toggle */}
                <button
                  type="button"
                  onClick={() => toggleRow(i)}
                  className="text-xs font-mono text-muted-foreground hover:text-foreground text-center transition-colors"
                >
                  {isOpen ? "▾" : "▸"}
                </button>

                {/* Name */}
                <button
                  type="button"
                  onClick={() => toggleRow(i)}
                  className="text-sm font-medium text-left truncate hover:text-primary transition-colors"
                >
                  {c.name || `Criterion ${i + 1}`}
                </button>

                {/* Weight */}
                <span className="text-xs font-mono text-muted-foreground text-right">
                  {c.weight}×
                </span>

                {/* Fluid slider */}
                <FluidSlider
                  score={score}
                  bandEdges={bandEdges}
                  onChange={(v) => handleSliderChange(i, v)}
                />

                {/* Score + letter */}
                <div className="flex items-center gap-2 justify-end">
                  <span className="text-xs font-mono text-muted-foreground">{pts.toFixed(1)}</span>
                  <span
                    className="text-base font-bold min-w-[26px] text-right"
                    style={{ color: band.color }}
                  >
                    {band.letter}
                  </span>
                </div>
              </div>

              {/* Expanded: 4-column level descriptions */}
              {isOpen && (
                <div
                  className="grid gap-2 px-3 pb-3"
                  style={{
                    gridTemplateColumns: `repeat(${levelsDesc.length}, 1fr)`,
                    paddingLeft: 48,
                  }}
                >
                  {levelsDesc.map((lvl, j) => {
                    const isActive = j === activeDisplayIdx;
                    const levelScore = lPts(max, ratioFromBandEdge(j, bandEdges));
                    return (
                      <div
                        key={lvl.id}
                        className="rounded-md border p-2.5 transition-colors"
                        style={
                          isActive
                            ? {
                                borderColor: "hsl(var(--primary))",
                                background: "hsl(var(--primary) / 0.05)",
                              }
                            : {}
                        }
                      >
                        <div className="flex items-baseline gap-1.5 mb-1.5">
                          <span
                            className="text-xs font-semibold"
                            style={isActive ? { color: "hsl(var(--primary))" } : {}}
                          >
                            {lvl.label}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {levelScore} pts
                          </span>
                          {isActive && (
                            <span className="text-[9px] font-mono text-primary ml-auto">
                              ● active
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground leading-relaxed">
                          {lvl.description ? (
                            lvl.description
                          ) : (
                            <span className="italic opacity-40">No description</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground text-right">
        ▸ click a criterion to see level descriptions · drag sliders to grade
      </p>
    </div>
  );
}
