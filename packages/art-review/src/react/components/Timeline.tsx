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
 * Ticks mark the frames carrying notes. A note lives on exactly one frame, so
 * a tick is a point, not a span — during playback they flash past, which is
 * what `[` / `]` and "Stop on notes" are for.
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

  /**
   * A run of frames as a track span.
   *
   * Frames are points on the scale — frame 0 sits at 0% and the last at 100%,
   * so the playhead lands on them exactly — but a cached frame is a cell, not a
   * point. Without the half-cell overhang a single cached frame has zero width,
   * and a fully cached clip stops short of both ends and reads as a gap.
   */
  const span = (a: number, b: number) => {
    const half = frameCount <= 1 ? 50 : 50 / (frameCount - 1);
    const left = Math.max(0, pct(a) - half);
    const right = Math.min(100, pct(b) + half);
    return { left: `${left}%`, width: `${Math.max(0, right - left)}%` };
  };

  /** Nuke puts its cache line along the bottom of the timeline; so does this. */
  const BAND = 5;

  /**
   * Is the playhead standing on a frame that is actually resident?
   *
   * Read from the same ranges the band draws from, deliberately rather than
   * from the renderer's own hit/miss. Those update on a 400 ms tick, so a face
   * driven by the live result would disagree with the bar directly beneath it
   * for a third of a second at a time — and a marker that contradicts the thing
   * next to it reads as broken rather than as information.
   *
   * Only for sources that keep a frame cache at all: a streamed <video> has no
   * ranges to be outside of, and a single still is never a miss.
   */
  const tracked = !single && !!stats && (stats.mode === "full" || stats.mode === "window");
  const miss = tracked && !stats!.ranges.some(([a, b]) => frame >= a && frame <= b);

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
        {/* Cached region, as a wash over the full height. Faint on purpose:
            this is context while scrubbing, and the band below is the part
            meant to be read precisely. */}
        {stats?.ranges.map(([a, b], i) => (
          <div
            key={`c${i}`}
            style={{
              position: "absolute",
              ...span(a, b),
              top: 0,
              bottom: 0,
              background: "rgba(255,255,255,0.055)",
              pointerEvents: "none",
            }}
          />
        ))}

        {/* Cache band. The whole clip is a dim gutter and the resident frames
            are lit, so what is *not* held is as legible as what is — which is
            the question being asked when playback stutters. */}
        {!single && stats && stats.mode !== "n/a" && (
          <>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: BAND,
                background: "rgba(255,255,255,0.07)",
                pointerEvents: "none",
              }}
            />
            {stats.ranges.map(([a, b], i) => (
              <div
                key={`b${i}`}
                style={{
                  position: "absolute",
                  ...span(a, b),
                  bottom: 0,
                  height: BAND,
                  background: C.good,
                  opacity: 0.75,
                  pointerEvents: "none",
                }}
              />
            ))}
          </>
        )}

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
        {/* The handle doubles as the cache-miss tell: on a frame that is not
            resident it pulls a face, because that is the frame the playback is
            about to stutter on. */}
        {miss ? (
          <div
            title={`Frame ${frame} is not in the cache — it has to be decoded before it can be shown`}
            style={{
              position: "absolute",
              left: `calc(${pct(frame)}% - 7px)`,
              bottom: 0,
              width: 14,
              height: 14,
              fontSize: 12,
              lineHeight: "14px",
              textAlign: "center",
            }}
          >
            🙁
          </div>
        ) : (
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
        )}
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
