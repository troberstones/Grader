"use client";

import type { CSSProperties } from "react";
import type { LoopMode, StrokeTool, ViewerState } from "../../core/types";
import type { GuideKind } from "../../render/overlay";
import { C, iconButton, INK_COLORS, INK_WIDTHS, label, select, textButton } from "../styles";

export interface ToolState {
  tool: StrokeTool | "erase" | "select";
  color: string;
  width: number;
  guides: GuideKind;
  holdFrames: number;
}

interface TransportBarProps {
  state: ViewerState;
  frameCount: number;
  canControl: boolean;
  hasPrevAnnotation: boolean;
  hasNextAnnotation: boolean;
  onPlayPause: () => void;
  onStep: (d: number) => void;
  onJumpAnnotation: (dir: -1 | 1) => void;
  onLoop: (m: LoopMode) => void;
  onRate: (r: number) => void;
  onFps: (f: number) => void;
  onTogglePauseOnAnnotated: () => void;
  onOnionSkin: (n: number) => void;
}

const TOOL_LABELS: Record<string, string> = {
  pen: "Pen",
  highlight: "Highlighter",
  line: "Line",
  arrow: "Arrow",
  rect: "Rectangle",
  ellipse: "Ellipse",
  text: "Text",
  erase: "Eraser",
};

const TOOL_ICONS: Record<string, string> = {
  pen: "✎",
  highlight: "▭",
  line: "╱",
  arrow: "➔",
  rect: "□",
  ellipse: "◯",
  text: "T",
  erase: "⌫",
};

export function TransportBar({
  state,
  frameCount,
  canControl,
  hasPrevAnnotation,
  hasNextAnnotation,
  onPlayPause,
  onStep,
  onJumpAnnotation,
  onLoop,
  onRate,
  onFps,
  onTogglePauseOnAnnotated,
  onOnionSkin,
}: TransportBarProps) {
  const single = frameCount <= 1;
  const dim = !canControl;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button
          title="Previous annotated frame  ["
          disabled={dim || !hasPrevAnnotation}
          onClick={() => onJumpAnnotation(-1)}
          style={iconButton(false, dim || !hasPrevAnnotation)}
        >
          ⇤
        </button>
        <button
          title="Step back  ,"
          disabled={dim || single}
          onClick={() => onStep(-1)}
          style={iconButton(false, dim || single)}
        >
          ◀
        </button>
        <button
          title="Play / pause  Space"
          disabled={dim || single}
          onClick={onPlayPause}
          style={{ ...iconButton(state.playing, dim || single), width: 40 }}
        >
          {state.playing ? "❚❚" : "▶"}
        </button>
        <button
          title="Step forward  ."
          disabled={dim || single}
          onClick={() => onStep(1)}
          style={iconButton(false, dim || single)}
        >
          ▶
        </button>
        <button
          title="Next annotated frame  ]"
          disabled={dim || !hasNextAnnotation}
          onClick={() => onJumpAnnotation(1)}
          style={iconButton(false, dim || !hasNextAnnotation)}
        >
          ⇥
        </button>
      </div>

      <Divider />

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={label}>Loop</span>
        {(["off", "loop", "bounce"] as LoopMode[]).map((m) => (
          <button
            key={m}
            disabled={dim}
            onClick={() => onLoop(m)}
            title={
              m === "bounce"
                ? "Ping-pong: plays forward then backward"
                : m === "loop"
                  ? "Wrap around at the end"
                  : "Stop at the end"
            }
            style={textButton(state.loop === m)}
          >
            {m === "off" ? "Off" : m === "loop" ? "Loop" : "Bounce"}
          </button>
        ))}
      </div>

      <Divider />

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={label}>fps</span>
        <input
          type="number"
          min={1}
          max={120}
          value={Math.round(state.fps)}
          disabled={dim}
          onChange={(e) => onFps(Number(e.target.value))}
          style={{ ...select, width: 58 }}
        />
        <select
          value={state.rate}
          disabled={dim}
          onChange={(e) => onRate(Number(e.target.value))}
          style={select}
          title="Playback rate"
        >
          {[0.25, 0.5, 1, 1.5, 2, 4].map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
      </div>

      <Divider />

      <button
        onClick={onTogglePauseOnAnnotated}
        disabled={dim}
        title="Stop playback when a frame carrying annotations is reached"
        style={textButton(state.pauseOnAnnotated)}
      >
        Stop on notes
      </button>

      <select
        value={state.onionSkin}
        onChange={(e) => onOnionSkin(Number(e.target.value))}
        style={select}
        title="Ghost neighbouring frames"
        disabled={single}
      >
        <option value={0}>No onion skin</option>
        <option value={1}>Onion ±1</option>
        <option value={2}>Onion ±2</option>
        <option value={3}>Onion ±3</option>
      </select>
    </div>
  );
}

interface ViewBarProps {
  state: ViewerState;
  guides: GuideKind;
  onFlip: (h: boolean, v: boolean) => void;
  onRotate: () => void;
  onZoom: (z: number | "fit" | "actual") => void;
  onGuides: (g: GuideKind) => void;
  onColor: (patch: Partial<ViewerState["color"]>) => void;
}

export function ViewBar({
  state,
  guides,
  onFlip,
  onRotate,
  onZoom,
  onGuides,
  onColor,
}: ViewBarProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 2 }}>
        <button
          title="Flip horizontally  F — the classic check-your-drawing move"
          onClick={() => onFlip(!state.flipH, state.flipV)}
          style={iconButton(state.flipH)}
        >
          ⇋
        </button>
        <button
          title="Flip vertically  Shift+F"
          onClick={() => onFlip(state.flipH, !state.flipV)}
          style={iconButton(state.flipV)}
        >
          ⇅
        </button>
        <button title="Rotate 90°  R" onClick={onRotate} style={iconButton(state.rotate !== 0)}>
          ↻
        </button>
      </div>

      <Divider />

      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button title="Zoom out  −" onClick={() => onZoom(state.zoom / 1.25)} style={iconButton()}>
          −
        </button>
        <span
          style={{
            ...label,
            width: 46,
            textAlign: "center",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {Math.round(state.zoom * 100)}%
        </span>
        <button title="Zoom in  +" onClick={() => onZoom(state.zoom * 1.25)} style={iconButton()}>
          +
        </button>
        <button title="Fit to window  0" onClick={() => onZoom("fit")} style={textButton()}>
          Fit
        </button>
        <button title="Zoom to 100%  9" onClick={() => onZoom("actual")} style={textButton()}>
          1:1
        </button>
      </div>

      <Divider />

      <button
        title="Value check — strip colour to judge values  V"
        onClick={() => onColor({ saturation: state.color.saturation < 1 ? 1 : 0 })}
        style={textButton(state.color.saturation < 1)}
      >
        Value
      </button>

      <select
        value={state.color.channel}
        onChange={(e) => onColor({ channel: e.target.value as ViewerState["color"]["channel"] })}
        style={select}
        title="Isolate a channel"
      >
        <option value="rgb">RGB</option>
        <option value="r">Red</option>
        <option value="g">Green</option>
        <option value="b">Blue</option>
        <option value="a">Alpha</option>
        <option value="luma">Luma</option>
      </select>

      <select
        value={guides}
        onChange={(e) => onGuides(e.target.value as GuideKind)}
        style={select}
        title="Composition guides  G"
      >
        <option value="none">No guides</option>
        <option value="thirds">Thirds</option>
        <option value="golden">Golden</option>
        <option value="center">Centre</option>
        <option value="diagonals">Diagonals</option>
        <option value="grid">Grid</option>
      </select>
    </div>
  );
}

interface InkBarProps {
  tools: ToolState;
  frameCount: number;
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
  onTool: (t: ToolState["tool"]) => void;
  onColorPick: (c: string) => void;
  onWidth: (w: number) => void;
  onHold: (frames: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

export function InkBar({
  tools,
  frameCount,
  canUndo,
  canRedo,
  saving,
  onTool,
  onColorPick,
  onWidth,
  onHold,
  onUndo,
  onRedo,
  onClear,
}: InkBarProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 2 }}>
        {(["pen", "highlight", "arrow", "line", "rect", "ellipse", "text", "erase"] as const).map(
          (t) => (
            <button
              key={t}
              title={TOOL_LABELS[t]}
              onClick={() => onTool(t)}
              style={iconButton(tools.tool === t)}
            >
              {TOOL_ICONS[t]}
            </button>
          ),
        )}
      </div>

      <Divider />

      <div style={{ display: "flex", gap: 3 }}>
        {INK_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onColorPick(c)}
            title={c}
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              background: c,
              border:
                tools.color === c ? `2px solid ${C.text}` : "1px solid rgba(255,255,255,0.15)",
              cursor: "pointer",
              padding: 0,
            }}
          />
        ))}
      </div>

      <div style={{ display: "flex", gap: 2 }}>
        {INK_WIDTHS.map((w) => (
          <button
            key={w}
            onClick={() => onWidth(w)}
            title={`${w} px`}
            style={{ ...iconButton(tools.width === w), width: 28 }}
          >
            <span
              style={{
                display: "block",
                width: Math.min(16, 3 + w),
                height: Math.min(16, 3 + w),
                borderRadius: "50%",
                background: tools.width === w ? "#000" : C.text,
              }}
            />
          </button>
        ))}
      </div>

      {frameCount > 1 && (
        <>
          <Divider />
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={label} title="How many frames a new note stays on screen">
              Hold
            </span>
            <select
              value={tools.holdFrames}
              onChange={(e) => onHold(Number(e.target.value))}
              style={select}
            >
              <option value={0}>1 frame</option>
              <option value={12}>12 frames</option>
              <option value={24}>24 frames</option>
              <option value={48}>48 frames</option>
              <option value={-1}>Whole clip</option>
            </select>
          </div>
        </>
      )}

      <Divider />

      <button onClick={onUndo} disabled={!canUndo} style={iconButton(false, !canUndo)} title="Undo">
        ↶
      </button>
      <button onClick={onRedo} disabled={!canRedo} style={iconButton(false, !canRedo)} title="Redo">
        ↷
      </button>
      <button onClick={onClear} style={textButton()} title="Clear your notes on this frame">
        Clear
      </button>
      {saving && <span style={{ ...label, color: C.faint }}>saving…</span>}
    </div>
  );
}

function Divider() {
  const s: CSSProperties = {
    width: 1,
    height: 20,
    background: "rgba(255,255,255,0.08)",
    flexShrink: 0,
  };
  return <div style={s} />;
}
