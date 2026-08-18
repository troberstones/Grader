"use client";

import {
  BAND_PRESETS,
  DEFAULT_LETTER_SCALE,
  HOUSE_LABELS,
  bandTable,
  letterFor,
  previewOutcomes,
} from "@/lib/rubric";
import type { BandEdges } from "@/lib/rubric";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  bandEdges: BandEdges;
  onChange: (edges: BandEdges) => void;
  criteriaCount: number;
}

/**
 * `DEFAULT_LETTER_SCALE` plus a synthetic "F" entry, so every achievable
 * fraction (including a level deliberately calibrated low) always has a
 * matching, selectable letter — never a blank dropdown.
 */
const LETTER_OPTIONS: Array<readonly [letter: string, floor: number]> = [
  ...DEFAULT_LETTER_SCALE.map(([floor, letter]) => [letter, floor] as const),
  ["F", 50] as const,
];

/**
 * Band calibration: pick the letter grade each level deserves, never a raw
 * decimal — typing "0.72" directly is exactly how the old bands drifted out
 * of sync with what the labels promised without anyone noticing. The table
 * and preview below render the consequence live, before anyone is graded.
 */
export function BandCalibration({ bandEdges, onChange, criteriaCount }: Props) {
  function setLevelLetter(levelIdx: 0 | 1 | 2, letter: string) {
    const floor = LETTER_OPTIONS.find(([l]) => l === letter)?.[1] ?? 50;
    const next = [...bandEdges] as BandEdges;
    next[levelIdx] = floor / 100;
    onChange(next);
  }

  const table = bandTable(bandEdges);
  const preview = previewOutcomes(bandEdges, criteriaCount);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Grade bands</span>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(BAND_PRESETS.advanced)}>
          Advanced (55/74/88)
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(BAND_PRESETS.foundation)}>
          Foundation (60/80/92)
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        For each level, pick the letter grade that quality of work deserves. Advanced: mastery is genuinely
        reachable, so a B+ is the honest ceiling for good-but-flawed work. Foundation: mastery means professional
        and almost nobody reaches it, so good-but-flawed work needs to be worth an A-.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([0, 1, 2, 3] as const).map((level) => (
          <div key={level} className="space-y-1">
            <Label className="text-xs">{HOUSE_LABELS[level]}</Label>
            {level === 3 ? (
              <div className="flex h-8 items-center rounded-lg border bg-muted/40 px-2.5 text-sm text-muted-foreground">
                100% (always)
              </div>
            ) : (
              <Select value={letterFor(bandEdges[level] * 100)} onValueChange={(v) => v && setLevelLetter(level, v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LETTER_OPTIONS.map(([letter, floor]) => (
                    <SelectItem key={letter} value={letter}>
                      {letter} ({floor}%+)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="p-2 text-left">Level</th>
              <th className="p-2 text-right">Nudge down</th>
              <th className="p-2 text-right">Base</th>
              <th className="p-2 text-right">Nudge up</th>
            </tr>
          </thead>
          <tbody>
            {table.map((row) => (
              <tr key={row.level} className="border-b last:border-0">
                <td className="p-2">{HOUSE_LABELS[row.level]}</td>
                <td className="p-2 text-right tabular-nums text-muted-foreground">{row.minus}%</td>
                <td className="p-2 text-right font-medium tabular-nums">{row.base}%</td>
                <td className="p-2 text-right tabular-nums text-muted-foreground">{row.plus}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          What these bands produce, before anyone is graded:
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="p-2 text-left">Mix of scores</th>
                <th className="p-2 text-right">Result</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => (
                <tr key={row.label} className="border-b last:border-0">
                  <td className="p-2">{row.label}</td>
                  <td className="p-2 text-right tabular-nums">
                    {row.percent}% ({row.letter})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
