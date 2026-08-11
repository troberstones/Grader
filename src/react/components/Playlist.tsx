"use client";

import type { ReviewItem } from "../../core/types";
import { badge, C, label } from "../styles";

interface PlaylistProps {
  items: ReviewItem[];
  index: number;
  disabled?: boolean;
  onSelect: (i: number) => void;
}

const KIND_LABEL: Record<ReviewItem["kind"], string> = {
  still: "IMG",
  pages: "PDF",
  video: "VID",
  sequence: "SEQ",
  layered: "PSD",
};

/** Flip between the files under review — any mix of types. */
export function Playlist({ items, index, disabled, onSelect }: PlaylistProps) {
  if (items.length <= 1) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, overflowX: "auto", padding: "2px 0" }}>
      <span style={{ ...label, flexShrink: 0 }}>Files</span>
      {items.map((it, i) => (
        <button
          key={it.id}
          onClick={() => !disabled && onSelect(i)}
          title={`${it.label} · ${it.width}×${it.height}${it.frameCount > 1 ? ` · ${it.frameCount} frames` : ""}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 9px",
            borderRadius: 6,
            border: "none",
            background: i === index ? C.high : "transparent",
            color: i === index ? C.text : C.muted,
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.5 : 1,
            fontSize: 12,
            maxWidth: 220,
            flexShrink: 0,
          }}
        >
          <span style={badge(i === index ? C.primary : "rgba(255,255,255,0.08)", i === index ? "#000" : C.muted)}>
            {KIND_LABEL[it.kind]}
          </span>
          <span
            style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {it.label}
          </span>
        </button>
      ))}
    </div>
  );
}
