"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CacheStats } from "../../sources/types";
import type { FrameMarker } from "../../core/types";
import { C } from "../styles";

interface TimelineProps {
  frame: number;
  frameCount: number;
  fps: number;
  markers: FrameMarker[];
  stats: CacheStats | null;
  disabled?: boolean;
  onScrub: (frame: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}

/**
 * Scrub bar with annotation ticks and cache-fill state.
 *
 * The hold bars matter as much as the ticks: an annotation pinned to one frame
 * is invisible during playback, so the timeline shows how long each note stays
 * on screen, not just where it starts.
 */
export function Timeline({
  frame,
  frameCount,
  fps,
  markers,
  stats,
  disabled,
  onScrub,
  onScrubStart,
  onScrubEnd,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const frameAt = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
      return Math.round(t * (frameCount - 1));
    },
    [frameCount],
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => onScrub(frameAt(e.clientX));
    const up = () => {
      setDragging(false);
      onScrubEnd?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, frameAt, onScrub, onScrubEnd]);

  const pct = (f: number) => (frameCount <= 1 ? 0 : (f / (frameCount - 1)) * 100);
  const single = frameCount <= 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          if (disabled || single) return;
          e.preventDefault();
          setDragging(true);
          onScrubStart?.();
          onScrub(frameAt(e.clientX));
        }}
        onPointerMove={(e) => !single && setHover(frameAt(e.clientX))}
        onPointerLeave={() => setHover(null)}
        style={{
          position: "relative",
          height: 34,
          background: C.lowest,
          borderRadius: 6,
          cursor: disabled || single ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
          overflow: "hidden",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        {/* cache fill */}
        {stats?.ranges.map(([a, b], i) => (
          <div
            key={`c${i}`}
            style={{
              position: "absolute",
              left: `${pct(a)}%`,
              width: `${Math.max(0.4, pct(b) - pct(a))}%`,
              top: 0,
              bottom: 0,
              background: "rgba(255,255,255,0.055)",
            }}
          />
        ))}

        {/* annotation hold ranges */}
        {markers.map((m, i) => (
          <div
            key={`h${i}`}
            style={{
              position: "absolute",
              left: `${pct(m.frameIn)}%`,
              width: `${Math.max(0.35, pct(m.frameOut) - pct(m.frameIn))}%`,
              top: 6,
              height: 8,
              background: "rgba(255,144,105,0.28)",
              borderRadius: 2,
            }}
          />
        ))}

        {/* annotation ticks */}
        {markers.map((m, i) => (
          <div
            key={`m${i}`}
            title={`${m.count} annotation${m.count === 1 ? "" : "s"} at frame ${m.frameIn}`}
            style={{
              position: "absolute",
              left: `calc(${pct(m.frameIn)}% - 1px)`,
              top: 3,
              width: 2.5,
              height: 14,
              background: C.primary,
              borderRadius: 1,
            }}
          />
        ))}

        {/* hover readout */}
        {hover !== null && !single && (
          <div
            style={{
              position: "absolute",
              left: `${pct(hover)}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background: "rgba(255,255,255,0.25)",
            }}
          />
        )}

        {/* playhead */}
        <div
          style={{
            position: "absolute",
            left: `calc(${pct(frame)}% - 1px)`,
            top: 0,
            bottom: 0,
            width: 2,
            background: C.text,
            boxShadow: "0 0 6px rgba(0,0,0,0.8)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `calc(${pct(frame)}% - 5px)`,
            bottom: 2,
            width: 10,
            height: 10,
            borderRadius: 2,
            background: C.text,
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: C.muted,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>
          {single ? "single frame" : `frame ${frame} / ${frameCount - 1}`}
          {!single && fps > 0 && (
            <span style={{ color: C.faint }}> · {timecode(frame, fps)}</span>
          )}
        </span>
        <span style={{ color: C.faint }}>
          {stats && stats.total > 1 && stats.mode !== "n/a" && (
            <>
              {stats.mode === "full" && stats.cached >= stats.total
                ? "cached"
                : stats.mode === "stream"
                  ? "streaming"
                  : `caching ${stats.cached}/${stats.total}`}
              {stats.bytes > 0 && ` · ${(stats.bytes / 1024 / 1024).toFixed(0)} MB`}
              {stats.decoding && " · decoding"}
            </>
          )}
          {stats?.error && <span style={{ color: C.danger }}> · {stats.error}</span>}
        </span>
      </div>
    </div>
  );
}

function timecode(frame: number, fps: number): string {
  const total = frame / fps;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const f = Math.round(frame % fps);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}
