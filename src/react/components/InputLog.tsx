"use client";

import { useEffect, useRef, useState } from "react";
import { C, label, selectableText, textButton } from "../styles";

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

/** `gap` is the pause before this event — the useful number when a stroke is
 *  missing, since it reads the same whichever end of the list you start from. */
export function formatEntry(e: InputEntry, gap: number): string {
  const t = `+${gap}ms`.padStart(8, " ");
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
  const [copied, setCopied] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null);

  // Newest first: the line you want is the one that just happened, and this way
  // it is always in the same place with nothing to scroll.
  const lines = entries
    .map((e, i) => ({ e, text: formatEntry(e, i === 0 ? 0 : e.t - entries[i - 1].t) }))
    .reverse();

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [entries]);

  /**
   * `navigator.clipboard` exists only in a secure context, and the review runs
   * over plain http on a LAN address — so on the iPad, the device this log is
   * for, it is simply undefined. Fall back to the old execCommand path, which
   * still works inside a user gesture, and say so either way rather than
   * failing in silence.
   */
  const copy = async () => {
    const text = lines.map((l) => l.text).join("\n");
    try {
      if (window.isSecureContext && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopied(`copied ${entries.length}`);
        return;
      }
      throw new Error("no clipboard api");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
      document.body.appendChild(ta);
      // iOS ignores .select() on a readonly textarea; it wants an explicit
      // range on the selection *and* setSelectionRange.
      const range = document.createRange();
      range.selectNodeContents(ta);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      ta.setSelectionRange(0, text.length);
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      sel?.removeAllRanges();
      document.body.removeChild(ta);
      // Last resort: hand the text over in something the user can select by
      // hand. Failing silently is how the button looked broken in the first
      // place.
      if (!ok) setManual(text);
      setCopied(ok ? `copied ${entries.length}` : "select + copy ↓");
    }
  };

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

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
        <button onClick={() => void copy()} style={{ ...textButton(), height: 22, fontSize: 11 }}>
          {copied ?? "Copy"}
        </button>
        <button
          onClick={() => {
            setManual(null);
            setCopied(null);
            onClear();
          }}
          style={{ ...textButton(), height: 22, fontSize: 11 }}
        >
          Clear
        </button>
        <button onClick={onClose} style={{ ...textButton(), height: 22, fontSize: 11 }}>
          ✕
        </button>
      </div>

      {manual !== null && (
        <textarea
          readOnly
          value={manual}
          onFocus={(e) => e.currentTarget.select()}
          style={{
            ...selectableText,
            pointerEvents: "auto",
            margin: 8,
            height: 90,
            background: C.lowest,
            color: C.text,
            border: `1px solid ${C.high}`,
            borderRadius: 6,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 10,
            padding: 6,
          }}
        />
      )}

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
        {lines.map((l, i) => (
          <div key={i} style={{ color: PHASE_COLOR[l.e.phase] }}>
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}
