"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LETTER_GRADES, lowerLetter, pointsForLetter } from "@/lib/rubric";
import { cn, formatScore } from "@/lib/utils";

const LATE_DAYS = [1, 2, 3];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the rubric alone gives this student, or null if nothing is scored yet. */
  rubricLetter: string | null;
  pointsPossible: number;
  /** The override as it stands, to edit; null when there is none. */
  current: { letter: string; reason: string | null } | null;
  saving: boolean;
  /** `letter: null` removes the override. Resolves false if it did not save. */
  onSubmit: (letter: string | null, reason: string | null) => Promise<boolean>;
}

/**
 * Set a student's letter grade outright, with an optional reason.
 *
 * The letter is always the professor's to pick. The late shortcuts only fill
 * the form in — a letter grade a day off whatever the rubric gave — and can be
 * changed before saving like anything else.
 *
 * Mount it only while open (the panel does), so each opening starts from the
 * student's current override rather than the last thing typed.
 */
export function GradeOverrideDialog({ open, onOpenChange, rubricLetter, pointsPossible, current, saving, onSubmit }: Props) {
  const [letter, setLetter] = useState<string | null>(current?.letter ?? null);
  const [reason, setReason] = useState(current?.reason ?? "");

  function applyLate(days: number) {
    setReason(`Late ${days} day${days === 1 ? "" : "s"}`);
    if (rubricLetter) setLetter(lowerLetter(rubricLetter, days));
  }

  async function submit(nextLetter: string | null) {
    if (await onSubmit(nextLetter, nextLetter ? reason.trim() || null : null)) onOpenChange(false);
  }

  const points = letter ? pointsForLetter(letter, pointsPossible) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override grade</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {rubricLetter ? `The rubric gives this student ${rubricLetter}. ` : "The rubric is not scored yet. "}
            The letter you set here is the grade; the rubric selections are kept.
          </p>

          <div className="space-y-1.5">
            <div className="text-sm font-medium">Letter grade</div>
            <div className="flex flex-wrap gap-1">
              {LETTER_GRADES.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLetter(l)}
                  aria-pressed={letter === l}
                  className={cn(
                    "h-8 w-9 rounded-md border text-sm font-medium transition-colors",
                    letter === l ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
            {points != null && (
              <p className="text-xs text-muted-foreground tabular-nums">
                Recorded as {formatScore(points)} / {pointsPossible}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="override-reason" className="text-sm font-medium">
              Reason (optional)
            </label>
            <div className="flex flex-wrap gap-1">
              {LATE_DAYS.map((days) => (
                <Button key={days} type="button" variant="outline" size="sm" className="text-xs" onClick={() => applyLate(days)}>
                  Late {days} day{days === 1 ? "" : "s"}
                </Button>
              ))}
              <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => setReason("Incomplete")}>
                Incomplete
              </Button>
            </div>
            <Input
              id="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Shown to the student beside the grade"
              maxLength={200}
            />
          </div>
        </div>

        <DialogFooter>
          {current && (
            <Button variant="ghost" className="sm:mr-auto" disabled={saving} onClick={() => submit(null)}>
              Remove override
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving || !letter} onClick={() => submit(letter)}>
            Set grade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
