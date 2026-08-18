"use client";

import { useRef } from "react";
import type { ReviewItem } from "../../core/types";
import { iconButton, select as selectStyle, textButton } from "../styles";

interface PlaylistProps {
  items: ReviewItem[];
  index: number;
  disabled?: boolean;
  onSelect: (i: number) => void;
  /** Omit to hide the "+ Add" control and its file picker. */
  onAdd?: (files: File[]) => void;
  /** Omit to hide the "✕" control. */
  onRemove?: (itemId: string) => void;
  /** An add/remove is in flight — disables everything so a second click can't race it. */
  busy?: boolean;
}

const KIND_LABEL: Record<ReviewItem["kind"], string> = {
  still: "IMG",
  pages: "PDF",
  video: "VID",
  sequence: "SEQ",
  layered: "PSD",
};

/** Compact file switcher: dropdown + prev/next, plus optional add/remove. */
export function Playlist({ items, index, disabled, onSelect, onAdd, onRemove, busy }: PlaylistProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const current = items[index];
  const dim = disabled || busy;

  if (items.length <= 1 && !onAdd && !onRemove) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
      {items.length > 1 && (
        <>
          <button
            onClick={() => onSelect(Math.max(0, index - 1))}
            disabled={dim || index === 0}
            style={iconButton(false, dim || index === 0)}
            title="Previous file  PageUp"
          >
            ‹
          </button>
          <select
            value={index}
            disabled={dim}
            onChange={(e) => onSelect(Number(e.target.value))}
            style={{ ...selectStyle, maxWidth: 200 }}
            title="Switch file"
          >
            {items.map((it, i) => (
              <option key={it.id} value={i}>
                {KIND_LABEL[it.kind]} · {it.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => onSelect(Math.min(items.length - 1, index + 1))}
            disabled={dim || index === items.length - 1}
            style={iconButton(false, dim || index === items.length - 1)}
            title="Next file  PageDown"
          >
            ›
          </button>
        </>
      )}

      {onRemove && current && (
        <button
          onClick={() => {
            if (window.confirm(`Remove ${current.label}? This can't be undone.`)) onRemove(current.id);
          }}
          disabled={dim}
          style={iconButton(false, dim)}
          title={`Remove ${current.label}`}
        >
          ✕
        </button>
      )}

      {onAdd && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length > 0) onAdd(files);
            }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={dim}
            style={{ ...textButton(), flexShrink: 0, opacity: dim ? 0.5 : 1 }}
            title="Add more artwork for this student"
          >
            {busy ? "Adding…" : "+ Add"}
          </button>
        </>
      )}
    </div>
  );
}
