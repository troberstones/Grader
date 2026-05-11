"use client";

/**
 * RubricEditorV3 — Hybrid: Spreadsheet editing + Fluid grade preview.
 *
 * Edit mode:
 *   - WeightBar: horizontal stacked bar showing each criterion's share; ± to rebalance
 *   - BandStrip: draggable handles map the 0-4 score range to letter grades (A→B+→B−→C)
 *   - FormulaBar: formula-bar style full-width editor for the focused cell
 *   - SpreadsheetGrid: criteria × levels grid; click any cell to edit via formula bar
 *
 * Preview mode (grade view):
 *   - Summary: overall weighted letter grade
 *   - Compact criterion rows: fluid slider (A left, C right) with live letter/score
 *   - Expandable per-criterion level descriptions, closest tier highlighted
 */

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_RUBRIC_LEVELS } from "@/lib/constants";
import type { RubricJSON } from "@/types/rubric";

// ─── Constants ───────────────────────────────────────────────────────────────

const TOTAL_PTS = 100;

/** Seven distinct accent colors for criterion segments */
const CRITERION_COLORS = [
  "#7a9bbf", "#bf7a9b", "#9bbf7a", "#bfae7a", "#9b7abf", "#7abfbf", "#bf997a",
];

/** Band definitions, left-to-right: best → worst */
const BANDS = [
  { letter: "A",  color: "#7bbf82", label: "Mastery"  },
  { letter: "B+", color: "#b9c97a", label: "Good"     },
  { letter: "B−", color: "#d4a85a", label: "Lacking"  },
  { letter: "C",  color: "#c97070", label: "Little"   },
] as const;

type BandTuple = typeof BANDS;
type BandIndex = 0 | 1 | 2 | 3;

/** edges[0] = A/B+ boundary, [1] = B+/B− boundary, [2] = B−/C boundary, pct from left */
type BandEdges = [number, number, number];

const BAND_PRESETS: Record<string, BandEdges> = {
  generous:  [20, 45, 70],
  quartiles: [25, 50, 75],
  strict:    [30, 55, 78],
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Level {
  level: number;
  label: string;
  description: string;
  // no ratio — points are always derived from band edges
}

interface Criterion {
  name: string;
  description: string;
  weight: number;
  levels: Level[]; // sorted highest-level-first (index 0 = mastery/best)
}

interface FocusCell {
  row: number;
  col: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_NAMES = [
  "Visual Representation", "Material Quality", "Lighting", "Composition",
  "Technical Execution", "Effort & Complexity", "Overall Presentation",
];

function newCriterion(name = ""): Criterion {
  return {
    name,
    description: "",
    weight: 1.0,
    levels: [...DEFAULT_RUBRIC_LEVELS]
      .sort((a, b) => b.level - a.level)
      .map((l) => ({ level: l.level, label: l.label, description: "" })),
  };
}

function cMax(weight: number, totalWeight: number): number {
  return totalWeight > 0 ? (weight / totalWeight) * TOTAL_PTS : 0;
}

function lPts(max: number, ratio: number): number {
  return Math.round((max * ratio) / 100 * 10) / 10;
}

function getBand(pct: number, edges: BandEdges): BandTuple[BandIndex] {
  if (pct <= edges[0]) return BANDS[0];
  if (pct <= edges[1]) return BANDS[1];
  if (pct <= edges[2]) return BANDS[2];
  return BANDS[3];
}

/** Convert 0-100 left-to-right pct to a 0.0–4.0 display score (left = best = 4.0) */
function pctTo4(pct: number): string {
  return (4 * (1 - pct / 100)).toFixed(2);
}

/**
 * Derive a level's ratio (% of criterion max it earns) from the band edges.
 * levelIdx is the display index: 0=Mastery(A), 1=Good(B+), 2=Lacking(B−), 3=Little(C).
 * Mastery always earns 100%. Each subsequent level earns what remains to the
 * right of its band's left boundary on the 0→100 worst scale:
 *   ratio = 100 − edges[levelIdx − 1]
 */
function ratioFromBandEdge(levelIdx: number, edges: BandEdges): number {
  if (levelIdx === 0) return 100;
  return 100 - edges[levelIdx - 1];
}

// ─── Main export ─────────────────────────────────────────────────────────────

interface RubricEditorV3Props {
  initialData?: RubricJSON;
  onSave: (data: RubricJSON) => Promise<void>;
  saving?: boolean;
}

export function RubricEditorV3({ initialData, onSave, saving }: RubricEditorV3Props) {
  const [rubricName, setRubricName] = useState(initialData?.name ?? "");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [bandEdges, setBandEdges] = useState<BandEdges>([20, 45, 70]);

  const [criteria, setCriteria] = useState<Criterion[]>(() => {
    if (initialData?.criteria?.length) {
      return initialData.criteria.map((c) => ({
        name: c.name,
        description: c.description ?? "",
        weight: c.weight,
        levels: [...c.levels]
          .sort((a, b) => b.level - a.level)
          .map((l) => ({ level: l.level, label: l.label, description: l.description })),
      }));
    }
    return DEFAULT_NAMES.map((n) => newCriterion(n));
  });

  const [focus, setFocus] = useState<FocusCell>({ row: 0, col: 0 });
  const formulaRef = useRef<HTMLTextAreaElement>(null);
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);

  // Auto-focus formula bar when cell focus changes in edit mode
  useEffect(() => {
    if (mode === "edit") {
      requestAnimationFrame(() => formulaRef.current?.focus());
    }
  }, [focus.row, focus.col, mode]);

  const focusedCriterion = criteria[focus.row];
  const focusedLevel = focusedCriterion?.levels[focus.col];

  function setLevelDescription(row: number, col: number, val: string) {
    setCriteria((prev) =>
      prev.map((c, ri) =>
        ri !== row
          ? c
          : { ...c, levels: c.levels.map((l, ci) => (ci !== col ? l : { ...l, description: val })) }
      )
    );
  }

  function handleFormulaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const numCols = criteria[0]?.levels.length ?? 4;
    const numRows = criteria.length;
    if (e.key === "Tab") {
      e.preventDefault();
      setFocus((f) => {
        let r = f.row, c = f.col + (e.shiftKey ? -1 : 1);
        if (c >= numCols) { c = 0; r = Math.min(numRows - 1, r + 1); }
        if (c < 0) { c = numCols - 1; r = Math.max(0, r - 1); }
        return { row: r, col: c };
      });
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setFocus((f) => ({ ...f, row: Math.min(numRows - 1, f.row + 1) }));
    }
  }

  function updateWeight(idx: number, delta: number) {
    setCriteria((prev) =>
      prev.map((c, i) =>
        i !== idx
          ? c
          : { ...c, weight: Math.max(0.1, parseFloat((c.weight + delta).toFixed(1))) }
      )
    );
  }

  function setWeightDirect(idx: number, raw: string) {
    const v = parseFloat(raw);
    if (!isFinite(v) || v <= 0) return;
    setCriteria((prev) =>
      prev.map((c, i) => (i !== idx ? c : { ...c, weight: parseFloat(v.toFixed(1)) }))
    );
  }

  function equalize() {
    setCriteria((prev) => prev.map((c) => ({ ...c, weight: 1.0 })));
  }

  function addCriterion() {
    const next = criteria.length;
    setCriteria((prev) => [...prev, newCriterion()]);
    setFocus({ row: next, col: 0 });
  }

  function removeCriterion(idx: number) {
    setCriteria((prev) => prev.filter((_, i) => i !== idx));
    setFocus((f) => ({ ...f, row: Math.max(0, Math.min(f.row, criteria.length - 2)) }));
  }

  function moveCriterion(idx: number, dir: -1 | 1) {
    setCriteria((prev) => {
      const next = [...prev];
      const t = idx + dir;
      if (t < 0 || t >= next.length) return prev;
      [next[idx], next[t]] = [next[t], next[idx]];
      return next;
    });
  }

  function updateCriterionName(idx: number, val: string) {
    setCriteria((prev) => prev.map((c, i) => (i !== idx ? c : { ...c, name: val })));
  }

  async function handleSave() {
    await onSave({
      name: rubricName,
      settings: { gradingMode: 'v3' as const, bandEdges },
      criteria: criteria.map((c) => {
        const max = cMax(c.weight, totalWeight);
        // Sort highest-first to get display indices, then re-sort ascending for storage
        const sortedDesc = [...c.levels].sort((a, b) => b.level - a.level);
        return {
          name: c.name,
          description: c.description || undefined,
          weight: c.weight,
          levels: sortedDesc
            .map((l, di) => ({
              level: l.level,
              label: l.label,
              description: l.description,
              points: lPts(max, ratioFromBandEdge(di, bandEdges)),
            }))
            .sort((a, b) => a.level - b.level),
        };
      }),
    });
  }

  return (
    <div className="pb-24 space-y-0">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-20 -mx-6 -mt-6 px-6 py-3 bg-background/95 backdrop-blur border-b flex items-center gap-3">
        <Input
          value={rubricName}
          onChange={(e) => setRubricName(e.target.value)}
          placeholder="Rubric name (required)"
          className="font-semibold w-64"
        />
        {/* Mode toggle */}
        <div className="flex items-center rounded-md border text-sm overflow-hidden">
          {(["edit", "preview"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "px-3 py-1.5 transition-colors",
                mode === m
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m === "edit" ? "✎ Edit" : "◐ Preview"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Button size="sm" onClick={handleSave} disabled={!rubricName || saving}>
          {saving ? "Saving…" : "Save Rubric"}
        </Button>
      </div>

      <div className="pt-4 space-y-3">
        {mode === "edit" ? (
          <>
            <WeightBar
              criteria={criteria}
              totalWeight={totalWeight}
              updateWeight={updateWeight}
              equalize={equalize}
            />
            <BandStrip edges={bandEdges} setEdges={setBandEdges} />
            <FormulaBar
              criterion={focusedCriterion}
              criterionIdx={focus.row}
              levelIdx={focus.col}
              level={focusedLevel}
              formulaRef={formulaRef}
              onChange={(val) => setLevelDescription(focus.row, focus.col, val)}
              onKeyDown={handleFormulaKeyDown}
            />
            <SpreadsheetGrid
              criteria={criteria}
              totalWeight={totalWeight}
              bandEdges={bandEdges}
              focus={focus}
              onFocus={setFocus}
              onNameChange={updateCriterionName}
              onWeightDirect={setWeightDirect}
              onMove={moveCriterion}
              onRemove={removeCriterion}
              onAdd={addCriterion}
            />
          </>
        ) : (
          <GradePreview
            criteria={criteria}
            totalWeight={totalWeight}
            bandEdges={bandEdges}
          />
        )}
      </div>
    </div>
  );
}

// ─── WeightBar ────────────────────────────────────────────────────────────────

function WeightBar({
  criteria,
  totalWeight,
  updateWeight,
  equalize,
}: {
  criteria: Criterion[];
  totalWeight: number;
  updateWeight: (idx: number, delta: number) => void;
  equalize: () => void;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium">How much does each criterion count?</span>
        <span className="text-xs text-muted-foreground font-mono">
          total {totalWeight.toFixed(1)}× · adjust ± to rebalance
        </span>
        <button
          type="button"
          onClick={equalize}
          className="ml-auto text-xs border rounded-full px-2.5 py-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          equalize all
        </button>
      </div>

      {/* Stacked proportional bar */}
      <div className="flex h-7 rounded-md overflow-hidden border">
        {criteria.map((c, i) => {
          const pct = totalWeight > 0 ? (c.weight / totalWeight) * 100 : 0;
          const color = CRITERION_COLORS[i % CRITERION_COLORS.length];
          return (
            <div
              key={i}
              className="flex items-center justify-center overflow-hidden relative shrink-0"
              style={{
                width: `${pct}%`,
                background: `${color}55`,
                borderRight:
                  i < criteria.length - 1 ? "2px solid hsl(var(--background))" : "none",
                transition: "width 0.15s ease",
              }}
            >
              {pct >= 8 && (
                <span
                  className="text-[11px] font-mono font-semibold whitespace-nowrap"
                  style={{ color }}
                >
                  {Math.round(pct)}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Per-criterion ± controls */}
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))" }}>
        {criteria.map((c, i) => {
          const color = CRITERION_COLORS[i % CRITERION_COLORS.length];
          return (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md px-2 py-1.5"
              style={{
                background: `${color}14`,
                borderLeft: `3px solid ${color}`,
              }}
            >
              <span
                className="text-xs font-medium truncate flex-1"
                style={{ color }}
              >
                {c.name || `Criterion ${i + 1}`}
              </span>
              <button
                type="button"
                onClick={() => updateWeight(i, -0.1)}
                className="w-5 h-5 text-xs flex items-center justify-center rounded border bg-background/40 hover:bg-muted transition-colors"
              >
                −
              </button>
              <span className="text-xs font-mono w-8 text-center">{c.weight.toFixed(1)}×</span>
              <button
                type="button"
                onClick={() => updateWeight(i, 0.1)}
                className="w-5 h-5 text-xs flex items-center justify-center rounded border bg-background/40 hover:bg-muted transition-colors"
              >
                +
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── BandStrip ────────────────────────────────────────────────────────────────

function BandStrip({
  edges,
  setEdges,
}: {
  edges: BandEdges;
  setEdges: (e: BandEdges) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  useEffect(() => {
    if (dragging === null) return;
    const onMove = (e: MouseEvent) => {
      const rect = stripRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pct = Math.max(5, Math.min(95, ((e.clientX - rect.left) / rect.width) * 100));
      setEdges(
        ((prev: BandEdges) =>
          prev.map((edge, i) => {
            if (i !== dragging) return edge;
            const min = i === 0 ? 5 : prev[i - 1] + 6;
            const max = i === prev.length - 1 ? 95 : prev[i + 1] - 6;
            return Math.max(min, Math.min(max, pct));
          }) as BandEdges)(edges)
      );
    };
    const onUp = () => setDragging(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, edges, setEdges]);

  const visibleBands = [
    { ...BANDS[0], from: 0,        to: edges[0] },
    { ...BANDS[1], from: edges[0], to: edges[1] },
    { ...BANDS[2], from: edges[1], to: edges[2] },
    { ...BANDS[3], from: edges[2], to: 100 },
  ];

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium">Grade bands</span>
        <span className="text-xs text-muted-foreground">drag handles · best ← → worst</span>
        <div className="ml-auto flex items-center gap-1.5">
          {Object.entries(BAND_PRESETS).map(([k, v]) => (
            <button
              key={k}
              type="button"
              onClick={() => setEdges(v)}
              className="text-xs border rounded-full px-2 py-0.5 text-muted-foreground hover:text-foreground transition-colors capitalize"
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* Band strip with draggable handles */}
      <div ref={stripRef} className="relative h-12 select-none">
        <div className="absolute inset-0 flex rounded-md overflow-hidden border">
          {visibleBands.map((b, i) => (
            <div
              key={i}
              className="flex flex-col justify-center px-2.5 overflow-hidden min-w-0"
              style={{
                width: `${b.to - b.from}%`,
                background: `linear-gradient(180deg, ${b.color}33, ${b.color}18)`,
                borderRight: i < visibleBands.length - 1 ? "1px solid hsl(var(--border))" : "none",
                transition: "width 0.05s",
              }}
            >
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold leading-none" style={{ color: b.color }}>
                  {b.letter}
                </span>
                <span className="text-xs text-muted-foreground truncate">{b.label}</span>
              </div>
              <div className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">
                {pctTo4(b.to)}–{pctTo4(b.from)} · {Math.round(b.to - b.from)}%
              </div>
            </div>
          ))}
        </div>

        {/* Drag handles */}
        {edges.map((edge, i) => (
          <div
            key={i}
            onMouseDown={() => setDragging(i)}
            className="absolute top-0 bottom-0 w-4 -translate-x-1/2 flex items-center justify-center cursor-ew-resize z-10"
            style={{ left: `${edge}%` }}
          >
            <div
              className="w-[3px] rounded-full transition-colors"
              style={{
                height: "80%",
                background:
                  dragging === i ? "hsl(var(--primary))" : "hsl(var(--foreground) / 0.6)",
                boxShadow:
                  dragging === i
                    ? "0 0 0 4px hsl(var(--primary) / 0.15)"
                    : "0 0 0 2px hsl(var(--background))",
              }}
            />
          </div>
        ))}
      </div>

      {/* 0-4 scale labels */}
      <div className="relative h-4">
        {[4, 3, 2, 1, 0].map((t, i) => (
          <div
            key={t}
            className="absolute text-[10px] text-muted-foreground font-mono -translate-x-1/2"
            style={{ left: `${i * 25}%` }}
          >
            {t}.0
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Formula Bar ──────────────────────────────────────────────────────────────

function FormulaBar({
  criterion,
  criterionIdx,
  levelIdx,
  level,
  formulaRef,
  onChange,
  onKeyDown,
}: {
  criterion: Criterion | undefined;
  criterionIdx: number;
  levelIdx: number;
  level: Level | undefined;
  formulaRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (val: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  if (!criterion || !level) return null;
  return (
    <div className="rounded-t-lg border border-b-0 bg-muted/50 p-3 flex gap-4 items-start">
      {/* Cell address + coordinates */}
      <div className="shrink-0 min-w-[160px]">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Editing cell
        </div>
        <div className="text-sm font-mono text-primary mt-1 leading-tight">
          {criterion.name || `Criterion ${criterionIdx + 1}`}
          <span className="text-muted-foreground"> / </span>
          {level.label}
        </div>
        <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
          R{criterionIdx + 1} · C{levelIdx + 1}
        </div>
      </div>

      {/* Full-width description editor */}
      <div className="flex-1 min-w-0">
        <textarea
          ref={formulaRef}
          value={level.description}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Describe the ${level.label.toLowerCase()} level for "${criterion.name || "this criterion"}"…`}
          rows={3}
          className="w-full bg-transparent text-sm resize-none focus:outline-none placeholder:text-muted-foreground/40 leading-relaxed"
        />
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <span className="text-[10px] font-mono text-muted-foreground">
            ⇥ next col · ⌘↵ next row · Shift⇥ prev col
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-muted-foreground border rounded-full px-2 py-0.5">
              ⌘D duplicate row
            </span>
            <span className="text-[10px] font-mono border rounded-full px-2 py-0.5 text-primary/70 border-primary/20 bg-primary/5">
              ✦ ⌘K AI rewrite
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Spreadsheet Grid ─────────────────────────────────────────────────────────

function SpreadsheetGrid({
  criteria,
  totalWeight,
  bandEdges,
  focus,
  onFocus,
  onNameChange,
  onWeightDirect,
  onMove,
  onRemove,
  onAdd,
}: {
  criteria: Criterion[];
  totalWeight: number;
  bandEdges: BandEdges;
  focus: FocusCell;
  onFocus: (f: FocusCell) => void;
  onNameChange: (idx: number, val: string) => void;
  onWeightDirect: (idx: number, raw: string) => void;
  onMove: (idx: number, dir: -1 | 1) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
}) {
  const levelLabels = criteria[0]?.levels.map((l) => l.label) ?? [
    "Mastery", "Good", "Lacking", "Little",
  ];

  return (
    <div className="rounded-b-lg border overflow-x-auto">
      {/* Column headers */}
      <div
        className="flex bg-muted/50 min-w-max"
        style={{ borderBottom: "1.5px solid hsl(var(--border))" }}
      >
        <div className="w-8 shrink-0 flex items-center justify-center text-[10px] font-mono text-muted-foreground border-r py-2">
          #
        </div>
        <div className="w-44 shrink-0 px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground border-r">
          Criterion · Weight
        </div>
        {levelLabels.map((l, i) => (
          <div
            key={i}
            className="flex-1 min-w-[140px] px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground border-r last:border-r-0"
          >
            {String.fromCharCode(65 + i)} · {l}
          </div>
        ))}
        <div className="w-20 shrink-0 border-l" />
      </div>

      {/* Criterion rows */}
      <div className="min-w-max">
        {criteria.map((criterion, ri) => {
          const max = cMax(criterion.weight, totalWeight);
          const pct = totalWeight > 0 ? (criterion.weight / totalWeight) * 100 : 0;
          const color = CRITERION_COLORS[ri % CRITERION_COLORS.length];

          return (
            <div
              key={ri}
              className="flex border-b last:border-b-0"
              style={{ borderLeft: `3px solid ${color}55` }}
            >
              {/* Row number */}
              <div className="w-8 shrink-0 flex items-center justify-center text-[10px] font-mono text-muted-foreground border-r">
                {ri + 1}
              </div>

              {/* Criterion name + weight */}
              <div className="w-44 shrink-0 p-2 border-r space-y-1.5">
                <input
                  value={criterion.name}
                  onChange={(e) => onNameChange(ri, e.target.value)}
                  placeholder={`Criterion ${ri + 1}`}
                  className="w-full text-sm font-medium bg-transparent focus:outline-none placeholder:text-muted-foreground/40"
                  onClick={() => onFocus({ row: ri, col: focus.col })}
                />
                {/* Weight percentage mini-bar */}
                <div className="flex items-center gap-1.5">
                  <div
                    className="h-1 rounded-full"
                    style={{
                      width: `${pct}%`,
                      maxWidth: "100%",
                      minWidth: 4,
                      background: `${color}88`,
                    }}
                  />
                  <span className="text-[10px] font-mono" style={{ color }}>
                    {pct.toFixed(0)}%
                  </span>
                </div>
                {/* Weight input */}
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground font-mono">w=</span>
                  <input
                    type="number"
                    min="0.1"
                    max="10"
                    step="0.1"
                    value={criterion.weight}
                    onChange={(e) => onWeightDirect(ri, e.target.value)}
                    className="w-14 text-[11px] font-mono bg-transparent focus:outline-none border-0"
                    style={{ color }}
                  />
                  <span className="text-[10px]" style={{ color }}>×</span>
                </div>
              </div>

              {/* Level cells */}
              {criterion.levels.map((lvl, ci) => {
                const isFocused = ri === focus.row && ci === focus.col;
                const pts = lPts(max, ratioFromBandEdge(ci, bandEdges));
                return (
                  <div
                    key={ci}
                    onClick={() => onFocus({ row: ri, col: ci })}
                    className={cn(
                      "flex-1 min-w-[140px] p-2.5 border-r last:border-r-0 cursor-text transition-colors min-h-[72px]",
                      isFocused ? "bg-primary/5" : "hover:bg-muted/20"
                    )}
                    style={
                      isFocused
                        ? { outline: "1.5px solid hsl(var(--primary))", outlineOffset: -1 }
                        : {}
                    }
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {pts} pts
                      </span>
                      {isFocused && (
                        <span className="text-[9px] font-mono text-primary">EDITING</span>
                      )}
                    </div>
                    {lvl.description ? (
                      <div className="text-xs leading-relaxed text-foreground/80 line-clamp-3">
                        {lvl.description}
                      </div>
                    ) : (
                      <div className="space-y-1.5 opacity-25">
                        <div className="h-px bg-foreground rounded-full w-[85%]" />
                        <div className="h-px bg-foreground rounded-full w-[60%]" />
                        <div className="h-px bg-foreground rounded-full w-[72%]" />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Row controls */}
              <div className="w-20 shrink-0 flex items-center justify-center gap-0.5 border-l px-1">
                <button
                  type="button"
                  onClick={() => onMove(ri, -1)}
                  disabled={ri === 0}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(ri, 1)}
                  disabled={ri === criteria.length - 1}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(ri)}
                  className="p-1 text-destructive/50 hover:text-destructive transition-colors ml-0.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-4 px-3 py-2 bg-muted/30 border-t">
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add criterion
        </button>
        <div className="ml-auto text-[10px] font-mono text-muted-foreground">
          Max score: {TOTAL_PTS} pts · levels: {[0,1,2,3].map(i => `${100 - (bandEdges[i-1] ?? 0)}%`).join(' / ')}
        </div>
      </div>
    </div>
  );
}

// ─── Grade Preview ────────────────────────────────────────────────────────────

function GradePreview({
  criteria,
  totalWeight,
  bandEdges,
}: {
  criteria: Criterion[];
  totalWeight: number;
  bandEdges: BandEdges;
}) {
  // Sample scores: 0=best/A (left), 100=worst/C (right)
  const [scores, setScores] = useState<number[]>(() =>
    // Fixed sample so there's no SSR/hydration mismatch
    criteria.map((_, i) => [22, 36, 12, 29, 18, 8, 31][i] ?? 30)
  );
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [allOpen, setAllOpen] = useState(false);
  const [comment, setComment] = useState("");

  // Sync scores length when criteria change
  useEffect(() => {
    setScores((prev) => {
      if (prev.length === criteria.length) return prev;
      const next = [...prev];
      while (next.length < criteria.length) next.push(30);
      return next.slice(0, criteria.length);
    });
  }, [criteria.length]);

  // Weighted-average slider position → determines overall letter grade
  const weightedPct =
    totalWeight > 0
      ? criteria.reduce((s, c, i) => s + (scores[i] ?? 30) * c.weight, 0) / totalWeight
      : 30;

  const overall = getBand(weightedPct, bandEdges);

  // Total pts: sum of each criterion's band-level pts (not continuous slider value)
  const totalPts = criteria.reduce((sum, c, i) => {
    const s = scores[i] ?? 30;
    const bi = BANDS.findIndex((b) => b.letter === getBand(s, bandEdges).letter);
    const max = cMax(c.weight, totalWeight);
    return sum + lPts(max, ratioFromBandEdge(bi, bandEdges));
  }, 0);
  const overallScore4 = ((totalPts / TOTAL_PTS) * 4).toFixed(2);

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
            {Math.round(totalPts)} / {TOTAL_PTS} pts · {overall.label}
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
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Overall comment…"
          className="bg-muted/30 border rounded-md px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Criterion rows */}
      <div className="rounded-lg border overflow-hidden">
        {criteria.map((c, i) => {
          const score = scores[i] ?? 30;
          const band = getBand(score, bandEdges);
          const bandIdx = BANDS.findIndex((b) => b.letter === band.letter);
          const max = cMax(c.weight, totalWeight);
          // Points reflect the discrete level value for this band, not continuous position
          const pts = lPts(max, ratioFromBandEdge(bandIdx, bandEdges));
          const isOpen = expanded.has(i);
          const levelCount = c.levels.length;
          const activeLevel = Math.min(
            levelCount - 1,
            Math.floor((score / 100) * levelCount)
          );

          return (
            <div key={i} className={cn("border-b last:border-b-0", isOpen && "bg-muted/5")}>
              {/* Compact single row */}
              <div
                className="grid items-center gap-3 px-3 py-2.5"
                style={{ gridTemplateColumns: "24px 1fr 44px 1fr 80px 30px" }}
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
                  onChange={(v) =>
                    setScores((prev) => prev.map((s, j) => (j === i ? v : s)))
                  }
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

                {/* Note */}
                <button
                  type="button"
                  className="text-xs border rounded px-1 py-0.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  ✎
                </button>
              </div>

              {/* Expanded: level description columns */}
              {isOpen && (
                <div
                  className="grid gap-2 px-3 pb-3"
                  style={{
                    gridTemplateColumns: `repeat(${c.levels.length}, 1fr)`,
                    paddingLeft: 48,
                  }}
                >
                  {c.levels.map((lvl, j) => {
                    const isActive = j === activeLevel;
                    const levelScore = lPts(max, ratioFromBandEdge(j, bandEdges));
                    return (
                      <div
                        key={j}
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
                              ● closest
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground leading-relaxed">
                          {lvl.description ? (
                            lvl.description
                          ) : (
                            <span className="italic opacity-40">No description yet</span>
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
        ▸ click a criterion to see level descriptions · this is a preview — sliders are interactive
      </p>
    </div>
  );
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
    { from: 0,           to: bandEdges[0], color: BANDS[0].color },
    { from: bandEdges[0], to: bandEdges[1], color: BANDS[1].color },
    { from: bandEdges[1], to: bandEdges[2], color: BANDS[2].color },
    { from: bandEdges[2], to: 100,          color: BANDS[3].color },
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

      {/* Anchor tick marks at 0, 25, 50, 75, 100 */}
      {[0, 25, 50, 75, 100].map((t) => (
        <div
          key={t}
          className="absolute w-px bg-foreground/20"
          style={{ left: `${t}%`, top: 5, height: 16 }}
        />
      ))}

      {/* Invisible range input for interaction */}
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
