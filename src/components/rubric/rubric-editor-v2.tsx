"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
import { DEFAULT_RUBRIC_LEVELS } from "@/lib/constants";
import type { RubricJSON } from "@/types/rubric";

/**
 * RubricEditorV2 — weight-normalized, 100-point basis.
 *
 * Each criterion has a relative weight. Points for every level are derived
 * automatically:
 *   criterionMax = (weight / totalWeight) × 100
 *   levelPoints  = criterionMax × (ratio / 100)
 *
 * "ratio" is the percentage of criterionMax that a level earns (0–100).
 * Defaults: 100 / 72 / 40 / 12 (matching the V1 25 / 18 / 10 / 3 proportions).
 *
 * The saved RubricJSON is identical in shape to V1 — computed points are
 * stored in each level so the grading system requires no changes.
 */

const TOTAL_POINTS = 100;
const DEFAULT_RATIOS = [100, 72, 40, 12]; // highest → lowest, % of criterion max

interface EditLevelV2 {
  level: number;
  label: string;
  description: string;
  ratio: number; // 0–100
}

interface EditCriterionV2 {
  name: string;
  description: string;
  weight: number;
  levels: EditLevelV2[]; // sorted highest-level first
}

interface RubricEditorV2Props {
  initialData?: RubricJSON;
  onSave: (data: RubricJSON) => Promise<void>;
  saving?: boolean;
}

const DEFAULT_CRITERIA_NAMES = [
  "Visual Representation",
  "Material Quality",
  "Lighting",
  "Composition",
  "Technical Execution",
  "Effort & Complexity",
  "Overall Presentation",
];

function makeDefaultCriterion(name = ""): EditCriterionV2 {
  return {
    name,
    description: "",
    weight: 1.0,
    levels: [...DEFAULT_RUBRIC_LEVELS]
      .sort((a, b) => b.level - a.level)
      .map((l, i) => ({
        level: l.level,
        label: l.label,
        description: "",
        ratio: DEFAULT_RATIOS[i],
      })),
  };
}

function calcCriterionMax(weight: number, totalWeight: number): number {
  if (totalWeight === 0) return 0;
  return (weight / totalWeight) * TOTAL_POINTS;
}

function calcLevelPts(criterionMax: number, ratio: number): number {
  // Round to one decimal place
  return Math.round((criterionMax * ratio) / 100 * 10) / 10;
}

export function RubricEditorV2({ initialData, onSave, saving }: RubricEditorV2Props) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");

  const [criteria, setCriteria] = useState<EditCriterionV2[]>(() => {
    if (initialData?.criteria?.length) {
      return initialData.criteria.map((c) => {
        const sorted = [...c.levels].sort((a, b) => b.level - a.level);
        const maxPts = Math.max(...c.levels.map((l) => l.points));
        return {
          name: c.name,
          description: c.description ?? "",
          weight: c.weight,
          levels: sorted.map((l) => ({
            level: l.level,
            label: l.label,
            description: l.description,
            ratio: maxPts > 0 ? Math.round((l.points / maxPts) * 100) : 100,
          })),
        };
      });
    }
    return DEFAULT_CRITERIA_NAMES.map((n) => makeDefaultCriterion(n));
  });

  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);

  function addCriterion() {
    setCriteria((prev) => [...prev, makeDefaultCriterion()]);
  }

  function removeCriterion(idx: number) {
    setCriteria((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveCriterion(idx: number, dir: -1 | 1) {
    setCriteria((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function updateWeight(idx: number, raw: string) {
    const val = parseFloat(raw);
    if (!isFinite(val) || val <= 0) return;
    setCriteria((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, weight: val } : c))
    );
  }

  function updateName(idx: number, value: string) {
    setCriteria((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, name: value } : c))
    );
  }

  function updateLevelRatio(criterionIdx: number, levelIdx: number, raw: string) {
    const val = Math.min(100, Math.max(0, Number(raw)));
    setCriteria((prev) =>
      prev.map((c, i) => {
        if (i !== criterionIdx) return c;
        return {
          ...c,
          levels: c.levels.map((l, j) =>
            j === levelIdx ? { ...l, ratio: isFinite(val) ? val : l.ratio } : l
          ),
        };
      })
    );
  }

  function updateLevelDescription(criterionIdx: number, levelIdx: number, value: string) {
    setCriteria((prev) =>
      prev.map((c, i) => {
        if (i !== criterionIdx) return c;
        return {
          ...c,
          levels: c.levels.map((l, j) =>
            j === levelIdx ? { ...l, description: value } : l
          ),
        };
      })
    );
  }

  async function handleSave() {
    await onSave({
      name,
      description: description || undefined,
      criteria: criteria.map((c) => {
        const maxPts = calcCriterionMax(c.weight, totalWeight);
        return {
          name: c.name,
          description: c.description || undefined,
          weight: c.weight,
          levels: [...c.levels]
            .sort((a, b) => a.level - b.level)
            .map((l) => ({
              level: l.level,
              label: l.label,
              description: l.description,
              points: calcLevelPts(maxPts, l.ratio),
            })),
        };
      }),
    });
  }

  const levelHeaders = [
    "Professional / Mastery",
    "Good with Minor Flaws",
    "Lacking Key Aspects",
    "Little / No Effort",
  ];

  return (
    <div className="space-y-6 pb-24">
      {/* Sticky save bar */}
      <div className="sticky top-0 z-10 -mx-6 -mt-6 px-6 py-3 bg-background/95 backdrop-blur border-b flex items-center justify-between gap-4">
        <div className="grid gap-3 md:grid-cols-2 flex-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rubric name (required)"
            className="font-semibold"
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
          />
        </div>
        <Button onClick={handleSave} disabled={!name || saving} className="shrink-0">
          {saving ? "Saving..." : "Save Rubric"}
        </Button>
      </div>

      {/* Info bar */}
      <div className="flex items-center justify-between -mt-2 text-xs text-muted-foreground">
        <p>
          Points are auto-calculated from a 100-pt basis. Increase a criterion&apos;s weight to give it more
          importance — the others adjust automatically. Level % controls how much of the criterion max each level earns.
        </p>
        <span className="shrink-0 ml-4 font-semibold text-foreground">100 pts basis</span>
      </div>

      {/* Column headers */}
      <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 px-10 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        <span>Criterion</span>
        {levelHeaders.map((h) => (
          <span key={h} className="text-center">
            {h}
          </span>
        ))}
        <span />
      </div>

      {/* Criteria rows */}
      <div className="space-y-3">
        {criteria.map((criterion, idx) => {
          const maxPts = calcCriterionMax(criterion.weight, totalWeight);
          const pct = totalWeight > 0 ? (criterion.weight / totalWeight) * 100 : 0;

          return (
            <Card key={idx} className="overflow-hidden">
              <CardContent className="p-3">
                <div className="flex items-start gap-2">
                  {/* Reorder controls */}
                  <div className="flex flex-col items-center gap-1 pt-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveCriterion(idx, -1)}
                      disabled={idx === 0}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <GripVertical className="h-4 w-4 text-muted-foreground/40" />
                    <button
                      type="button"
                      onClick={() => moveCriterion(idx, 1)}
                      disabled={idx === criteria.length - 1}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Criterion name + weight */}
                  <div className="w-40 shrink-0 space-y-1">
                    <Input
                      value={criterion.name}
                      onChange={(e) => updateName(idx, e.target.value)}
                      placeholder="Criterion name"
                      className="text-sm font-medium"
                    />
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">Weight:</span>
                        <Input
                          type="number"
                          min="0.1"
                          max="10"
                          step="0.5"
                          value={criterion.weight}
                          onChange={(e) => updateWeight(idx, e.target.value)}
                          className="h-6 text-xs w-14"
                        />
                      </div>
                      <div className="text-xs text-primary font-medium leading-tight">
                        {pct.toFixed(1)}% &middot; {maxPts.toFixed(1)} pts
                      </div>
                    </div>
                  </div>

                  {/* Level cells */}
                  <div className="flex-1 grid grid-cols-4 gap-2">
                    {criterion.levels.map((lvl, lvlIdx) => {
                      const computedPts = calcLevelPts(maxPts, lvl.ratio);
                      return (
                        <div key={lvlIdx} className="space-y-1">
                          {/* Ratio input + computed pts */}
                          <div className="flex items-center gap-0.5">
                            <span className="text-xs text-muted-foreground hidden md:block truncate flex-1">
                              {lvl.label}
                            </span>
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              value={lvl.ratio}
                              onChange={(e) => updateLevelRatio(idx, lvlIdx, e.target.value)}
                              className="h-6 text-xs w-12 shrink-0 ml-auto"
                              title="Percentage of criterion max"
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                          <div className="text-xs font-medium text-primary/80 text-right pr-1">
                            = {computedPts} pts
                          </div>
                          <Textarea
                            value={lvl.description}
                            onChange={(e) => updateLevelDescription(idx, lvlIdx, e.target.value)}
                            placeholder={`Describe ${lvl.label.toLowerCase()}...`}
                            className="text-xs resize-none min-h-[80px]"
                            rows={4}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* Delete */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeCriterion(idx)}
                    className="shrink-0 text-destructive h-8 w-8"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={addCriterion}>
          <Plus className="mr-2 h-4 w-4" />
          Add Criterion
        </Button>
        <Button onClick={handleSave} disabled={!name || saving}>
          {saving ? "Saving..." : "Save Rubric"}
        </Button>
      </div>
    </div>
  );
}
