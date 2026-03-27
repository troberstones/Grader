"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MousePointer2,
  Pencil,
  Square,
  Circle,
  Type,
  MoveRight,
  Undo2,
  Trash2,
  Save,
} from "lucide-react";

export type AnnotationTool = "select" | "pen" | "rect" | "circle" | "arrow" | "text";

const TOOLS: { id: AnnotationTool; icon: React.ReactNode; label: string }[] = [
  { id: "select",  icon: <MousePointer2 className="h-4 w-4" />, label: "Select / Move" },
  { id: "pen",     icon: <Pencil className="h-4 w-4" />,         label: "Freehand Pen" },
  { id: "arrow",   icon: <MoveRight className="h-4 w-4" />,      label: "Arrow" },
  { id: "rect",    icon: <Square className="h-4 w-4" />,         label: "Rectangle" },
  { id: "circle",  icon: <Circle className="h-4 w-4" />,         label: "Circle" },
  { id: "text",    icon: <Type className="h-4 w-4" />,           label: "Text" },
];

const COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#3b82f6", // blue
  "#a855f7", // purple
  "#ffffff", // white
  "#000000", // black
];

const STROKE_WIDTHS = [2, 4, 8];

interface AnnotationToolbarProps {
  tool: AnnotationTool;
  color: string;
  strokeWidth: number;
  isDirty: boolean;
  saving: boolean;
  onToolChange: (t: AnnotationTool) => void;
  onColorChange: (c: string) => void;
  onStrokeWidthChange: (w: number) => void;
  onUndo: () => void;
  onClear: () => void;
  onSave: () => void;
}

export function AnnotationToolbar({
  tool,
  color,
  strokeWidth,
  isDirty,
  saving,
  onToolChange,
  onColorChange,
  onStrokeWidthChange,
  onUndo,
  onClear,
  onSave,
}: AnnotationToolbarProps) {
  return (
    <div className="w-14 shrink-0 border-l flex flex-col items-center py-3 gap-1 bg-background">
      {/* Tools */}
      {TOOLS.map((t) => (
        <button
          key={t.id}
          title={t.label}
          onClick={() => onToolChange(t.id)}
          className={cn(
            "w-9 h-9 flex items-center justify-center rounded transition-colors",
            tool === t.id
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted text-muted-foreground hover:text-foreground"
          )}
        >
          {t.icon}
        </button>
      ))}

      <div className="w-8 h-px bg-border my-1" />

      {/* Colors */}
      <div className="flex flex-col gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            title={c}
            onClick={() => onColorChange(c)}
            className={cn(
              "w-6 h-6 rounded-full border-2 transition-transform",
              color === c ? "border-primary scale-125" : "border-transparent hover:scale-110"
            )}
            style={{ backgroundColor: c, boxShadow: c === "#ffffff" ? "inset 0 0 0 1px #ccc" : undefined }}
          />
        ))}
      </div>

      <div className="w-8 h-px bg-border my-1" />

      {/* Stroke widths */}
      {STROKE_WIDTHS.map((w) => (
        <button
          key={w}
          title={`${w}px`}
          onClick={() => onStrokeWidthChange(w)}
          className={cn(
            "w-9 h-6 flex items-center justify-center rounded transition-colors",
            strokeWidth === w ? "bg-primary/20" : "hover:bg-muted"
          )}
        >
          <div
            className="rounded-full bg-foreground"
            style={{ width: Math.min(28, w * 4), height: w }}
          />
        </button>
      ))}

      <div className="w-8 h-px bg-border my-1" />

      {/* Actions */}
      <button
        title="Undo"
        onClick={onUndo}
        className="w-9 h-9 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      >
        <Undo2 className="h-4 w-4" />
      </button>

      <button
        title="Clear all"
        onClick={onClear}
        className="w-9 h-9 flex items-center justify-center rounded hover:bg-muted text-destructive hover:text-destructive transition-colors"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <div className="flex-1" />

      {/* Save */}
      <button
        title={saving ? "Saving…" : isDirty ? "Save annotations" : "Up to date"}
        onClick={onSave}
        disabled={saving}
        className={cn(
          "w-9 h-9 flex items-center justify-center rounded transition-colors",
          isDirty
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "text-muted-foreground hover:bg-muted"
        )}
      >
        <Save className="h-4 w-4" />
      </button>
    </div>
  );
}
