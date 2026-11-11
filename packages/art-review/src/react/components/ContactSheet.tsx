"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReviewItem } from "../../core/types";
import { C, textButton } from "../styles";

const GAP = 8;
const LABEL_H = 18;

/** Best still to show for an item, or null when there is nothing to draw. */
function previewUrl(item: ReviewItem): string | null {
  return item.posterUrl ?? item.frameUrls?.[0] ?? (item.kind === "still" ? item.url : null);
}

/**
 * Every piece in the playlist on one page. The grid takes whichever column
 * count gives the biggest tile that still fits, so a few pieces fill the page
 * and many shrink evenly instead of scrolling. Click a tile to open it.
 */
export function ContactSheet({
  items,
  current,
  onOpen,
  onClose,
}: {
  items: ReviewItem[];
  current: number;
  onOpen: (index: number) => void;
  onClose: () => void;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Tiles are a uniform box; the image sits inside it with object-fit: contain.
  // Pick the column count that makes that box's image area largest, weighing
  // each piece's real aspect ratio so tall and wide work both get their due.
  let cols = 1;
  if (size.w > 0 && size.h > 0 && items.length > 0) {
    let best = -1;
    for (let c = 1; c <= items.length; c++) {
      const rows = Math.ceil(items.length / c);
      const cw = (size.w - GAP * (c - 1)) / c;
      const ch = (size.h - GAP * (rows - 1)) / rows - LABEL_H;
      if (cw <= 0 || ch <= 0) continue;
      let area = 0;
      for (const it of items) {
        const ar = it.width > 0 && it.height > 0 ? it.width / it.height : 1;
        const w = Math.min(cw, ch * ar);
        area += w * (w / ar);
      }
      if (area > best) {
        best = area;
        cols = c;
      }
    }
  }
  const rows = Math.ceil(items.length / cols);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: C.bg,
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        padding: 12,
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>
          Contact sheet · {items.length} {items.length === 1 ? "piece" : "pieces"}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={textButton()} title="Back to the viewer  Esc">
          Close
        </button>
      </div>
      <div
        ref={areaRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          gap: GAP,
        }}
      >
        {items.map((item, i) => {
          const src = previewUrl(item);
          return (
            <button
              key={item.id}
              onClick={() => onOpen(i)}
              title={item.label}
              style={{
                all: "unset",
                boxSizing: "border-box",
                cursor: "pointer",
                minWidth: 0,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                outline: i === current ? `2px solid ${C.primary}` : "none",
                outlineOffset: 2,
                borderRadius: 4,
              }}
            >
              <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                {src && !item.unavailable ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={src}
                    alt={item.label}
                    draggable={false}
                    style={{ width: "100%", height: "100%", objectFit: "contain", minHeight: 0 }}
                  />
                ) : (
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: C.faint,
                      fontSize: 12,
                      background: C.container,
                    }}
                  >
                    {item.unavailable ? "Unavailable" : item.kind.toUpperCase()}
                  </div>
                )}
              </div>
              <span
                style={{
                  height: LABEL_H - 2,
                  fontSize: 11,
                  lineHeight: `${LABEL_H - 2}px`,
                  color: C.faint,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  textAlign: "center",
                }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
