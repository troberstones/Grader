"use client";

import { useEffect, useRef } from "react";
import { C, label, textButton } from "../styles";

/**
 * A live tail of pointer input, for working out where a stroke went.
 *
 * The raw event is only half the story — a stroke that never appears was
 * usually routed somewhere else, so every entry carries the decision the
 * handler made as well as the coordinates that produced it.
 */
export interface InputEntry {
  t: number;
  phase: "down" | "move" | "up" | "cancel" | "lost";
  pointerId: number;
  type: string;
  pressure: number;
  /** Media-normalised, the same space strokes are stored in. */
  x: number;
  y: number;
  buttons: number;
  /** What the handler did with it. Absent for plain moves. */
  note?: string;
  /** Consecutive identical moves are folded into one line. */
  count: number;
}

const PHASE_COLOR: Record<InputEntry["phase"], string> = {
  down: "#7ee787",
  move: "#8b949e",
  up: "#79c0ff",
  cancel: "#ff7b72",
  lost: "#ffa657",
};

export function formatEntry(e: InputEntry, t0: number): string {
  const t = `${e.t - t0}ms`.padStart(8, " ");
  const phase = (e.phase + (e.count > 1 ? `×${e.count}` : "")).padEnd(9, " ");
  const id = `#${e.pointerId}`.padEnd(6, " ");
  const type = e.type.padEnd(6, " ");
  const xy = `${e.x.toFixed(3)},${e.y.toFixed(3)}`.padEnd(14, " ");
  return (
    `${t}  ${phase}${id}${type}b${e.buttons}  p${e.pressure.toFixed(2)}  ${xy}` +
    (e.note ? `→ ${e.note}` : "")
  );
}

interface Props {
  entries: InputEntry[];
  onClear: () => void;
  onClose: () => void;
}

export function InputLog({ entries, onClear, onClose }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const t0 = entries.length ? entries[0].t : 0;

  // Stick to the bottom unless the reader has scrolled up to look at something.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const copy = () => {
    const text = entries.map((e) => formatEntry(e, t0)).join("\n");
    void navigator.clipboard?.writeText(text);
  };

  return (
    <div
      style={{
        position: "absolute",
        left: 8,
        bottom: 8,
        width: 460,
        maxHeight: 300,
        display: "flex",
        flexDirection: "column",
        background: "rgba(10,10,10,0.92)",
        border: `1px solid ${C.high}`,
        borderRadius: 8,
        // The panel sits over the stage; it must never eat a stroke. Only the
        // buttons opt back in.
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 8px",
          borderBottom: `1px solid ${C.high}`,
          pointerEvents: "auto",
        }}
      >
        <span style={{ ...label, color: C.text }}>Input</span>
        <span style={{ ...label, color: C.faint }}>{entries.length}</span>
        <div style={{ flex: 1 }} />
        <button onClick={copy} style={{ ...textButton(), height: 22, fontSize: 11 }}>
          Copy
        </button>
        <button onClick={onClear} style={{ ...textButton(), height: 22, fontSize: 11 }}>
          Clear
        </button>
        <button onClick={onClose} style={{ ...textButton(), height: 22, fontSize: 11 }}>
          ✕
        </button>
      </div>

      <div
        ref={bodyRef}
        style={{
          overflowY: "auto",
          padding: "6px 8px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 10,
          lineHeight: 1.45,
          whiteSpace: "pre-wrap",
        }}
      >
        {entries.length === 0 && (
          <div style={{ color: C.faint }}>Draw on the stage — every pointer event lands here.</div>
        )}
        {entries.map((e, i) => (
          <div key={i} style={{ color: PHASE_COLOR[e.phase] }}>
            {formatEntry(e, t0)}
          </div>
        ))}
      </div>
    </div>
  );
}
