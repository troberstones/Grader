"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { HOUSE_LABELS } from "@/lib/rubric";
import type { DraftCriterion } from "./types";

interface Props {
  criteria: DraftCriterion[];
  onChange: (next: DraftCriterion[]) => void;
  /** Highlight empty/too-short required fields — set after a failed save attempt. */
  showErrors?: boolean;
}

/**
 * Display order only — best first, reading left to right. `levels` stays
 * stored lowest-to-highest (index 0 = "Little / No Effort" ... 3 =
 * "Professional / Mastery") everywhere else: validation, scoring, bandEdges,
 * the DB `level` column. This just decides which column each real index
 * renders in.
 */
const DISPLAY_ORDER = [3, 2, 1, 0] as const;

function emptyCriterion(): DraftCriterion {
  return { name: "", description: "", share: 1, levels: ["", "", "", ""] };
}

/** Mirrors the hard-error thresholds in src/lib/rubric/validate.ts. */
function levelInvalid(desc: string): boolean {
  const trimmed = desc.trim();
  return trimmed.length === 0 || trimmed.length < 10;
}

/**
 * Criteria × 4 fixed levels. No points anywhere — a criterion carries a
 * `share` (relative importance) and four level descriptions; points are
 * computed from share + the rubric's band calibration (BandCalibration)
 * against whatever assignment this rubric is attached to.
 */
export function CriteriaGrid({ criteria, onChange, showErrors }: Props) {
  function update(idx: number, patch: Partial<DraftCriterion>) {
    onChange(criteria.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function updateLevel(idx: number, levelIdx: number, text: string) {
    onChange(
      criteria.map((c, i) => {
        if (i !== idx) return c;
        const levels = [...c.levels] as DraftCriterion["levels"];
        levels[levelIdx] = text;
        return { ...c, levels };
      }),
    );
  }

  function add() {
    onChange([...criteria, emptyCriterion()]);
  }

  function remove(idx: number) {
    onChange(criteria.filter((_, i) => i !== idx));
  }

  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= criteria.length) return;
    const next = [...criteria];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {criteria.map((criterion, idx) => (
        <Card key={idx} className="overflow-hidden">
          <CardContent className="space-y-3 p-3">
            <div className="flex items-start gap-2">
              <div className="flex shrink-0 flex-col items-center gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-20"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(idx, 1)}
                  disabled={idx === criteria.length - 1}
                  className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-20"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>

              <div className="w-48 shrink-0 space-y-1.5">
                <Input
                  value={criterion.name}
                  onChange={(e) => update(idx, { name: e.target.value })}
                  placeholder="Criterion name"
                  className="text-sm font-medium"
                  aria-invalid={showErrors && !criterion.name.trim()}
                />
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Share</span>
                  <Input
                    type="number"
                    min="0.1"
                    step="0.5"
                    value={criterion.share}
                    onChange={(e) => update(idx, { share: parseFloat(e.target.value) || 1 })}
                    className="h-6 w-16 text-xs"
                    title="Relative importance — not a percentage, doesn't need to sum to anything"
                  />
                </div>
              </div>

              <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {DISPLAY_ORDER.map((levelIdx) => {
                  const desc = criterion.levels[levelIdx];
                  return (
                    <div key={levelIdx} className="space-y-1">
                      <span className="block truncate text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {HOUSE_LABELS[levelIdx]}
                      </span>
                      <Textarea
                        value={desc}
                        onChange={(e) => updateLevel(idx, levelIdx, e.target.value)}
                        placeholder={`What does "${HOUSE_LABELS[levelIdx]}" look like here?`}
                        className="min-h-[80px] resize-none text-xs"
                        rows={4}
                        aria-invalid={showErrors && levelInvalid(desc)}
                      />
                    </div>
                  );
                })}
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(idx)}
                className="h-8 w-8 shrink-0 text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <Button type="button" variant="outline" onClick={add}>
        <Plus className="mr-2 h-4 w-4" />
        Add Criterion
      </Button>
    </div>
  );
}
