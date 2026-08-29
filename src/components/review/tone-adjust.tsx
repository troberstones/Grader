"use client";

/**
 * Gamma / brightness / contrast adjustment for the media viewer.
 *
 * Purely a display aid — for judging work on projectors or poorly-calibrated
 * monitors where dark values crush and details become unreadable at default
 * levels. Never persisted; resets on reload.
 *
 * CSS has no native gamma filter, so gamma is approximated with a second
 * brightness() pass layered on top of the brightness/contrast filter chain.
 * This is applied live via a plain CSS `filter` on the <img>/<video>/<canvas>
 * element, so it works identically across the image viewer, the HTML5 video
 * player, and the canvas-based video player.
 */

import { useEffect, useRef, useState } from "react";
import { SunMedium } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ToneAdjust {
  brightness: number; // percent, 100 = neutral
  contrast: number; // percent, 100 = neutral
  gamma: number; // percent, 100 = neutral (approximated via a second brightness pass)
}

export const DEFAULT_TONE: ToneAdjust = { brightness: 100, contrast: 100, gamma: 100 };

export function isToneDefault(t: ToneAdjust): boolean {
  return (
    t.brightness === DEFAULT_TONE.brightness &&
    t.contrast === DEFAULT_TONE.contrast &&
    t.gamma === DEFAULT_TONE.gamma
  );
}

/** CSS `filter` value for the given adjustment, or "none" when neutral. */
export function toneCssFilter(t: ToneAdjust): string {
  if (isToneDefault(t)) return "none";
  return `brightness(${t.brightness}%) contrast(${t.contrast}%) brightness(${t.gamma}%)`;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}

function SliderRow({ label, value, min, max, onChange }: SliderRowProps) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="flex items-center justify-between text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{value}%</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </label>
  );
}

interface ToneAdjustPopoverProps {
  value: ToneAdjust;
  onChange: (t: ToneAdjust) => void;
}

/** Small toolbar button that opens a popover with brightness/contrast/gamma sliders. */
export function ToneAdjustPopover({ value, onChange }: ToneAdjustPopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onClickAway);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClickAway);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = !isToneDefault(value);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Adjust brightness / contrast / gamma"
        className={cn(
          "p-1.5 rounded transition-colors",
          active ? "text-primary bg-primary/10" : "hover:bg-muted",
        )}
      >
        <SunMedium className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-md border bg-popover text-popover-foreground shadow-md p-3 space-y-2.5">
          <SliderRow
            label="Brightness"
            value={value.brightness}
            min={40}
            max={200}
            onChange={(v) => onChange({ ...value, brightness: v })}
          />
          <SliderRow
            label="Contrast"
            value={value.contrast}
            min={40}
            max={200}
            onChange={(v) => onChange({ ...value, contrast: v })}
          />
          <SliderRow
            label="Gamma"
            value={value.gamma}
            min={40}
            max={200}
            onChange={(v) => onChange({ ...value, gamma: v })}
          />
          <button
            onClick={() => onChange(DEFAULT_TONE)}
            disabled={!active}
            className="w-full text-xs text-center py-1 rounded hover:bg-muted disabled:opacity-30 transition-colors text-muted-foreground"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
