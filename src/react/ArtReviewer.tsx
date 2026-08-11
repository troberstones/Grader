"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hexToRgba, Smoother, simplify } from "../core/strokes";
import { nextMarker, prevMarker } from "../core/fold";
import type { Author, LoopMode, Stroke, StrokeTool, ViewerState } from "../core/types";
import { GLRenderer, type ViewParams } from "../render/gl";
import {
  clearOverlay,
  drawGuides,
  drawLaser,
  drawLiveInk,
  drawStrokes,
  type GuideKind,
} from "../render/overlay";
import { LayeredSource } from "../sources/layered";
import { sharedLedger } from "../sources/ledger";
import { VideoElementSource } from "../sources/video-element";
import type { ReviewChannel, ReviewDataAdapter } from "../adapter/types";
import type { ReviewItem } from "../core/types";
import { HelpSheet } from "./components/HelpSheet";
import { LayerPanel } from "./components/LayerPanel";
import { Playlist } from "./components/Playlist";
import { Presence } from "./components/Presence";
import { Timeline } from "./components/Timeline";
import { InkRail, TransportBar, ViewBar, type ToolState } from "./components/Toolbar";
import { isTypingTarget } from "./keymap";
import { C, label, textButton } from "./styles";
import { useAnnotations } from "./useAnnotations";
import { useSession } from "./useSession";
import { useViewer } from "./useViewer";

export interface ArtReviewerProps {
  items: ReviewItem[];
  adapter: ReviewDataAdapter;
  channel: ReviewChannel;
  author: Author;
  initial?: Partial<ViewerState>;
  pdfWorkerUrl?: string;
  /** Rendered top-right — grader puts student navigation here. */
  headerSlot?: React.ReactNode;
  onPositionChange?: (itemIndex: number, frame: number) => void;
}

const LASER_LIFETIME_MS = 1200;
/** The artwork is the point; the control stack never squeezes it to a strip. */
const STAGE_MIN_HEIGHT = 320;

export function ArtReviewer({
  items,
  adapter,
  channel,
  author,
  initial,
  pdfWorkerUrl,
  headerSlot,
  onPositionChange,
}: ArtReviewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const [tools, setTools] = useState<ToolState>({
    tool: "pen",
    color: "#ef4444",
    width: 4,
    guides: "none",
  });
  const [showHelp, setShowHelp] = useState(false);
  const [audioOwner, setAudioOwner] = useState(false);
  const [textPrompt, setTextPrompt] = useState<{ x: number; y: number; value: string } | null>(null);

  const session = useSession(channel, author);

  // ── Item + annotations ──────────────────────────────────────────────────────
  const [itemIndex, setItemIndex] = useState(initial?.itemIndex ?? 0);
  const currentItem = items[itemIndex] ?? null;

  const annotations = useAnnotations(
    adapter,
    currentItem?.id ?? null,
    author,
    session.send,
    session.subscribe,
  );

  // Live drawing state, kept in refs so the render loop reads it without
  // re-subscribing every stroke point.
  const drawingRef = useRef<{
    id: string;
    points: number[];
    pressure: number[];
    sent: number;
    tool: StrokeTool;
  } | null>(null);
  const smoother = useRef(new Smoother(0.5));
  const lasersRef = useRef<{ x: number; y: number; color: number; at: number; client: string }[]>([]);
  const panStateRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; zoom: number; cx: number; cy: number; panX: number; panY: number } | null>(null);
  const spaceRef = useRef(false);

  const inkColor = useMemo(() => hexToRgba(tools.color), [tools.color]);

  // ── Overlay drawing ─────────────────────────────────────────────────────────
  const drawOverlay = useCallback(
    (params: ViewParams, frame: number) => {
      const canvas = overlayRef.current;
      if (!canvas) return;
      if (canvas.width !== params.canvasWidth) canvas.width = params.canvasWidth;
      if (canvas.height !== params.canvasHeight) canvas.height = params.canvasHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      clearOverlay(ctx, params);
      drawGuides(ctx, tools.guides, params);

      const committed = annotations.visibleOn(frame);
      drawStrokes(ctx, committed, params, {
        hiddenAuthors: annotations.hiddenAuthors,
        ghostMs: 0,
      });

      // Remote in-progress ink — the room watches the line being drawn.
      for (const ink of annotations.liveInk) {
        drawLiveInk(
          ctx,
          { tool: ink.tool, color: ink.color, width: ink.width, points: ink.points },
          params,
        );
      }

      // The local stroke in flight.
      const local = drawingRef.current;
      if (local && local.points.length >= 2) {
        drawLiveInk(
          ctx,
          {
            tool: local.tool,
            color: inkColor,
            width: tools.width,
            points: local.points,
            pressure: local.pressure.length === local.points.length / 2 ? local.pressure : undefined,
          },
          params,
        );
      }

      const now = Date.now();
      lasersRef.current = lasersRef.current.filter((l) => now - l.at < LASER_LIFETIME_MS);
      if (lasersRef.current.length) {
        drawLaser(
          ctx,
          lasersRef.current.map((l) => ({ x: l.x, y: l.y, color: l.color, age: now - l.at })),
          params,
        );
      }
    },
    [annotations, tools.guides, tools.width, inkColor],
  );

  const viewer = useViewer({
    items,
    session,
    glCanvasRef,
    overlayCanvasRef: overlayRef,
    containerRef,
    drawOverlay,
    initial,
    pdfWorkerUrl,
    annotatedFrames: annotations.annotatedFrames,
  });

  const { state, dispatch, item, source, stats } = viewer;

  useEffect(() => setItemIndex(state.itemIndex), [state.itemIndex]);
  useEffect(
    () => onPositionChange?.(state.itemIndex, state.frame),
    [state.itemIndex, state.frame, onPositionChange],
  );

  const canControl = session.role !== "follower";
  const frameCount = item?.frameCount ?? 1;

  // Remote strokes and live ink land outside the render loop, and the loop only
  // paints when something marks the frame dirty. On a paused screen — which is
  // most of a critique — nothing else ever would, so a peer's drawing arrived
  // in state and was never shown.
  useEffect(() => {
    viewer.invalidate();
  }, [viewer.invalidate, annotations.strokes, annotations.liveInk, annotations.hiddenAuthors]);

  // Laser events from peers.
  useEffect(() => {
    return session.subscribe((e) => {
      if (e.a !== "laser") return;
      lasersRef.current = [
        ...lasersRef.current.filter((l) => l.client !== e.client),
        { x: e.x, y: e.y, color: author.color, at: Date.now(), client: e.client },
      ];
      viewer.invalidate();
    });
    // Deliberately not depending on `viewer`: it is a fresh object every render,
    // and resubscribing that often drops messages that land in the gap.
  }, [session.subscribe, viewer.invalidate, author.color]);

  // Only one host in the room should make noise.
  useEffect(() => {
    if (source instanceof VideoElementSource) source.setMuted(!audioOwner);
  }, [source, audioOwner]);

  // Keep the iPad awake through a long crit.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    void nav.wakeLock
      ?.request("screen")
      .then((l) => {
        lock = l;
      })
      .catch(() => {});
    return () => {
      void lock?.release().catch(() => {});
    };
  }, []);

  // ── Coordinate helpers ──────────────────────────────────────────────────────
  const toMediaNorm = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const el = containerRef.current;
      const params = viewer.viewParams();
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const p = GLRenderer.screenToMedia(
        params,
        (clientX - r.left) * dpr,
        (clientY - r.top) * dpr,
      );
      return { x: p.x / params.mediaWidth, y: p.y / params.mediaHeight };
    },
    [viewer],
  );

  /**
   * A note belongs to the frame it was drawn on. `frameOut` stays in the shape
   * because the codec and the table both carry it, but nothing spans any more.
   */
  const holdRange = useCallback(
    (frame: number): [number, number] => (frameCount <= 1 ? [0, 0] : [frame, frame]),
    [frameCount],
  );

  // ── Pointer handling ────────────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = overlayRef.current;
      if (!el) return;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Capture is an optimisation, not a requirement — a pointer that has
        // already been released (or a synthetic one) must not abort the stroke.
      }
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Two fingers: pinch-zoom and pan together, iPad style.
      if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()];
        pinchRef.current = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          zoom: state.zoom,
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
          panX: state.panX,
          panY: state.panY,
        };
        drawingRef.current = null;
        return;
      }

      // Laser: transient, broadcast, never stored.
      if (e.altKey) {
        const p = toMediaNorm(e.clientX, e.clientY);
        lasersRef.current = [
          ...lasersRef.current.filter((l) => l.client !== "self"),
          { ...p, color: author.color, at: Date.now(), client: "self" },
        ];
        session.send({ a: "laser", x: p.x, y: p.y, client: channel.clientId });
        return;
      }

      // Pan: space-drag, middle button, or the select tool.
      if (spaceRef.current || e.button === 1 || tools.tool === "select") {
        panStateRef.current = { x: e.clientX, y: e.clientY, panX: state.panX, panY: state.panY };
        return;
      }

      const p = toMediaNorm(e.clientX, e.clientY);

      if (tools.tool === "erase") {
        void annotations.eraseAt(state.frame, p.x, p.y, 0.02);
        return;
      }

      if (tools.tool === "text") {
        setTextPrompt({ x: p.x, y: p.y, value: "" });
        return;
      }

      smoother.current.reset();
      const [sx, sy] = smoother.current.push(p.x, p.y);
      drawingRef.current = {
        id: `${author.id}-${Date.now().toString(36)}`,
        points: [sx, sy],
        pressure: e.pointerType === "pen" ? [e.pressure] : [],
        sent: 0,
        tool: tools.tool as StrokeTool,
      };
      viewer.invalidate();
    },
    [state, tools.tool, toMediaNorm, annotations, author, session, channel.clientId, viewer],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      // Pinch
      const pinch = pinchRef.current;
      if (pinch && pointersRef.current.size >= 2) {
        const [a, b] = [...pointersRef.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const k = dist / Math.max(1, pinch.dist);
        const el = containerRef.current;
        if (el) {
          const r = el.getBoundingClientRect();
          const cc = { x: r.width / 2, y: r.height / 2 };
          const ox = pinch.cx - r.left;
          const oy = pinch.cy - r.top;
          const panX = ox - cc.x - (ox - cc.x - pinch.panX) * k + (cx - pinch.cx);
          const panY = oy - cc.y - (oy - cc.y - pinch.panY) * k + (cy - pinch.cy);
          dispatch({ a: "view", zoom: pinch.zoom * k, panX, panY });
        }
        return;
      }

      // Pan
      const pan = panStateRef.current;
      if (pan) {
        dispatch({
          a: "view",
          panX: pan.panX + (e.clientX - pan.x),
          panY: pan.panY + (e.clientY - pan.y),
        });
        return;
      }

      // Laser drag
      if (e.altKey && !drawingRef.current) {
        const p = toMediaNorm(e.clientX, e.clientY);
        lasersRef.current = [
          ...lasersRef.current.filter((l) => l.client !== "self"),
          { ...p, color: author.color, at: Date.now(), client: "self" },
        ];
        session.send({ a: "laser", x: p.x, y: p.y, client: channel.clientId });
        viewer.invalidate();
        return;
      }

      const d = drawingRef.current;
      if (!d) return;

      const raw = toMediaNorm(e.clientX, e.clientY);
      // Freehand accumulates; shapes only ever need start and current point.
      if (d.tool === "pen" || d.tool === "highlight") {
        const [sx, sy] = smoother.current.push(raw.x, raw.y);
        d.points.push(sx, sy);
        if (e.pointerType === "pen") d.pressure.push(e.pressure);
      } else {
        if (d.points.length >= 4) d.points.length = 2;
        d.points.push(raw.x, raw.y);
      }

      // Stream the tail of the stroke so followers watch it appear live.
      const tail = d.points.slice(d.sent);
      if (tail.length >= 2) {
        annotations.streamInk({
          id: d.id,
          tool: d.tool,
          color: inkColor,
          width: tools.width,
          points: tail,
        });
        d.sent = d.points.length;
      }
      viewer.invalidate();
    },
    [dispatch, toMediaNorm, annotations, inkColor, tools.width, author.color, session, channel.clientId, viewer],
  );

  const finishStroke = useCallback(async () => {
    const d = drawingRef.current;
    drawingRef.current = null;
    if (!d || d.points.length < 2) return;

    annotations.endInk(d.id);

    // A tap with a shape tool is an accident, not a zero-size rectangle.
    if (d.tool !== "pen" && d.tool !== "highlight" && d.points.length >= 4) {
      const dx = Math.abs(d.points[2] - d.points[0]);
      const dy = Math.abs(d.points[3] - d.points[1]);
      if (dx < 0.004 && dy < 0.004) {
        viewer.invalidate();
        return;
      }
    }

    const points =
      d.tool === "pen" || d.tool === "highlight" ? simplify(d.points, 0.0012) : d.points;
    const [frameIn, frameOut] = holdRange(state.frame);

    await annotations.commit({
      tool: d.tool,
      color: inkColor,
      width: tools.width,
      frameIn,
      frameOut,
      points,
      pressure: d.pressure.length === d.points.length / 2 ? d.pressure : undefined,
      layers: state.composite ? undefined : Object.keys(state.layers).filter((k) => state.layers[k]),
    } as Omit<Stroke, "localId" | "authorId">);
    viewer.invalidate();
  }, [annotations, holdRange, state, inkColor, tools.width, viewer]);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;
      panStateRef.current = null;
      void finishStroke();
    },
    [finishStroke],
  );

  // Wheel: pinch-zoom around the cursor, two-finger scroll pans.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const k = Math.exp(-e.deltaY * 0.01);
        const ox = e.clientX - r.left;
        const oy = e.clientY - r.top;
        const ccx = r.width / 2;
        const ccy = r.height / 2;
        const st = viewer.state;
        dispatch({
          a: "view",
          zoom: st.zoom * k,
          panX: ox - ccx - (ox - ccx - st.panX) * k,
          panY: oy - ccy - (oy - ccy - st.panY) * k,
        });
      } else {
        dispatch({
          a: "view",
          panX: viewer.state.panX - e.deltaX,
          panY: viewer.state.panY - e.deltaY,
        });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [dispatch, viewer]);

  // ── Zoom helpers ────────────────────────────────────────────────────────────
  const setZoom = useCallback(
    (z: number | "fit" | "actual") => {
      if (z === "fit") return dispatch({ a: "view", zoom: 1, panX: 0, panY: 0, fit: "fit" });
      if (z === "actual") {
        const params = viewer.viewParams();
        const fitScale = Math.min(
          params.canvasWidth / Math.max(1, params.mediaWidth),
          params.canvasHeight / Math.max(1, params.mediaHeight),
        );
        return dispatch({ a: "view", zoom: 1 / fitScale, panX: 0, panY: 0, fit: "actual" });
      }
      dispatch({ a: "view", zoom: z });
    },
    [dispatch, viewer],
  );

  const jumpAnnotation = useCallback(
    (dir: -1 | 1) => {
      const target =
        dir === -1
          ? prevMarker(annotations.annotatedFrames, state.frame)
          : nextMarker(annotations.annotatedFrames, state.frame);
      if (target !== null) dispatch({ a: "seek", frame: target });
    },
    [annotations.annotatedFrames, state.frame, dispatch],
  );

  // ── Keyboard ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === "Space" && !e.repeat && (e.ctrlKey || e.metaKey)) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void (e.shiftKey ? annotations.redo() : annotations.undo());
        return;
      }
      if (mod) return;

      const k = e.key;
      const shift = e.shiftKey;

      switch (k) {
        case " ":
          e.preventDefault();
          // Space also arms drag-to-pan; only toggle playback on keyup if it
          // was never used for panning.
          spaceRef.current = true;
          return;
        case ",":
          viewer.stepFrame(-1);
          return;
        case ".":
          viewer.stepFrame(1);
          return;
        case "ArrowLeft":
          viewer.stepFrame(shift ? -10 : -1);
          return;
        case "ArrowRight":
          viewer.stepFrame(shift ? 10 : 1);
          return;
        case "Home":
          dispatch({ a: "seek", frame: 0 });
          return;
        case "End":
          dispatch({ a: "seek", frame: frameCount - 1 });
          return;
        case "[":
          jumpAnnotation(-1);
          return;
        case "]":
          jumpAnnotation(1);
          return;
        case "PageUp":
          dispatch({ a: "goto", item: Math.max(0, state.itemIndex - 1), frame: 0 });
          return;
        case "PageDown":
          dispatch({ a: "goto", item: Math.min(items.length - 1, state.itemIndex + 1), frame: 0 });
          return;
        case "0":
          setZoom("fit");
          return;
        case "9":
          setZoom("actual");
          return;
        case "+":
        case "=":
          setZoom(state.zoom * 1.25);
          return;
        case "-":
          setZoom(state.zoom / 1.25);
          return;
        case "?":
          setShowHelp((v) => !v);
          return;
      }

      switch (k.toLowerCase()) {
        case "f":
          dispatch(shift ? { a: "flip", v: !state.flipV } : { a: "flip", h: !state.flipH });
          return;
        case "r":
          dispatch({ a: "rotate", deg: (((state.rotate + 90) % 360) as 0 | 90 | 180 | 270) });
          return;
        case "l": {
          const order: LoopMode[] = ["loop", "bounce", "off"];
          dispatch({ a: "loop", mode: order[(order.indexOf(state.loop) + 1) % order.length] });
          return;
        }
        case "v":
          dispatch({ a: "color", patch: { saturation: state.color.saturation < 1 ? 1 : 0 } });
          return;
        case "g": {
          const order: GuideKind[] = ["none", "thirds", "golden", "center", "diagonals", "grid"];
          setTools((t) => ({ ...t, guides: order[(order.indexOf(t.guides) + 1) % order.length] }));
          return;
        }
        case "o":
          dispatch({ a: "opts", patch: { onionSkin: state.onionSkin > 0 ? 0 : 1 } });
          return;
        case "b":
          setTools((t) => ({ ...t, tool: "pen" }));
          return;
        case "h":
          setTools((t) => ({ ...t, tool: "highlight" }));
          return;
        case "a":
          setTools((t) => ({ ...t, tool: "arrow" }));
          return;
        case "s":
          setTools((t) => ({ ...t, tool: "rect" }));
          return;
        case "e":
          setTools((t) => ({ ...t, tool: "ellipse" }));
          return;
        case "t":
          setTools((t) => ({ ...t, tool: "text" }));
          return;
        case "x":
          setTools((t) => ({ ...t, tool: "erase" }));
          return;
        case "m":
          session.isMaster ? session.release() : session.claim();
          return;
      }

      if (k >= "1" && k <= "5") {
        dispatch({ a: "rate", rate: [0.25, 0.5, 1, 2, 4][Number(k) - 1] });
      }
    };

    const up = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      if (isTypingTarget(e.target)) return;
      const wasPanning = panStateRef.current !== null;
      spaceRef.current = false;
      if (!wasPanning) dispatch({ a: state.playing ? "pause" : "play" });
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [
    state, dispatch, viewer, annotations, frameCount, items.length, jumpAnnotation, setZoom, session,
  ]);

  const manifest = source instanceof LayeredSource ? source.manifest() : null;
  const hasPrev = prevMarker(annotations.annotatedFrames, state.frame) !== null;
  const hasNext = nextMarker(annotations.annotatedFrames, state.frame) !== null;

  const cursor =
    tools.tool === "select" || spaceRef.current
      ? "grab"
      : tools.tool === "erase"
        ? "cell"
        : "crosshair";

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        minHeight: 0,
        background: C.bg,
        color: C.text,
        gap: 8,
        padding: 8,
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, 'Manrope', 'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
          // When the window is genuinely too short for a usable stage plus the
          // controls, scroll. The alternative is what used to happen: the stage
          // refused to shrink past its minimum, overflowed its own row, and
          // painted straight over the timeline and the transport bar.
          minHeight: 0,
          overflowY: "auto",
          gap: 8,
        }}
      >
      {/* Header. It used to wrap to three rows at tablet widths and every one
          of them came off the stage. Two items left now — session state and
          which student — so one row is the normal case. It still wraps rather
          than clipping: a hidden "Follow view" is worse than a shorter stage. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, flexWrap: "wrap" }}>
        <Presence session={session} />
        {/* Beside "Follow view" on purpose: both answer "what does this screen
            do in the room", as opposed to what the clip does. */}
        <label
          style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", flexShrink: 0 }}
          title="Only one machine in the room should play audio"
        >
          <input
            type="checkbox"
            checked={audioOwner}
            onChange={(e) => setAudioOwner(e.target.checked)}
            style={{ accentColor: C.primary }}
          />
          <span style={label}>Audio</span>
        </label>
        <MemoryReadout />
        <div style={{ flex: 1, minWidth: 8 }} />
        {/* Shrinkable: the host's slot (assignment name, student nav) is wider
            than the panel once a sidebar is open, and an unshrinkable child
            overflows the header no matter how willing the header is to wrap. */}
        <div style={{ minWidth: 0, overflowX: "auto" }}>{headerSlot}</div>
        <button
          onClick={() => setShowHelp(true)}
          style={{ ...textButton(), flexShrink: 0 }}
          title="Shortcuts  ?"
        >
          ?
        </button>
      </div>

      <Playlist
        items={items}
        index={state.itemIndex}
        disabled={!canControl}
        onSelect={(i) => dispatch({ a: "goto", item: i, frame: 0 })}
      />

      {/* stage */}
      {/* The floor lives here, on the flex row, not on the stage inside it.
          On the inner box the flex algorithm never sees it: the row shrinks,
          the stage refuses, and it overflows across everything below. */}
      <div style={{ display: "flex", gap: 8, flex: 1, minHeight: STAGE_MIN_HEIGHT }}>
        <div
          ref={containerRef}
          style={{
            position: "relative",
            flex: 1,
            minWidth: 0,
            background: C.lowest,
            borderRadius: 8,
            overflow: "hidden",
            touchAction: "none",
          }}
        >
          <canvas
            ref={glCanvasRef}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          />
          <canvas
            ref={overlayRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              cursor,
              touchAction: "none",
            }}
          />

          {!item && (
            <Centered>
              <span style={{ color: C.muted }}>No files to review</span>
            </Centered>
          )}
          {item?.unavailable && (
            <Centered>
              <div style={{ maxWidth: 460, textAlign: "center", padding: 20 }}>
                <div style={{ fontSize: 15, color: C.text, marginBottom: 8 }}>
                  {item.label} can&rsquo;t be opened
                </div>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
                  {item.unavailable}
                </div>
                <div style={{ fontSize: 11, color: C.faint, marginTop: 12, lineHeight: 1.6 }}>
                  The upload itself is damaged, so there is nothing to review here.
                  Ask for a re-upload — the other files in this playlist still work.
                </div>
              </div>
            </Centered>
          )}
          {viewer.glError && (
            <Notice tone="warn">{viewer.glError}</Notice>
          )}
          {viewer.fallbackNotice && (
            <Notice tone="warn">{viewer.fallbackNotice}</Notice>
          )}
          {annotations.error && <Notice tone="error">{annotations.error}</Notice>}
          {stats?.error && <Notice tone="error">{stats.error}</Notice>}

          {textPrompt && (
            <TextEntry
              onCancel={() => setTextPrompt(null)}
              onCommit={async (value) => {
                const [frameIn, frameOut] = holdRange(state.frame);
                setTextPrompt(null);
                if (!value.trim()) return;
                await annotations.commit({
                  tool: "text",
                  color: inkColor,
                  width: tools.width,
                  frameIn,
                  frameOut,
                  points: [textPrompt.x, textPrompt.y],
                  text: value,
                } as Omit<Stroke, "localId" | "authorId">);
                viewer.invalidate();
              }}
            />
          )}
        </div>

        {manifest && (
          <LayerPanel
            manifest={manifest}
            visible={state.layers}
            solo={state.soloLayer}
            composite={state.composite}
            onToggle={(id, v) => dispatch({ a: "layers", visible: { [id]: v } })}
            onSolo={(id) => dispatch({ a: "layers", solo: id })}
            onComposite={(v) => dispatch({ a: "layers", composite: v })}
          />
        )}
      </div>

      {/* timeline */}
      <Timeline
        frame={state.frame}
        frameCount={frameCount}
        fps={state.fps}
        markers={annotations.markers}
        stats={stats}
        disabled={!canControl}
        onScrub={(f) => dispatch({ a: "seek", frame: f })}
        onScrubStart={() => state.playing && dispatch({ a: "pause" })}
      />

      {/* controls — fixed height, scrolling sideways rather than wrapping into
          extra rows that eat the stage */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
        <TransportBar
          state={state}
          frameCount={frameCount}
          canControl={canControl}
          hasPrevAnnotation={hasPrev}
          hasNextAnnotation={hasNext}
          onPlayPause={() => dispatch({ a: state.playing ? "pause" : "play" })}
          onStep={viewer.stepFrame}
          onJumpAnnotation={jumpAnnotation}
          onLoop={(m) => dispatch({ a: "loop", mode: m })}
          onRate={(r) => dispatch({ a: "rate", rate: r })}
          onFps={(f) => dispatch({ a: "fps", fps: f })}
          onTogglePauseOnAnnotated={() =>
            dispatch({ a: "opts", patch: { pauseOnAnnotated: !state.pauseOnAnnotated } })
          }
          onOnionSkin={(n) => dispatch({ a: "opts", patch: { onionSkin: n } })}
        />
        <div style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 2 }}>
          <ViewBar
            state={state}
            guides={tools.guides}
            onFlip={(h, v) => dispatch({ a: "flip", h, v })}
            onRotate={() =>
              dispatch({ a: "rotate", deg: (((state.rotate + 90) % 360) as 0 | 90 | 180 | 270) })
            }
            onZoom={setZoom}
            onGuides={(g) => setTools((t) => ({ ...t, guides: g }))}
            onColor={(patch) => dispatch({ a: "color", patch })}
          />
        </div>
      </div>
      </div>

      <InkRail
        tools={tools}
        canUndo={annotations.canUndo}
        canRedo={annotations.canRedo}
        saving={annotations.saving}
        onTool={(t: ToolState["tool"]) => setTools((s) => ({ ...s, tool: t }))}
        onColorPick={(c: string) => setTools((s) => ({ ...s, color: c }))}
        onWidth={(w: number) => setTools((s) => ({ ...s, width: w }))}
        onUndo={() => void annotations.undo()}
        onRedo={() => void annotations.redo()}
        onClear={() => void annotations.clearFrame(state.frame)}
      />

      {showHelp && <HelpSheet onClose={() => setShowHelp(false)} />}
    </div>
  );
}

/**
 * Frame-cache memory, live. Worth a permanent slot rather than a debug flag:
 * this is the number that decides whether the tab is comfortable or pushing
 * the machine into swap, and it should never be a mystery.
 */
function MemoryReadout() {
  const ledger = sharedLedger();
  const [, force] = useState(0);

  useEffect(() => {
    const off = ledger.onChange(() => force((n) => n + 1));
    const timer = setInterval(() => force((n) => n + 1), 2000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [ledger]);

  const usedMb = ledger.bytesUsed / 1024 / 1024;
  const limitMb = ledger.bytesLimit / 1024 / 1024;
  const pressure = ledger.pressure;

  return (
    <span
      title={`Decoded frame cache across every open file. Capped at ${limitMb.toFixed(0)} MB — a browser tab, not the machine.`}
      style={{
        ...label,
        color: pressure > 0.9 ? C.primary : C.faint,
        fontVariantNumeric: "tabular-nums",
        flexShrink: 0,
      }}
    >
      {usedMb.toFixed(0)}/{limitMb.toFixed(0)} MB
    </span>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </div>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone: "warn" | "error" }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        bottom: 12,
        maxWidth: "70%",
        background: tone === "error" ? "rgba(239,68,68,0.16)" : "rgba(255,144,105,0.14)",
        color: tone === "error" ? "#fca5a5" : C.primary,
        borderRadius: 6,
        padding: "6px 10px",
        fontSize: 11.5,
        lineHeight: 1.45,
      }}
    >
      {children}
    </div>
  );
}

function TextEntry({
  onCommit,
  onCancel,
}: {
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <Centered>
      <div
        style={{
          background: C.container,
          borderRadius: 10,
          padding: 14,
          width: 360,
          boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ ...label, marginBottom: 8 }}>Note</div>
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onCommit(value);
          }}
          rows={3}
          style={{
            width: "100%",
            background: C.lowest,
            color: C.text,
            border: `1px solid ${C.ghost}`,
            borderRadius: 6,
            padding: 8,
            fontSize: 13,
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
          <button onClick={onCancel} style={textButton()}>
            Cancel
          </button>
          <button onClick={() => onCommit(value)} style={textButton(true)}>
            Add note
          </button>
        </div>
      </div>
    </Centered>
  );
}
