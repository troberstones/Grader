"use client";

import { cn } from "@/lib/utils";

interface RubricCellProps {
  label: string;
  description: string;
  points: number;
  selected?: boolean;
  interactive?: boolean;
  onClick?: () => void;
}

export function RubricCell({ label, description, points, selected, interactive, onClick }: RubricCellProps) {
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") onClick?.(); } : undefined}
      className={cn(
        "p-3 rounded-md border text-sm transition-all",
        interactive && "cursor-pointer select-none",
        selected
          ? "bg-primary text-primary-foreground border-primary shadow-sm"
          : interactive
          ? "border-border hover:border-primary/50 hover:bg-accent"
          : "border-border bg-card"
      )}
    >
      <div className={cn("font-semibold text-xs mb-1 uppercase tracking-wide", selected ? "text-primary-foreground/80" : "text-muted-foreground")}>
        {label}
      </div>
      <div className="leading-snug mb-2">{description || <span className="italic opacity-50">No description</span>}</div>
      <div className={cn("text-xs font-bold", selected ? "text-primary-foreground" : "text-primary")}>
        {points} pts
      </div>
    </div>
  );
}
