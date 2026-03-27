"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
import { DEFAULT_RUBRIC_LEVELS } from "@/lib/constants";
import type { RubricJSON, RubricCriterion } from "@/types/rubric";

interface EditLevel {
  level: number;
  label: string;
  description: string;
  points: number;
}

interface EditCriterion {
  name: string;
  description: string;
  weight: number;
  levels: EditLevel[];
}

interface RubricEditorProps {
  initialData?: RubricJSON;
  onSave: (data: RubricJSON) => Promise<void>;
  saving?: boolean;
}

function makeDefaultCriterion(name = ""): EditCriterion {
  return {
    name,
    description: "",
    weight: 1.0,
    levels: DEFAULT_RUBRIC_LEVELS.map((l, i) => ({
      level: l.level,
      label: l.label,
      description: "",
      points: [25, 18, 10, 3][i],
    })).reverse(), // highest first in UI
  };
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

export function RubricEditor({ initialData, onSave, saving }: RubricEditorProps) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [criteria, setCriteria] = useState<EditCriterion[]>(() => {
    if (initialData?.criteria?.length) {
      return initialData.criteria.map((c) => ({
        name: c.name,
        description: c.description ?? "",
        weight: c.weight,
        levels: [...c.levels].sort((a, b) => b.level - a.level), // highest first
      }));
    }
    return DEFAULT_CRITERIA_NAMES.map((n) => makeDefaultCriterion(n));
  });

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

  function updateCriterion(idx: number, field: keyof EditCriterion, value: unknown) {
    setCriteria((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c))
    );
  }

  function updateLevel(criterionIdx: number, levelIdx: number, field: keyof EditLevel, value: string | number) {
    setCriteria((prev) =>
      prev.map((c, i) => {
        if (i !== criterionIdx) return c;
        const levels = c.levels.map((l, j) =>
          j === levelIdx ? { ...l, [field]: field === "points" ? Number(value) : value } : l
        );
        return { ...c, levels };
      })
    );
  }

  async function handleSave() {
    await onSave({
      name,
      description: description || undefined,
      criteria: criteria.map((c) => ({
        name: c.name,
        description: c.description || undefined,
        weight: c.weight,
        levels: [...c.levels].sort((a, b) => a.level - b.level), // normalize to ascending
      })),
    });
  }

  const levelHeaders = ["Professional / Mastery", "Good with Minor Flaws", "Lacking Key Aspects", "Little / No Effort"];

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

      {/* Rubric metadata (repeated below for context, hidden on md+) */}
      <div className="grid gap-4 md:grid-cols-2 md:hidden">
        <div className="space-y-2">
          <Label htmlFor="rubric-name">Rubric Name</Label>
          <Input
            id="rubric-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 3D Render Rubric"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rubric-desc">Description (optional)</Label>
          <Input
            id="rubric-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of this rubric"
          />
        </div>
      </div>

      {/* Instructions visible on md+ (sticky bar handles input there) */}
      <p className="hidden md:block text-xs text-muted-foreground -mt-2">
        Edit the rubric name and description in the bar above. Fill in descriptions and point values for each level below.
      </p>

      {/* Column headers */}
      <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 px-10 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        <span>Criterion</span>
        {levelHeaders.map((h) => (
          <span key={h} className="text-center">{h}</span>
        ))}
        <span />
      </div>

      {/* Criteria rows */}
      <div className="space-y-3">
        {criteria.map((criterion, idx) => (
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

                {/* Criterion name */}
                <div className="w-40 shrink-0 space-y-1">
                  <Input
                    value={criterion.name}
                    onChange={(e) => updateCriterion(idx, "name", e.target.value)}
                    placeholder="Criterion name"
                    className="text-sm font-medium"
                  />
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">Weight:</span>
                    <Input
                      type="number"
                      min="0.1"
                      max="10"
                      step="0.5"
                      value={criterion.weight}
                      onChange={(e) => updateCriterion(idx, "weight", parseFloat(e.target.value) || 1)}
                      className="h-6 text-xs w-16"
                    />
                  </div>
                </div>

                {/* Level cells */}
                <div className="flex-1 grid grid-cols-4 gap-2">
                  {criterion.levels.map((lvl, lvlIdx) => (
                    <div key={lvlIdx} className="space-y-1">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground hidden md:block truncate">{lvl.label}</span>
                        <Input
                          type="number"
                          min="0"
                          value={lvl.points}
                          onChange={(e) => updateLevel(idx, lvlIdx, "points", e.target.value)}
                          className="h-6 text-xs w-14 shrink-0 ml-auto"
                          title="Points"
                        />
                        <span className="text-xs text-muted-foreground">pts</span>
                      </div>
                      <Textarea
                        value={lvl.description}
                        onChange={(e) => updateLevel(idx, lvlIdx, "description", e.target.value)}
                        placeholder={`Describe ${lvl.label.toLowerCase()}...`}
                        className="text-xs resize-none min-h-[80px]"
                        rows={4}
                      />
                    </div>
                  ))}
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
        ))}
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
