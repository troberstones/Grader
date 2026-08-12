"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hexToRgba, Smoother, simplify } from "../core/strokes";
import { nextMarker, prevMarker } from "../core/fold";
import type { Author, LoopMode, Stroke, StrokeTool, ViewerState } from "../core/types";
import { GLRenderer, type ViewParams } from "../render/gl";
import {
  clearOverlay,
  drawBrushCursor,
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
import { InputLog, type InputEntry } from "./components/InputLog";
import { LayerPanel } from "./components/LayerPanel";
import { Playlist } from "./components/Playlist";
import { Presence } from "./components/Presence";
import { Timeline } from "./components/Timeline";
import { InkRail, TransportBar, ViewBar, type ToolState } from "./components/Toolbar";
import { isTypingTarget } from "./keymap";
import { C, label, noSelect, selectableText, textButton } from "./styles";
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
/**
 * The artwork is the point, so the stage has a floor — but a low one.
 *
 * The stage absorbs every bit of shortfall so the transport stays on screen —
 * a smaller image you can still scrub beats a bigger one whose play button is
 * off the bottom. Low, because the panel no longer scrolls at all: a scroll
 * container around the stage lets iPadOS take pencil gestures away.
 */
const STAGE_MIN_HEIGHT = 140;

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
    /** Which pointer owns this stroke; another one lifting must not end it. */
    pointerId: number;
    pointerType: string;
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
  /**
   * Where the stylus is, in media space, and whether it is touching. Apple
   * Pencil reports hover on the hardware that supports it; on everything else
   * this simply never populates until the tip lands.
   */
  const hoverRef = useRef<{ x: number; y: number; down: boolean } | null>(null);
  /** finishStroke is defined below onPointerDown; a ref sidesteps the ordering. */
  const finishStrokeRef = useRef<(() => void) | null>(null);
  const onPointerUpRef = useRef<((e: React.PointerEvent) => void) | null>(null);
  const onPointerMoveRef = useRef<((e: React.PointerEvent) => void) | null>(null);

  // ── Input log (D) ───────────────────────────────────────────────────────────
  /** toMediaNorm is defined further down; the log only needs it at event time. */
  const toMediaNormRef = useRef<(x: number, y: number) => { x: number; y: number }>(() => ({
    x: 0,
    y: 0,
  }));
  const [showLog, setShowLog] = useState(false);
  const showLogRef = useRef(showLog);
  showLogRef.current = showLog;
  const logRef = useRef<InputEntry[]>([]);
  const [logEntries, setLogEntries] = useState<InputEntry[]>([]);

  /**
   * Costs nothing while the panel is closed, and never re-renders per event —
   * a pointermove at 120 Hz through React state would change the timing of the
   * very thing being measured.
   */
  const logInput = useCallback(
    (
      phase: InputEntry["phase"],
      e: {
        clientX: number;
        clientY: number;
        pointerId: number;
        pointerType: string;
        pressure: number;
        buttons: number;
      },
      note?: string,
    ) => {
      if (!showLogRef.current) return;
      const buf = logRef.current;
      const p = toMediaNormRef.current(e.clientX, e.clientY);
      // Fold consecutive identical moves, *including* their note. Hover moves
      // all carry "nothing in flight", so requiring an empty note meant they
      // never folded and a few seconds of hovering buried the one line that
      // mattered under thirty that did not. Hovering near the page is not
      // avoidable; drowning in it should be.
      const last = buf[buf.length - 1];
      if (
        phase === "move" &&
        last &&
        last.phase === "move" &&
        last.pointerId === e.pointerId &&
        last.note === note
      ) {
        last.count += 1;
        last.t = Date.now();
        last.x = p.x;
        last.y = p.y;
        last.pressure = e.pressure;
        return;
      }
      buf.push({
        t: Date.now(),
        phase,
        pointerId: e.pointerId,
        type: e.pointerType,
        pressure: e.pressure,
        x: p.x,
        y: p.y,
        buttons: e.buttons,
        note,
        count: 1,
      });
      if (buf.length > 2000) buf.splice(0, buf.length - 2000);
    },
    [],
  );

  /**
   * Anything the canvas never saw.
   *
   * When a stroke goes missing there are two very different explanations —
   * Safari never delivered the events, or it delivered them somewhere else —
   * and from inside the canvas handler they look identical. This watches the
   * document in the capture phase and records only pen events whose target is
   * not the overlay, which is exactly the difference between them.
   */
  useEffect(() => {
    if (!showLog) return;
    const seen = (e: PointerEvent) => {
      if (e.pointerType !== "pen") return;
      if (e.target === overlayRef.current) return; // already logged in full
      // With a stroke in flight the fallback below re-dispatches these into the
      // normal handler, which logs them properly. Logging here as well would
      // double every line of a stroke that wandered off the stage. The case
      // worth recording is the other one: events going somewhere else while
      // nothing is in flight, which is what a missing letter looks like.
      if (drawingRef.current) return;
      const el = e.target as HTMLElement | null;
      const what = el?.tagName?.toLowerCase() ?? "?";
      const phase: InputEntry["phase"] =
        e.type === "pointerdown"
          ? "down"
          : e.type === "pointerup"
            ? "up"
            : e.type === "pointercancel"
              ? "cancel"
              : "move";
      logInput(phase, e, `elsewhere · ${what}`);
    };
    const types = ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const;
    const listener = seen as EventListener;
    for (const t of types) document.addEventListener(t, listener, true);
    return () => {
      for (const t of types) document.removeEventListener(t, listener, true);
    };
  }, [showLog, logInput]);

  /** Log something that is not itself a pointer event, at the last known spot. */
  const logNote = useCallback(
    (phase: InputEntry["phase"], note: string) => {
      const h = hoverRef.current;
      logInput(phase, {
        clientX: 0,
        clientY: 0,
        pointerId: -1,
        pointerType: "pen",
        pressure: 0,
        buttons: 0,
      }, note);
      if (h) {
        const buf = logRef.current;
        const last = buf[buf.length - 1];
        if (last) {
          last.x = h.x;
          last.y = h.y;
        }
      }
    },
    [logInput],
  );

  // Repaint the panel on a timer rather than per event.
  useEffect(() => {
    if (!showLog) return;
    const timer = setInterval(() => setLogEntries([...logRef.current]), 120);
    return () => clearInterval(timer);
  }, [showLog]);
  /**
   * drawOverlay is built before `viewer` exists, so it cannot close over
   * `state`. The render loop reinstalls the callback every render, so a ref
   * read at draw time is current.
   */
  const guidesRef = useRef<GuideKind>("none");

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
      drawGuides(ctx, guidesRef.current, params);

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

      const hover = hoverRef.current;
      if (hover && tools.tool !== "select") {
        drawBrushCursor(ctx, hover, tools.width, inkColor, params);
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
    [annotations, tools.width, tools.tool, inkColor],
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
  guidesRef.current = state.guides;

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

  toMediaNormRef.current = toMediaNorm;

  // ── Pointer handling ────────────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = overlayRef.current;
      if (!el) return;
      // Tell the browser this gesture is ours.
      if (e.pointerType !== "touch" && e.cancelable) e.preventDefault();

      /**
       * No pointer capture for a stylus, deliberately.
       *
       * Capture is the one piece of browser state this code held from one
       * stroke to the next, and the symptom was every other letter going
       * missing with no events delivered for it at all — which nothing in a
       * handler can cause, only something left behind for the next gesture.
       * It has been here since the first version, which matches how long the
       * problem has.
       *
       * It bought little anyway: the overlay covers the whole stage, so a pen
       * is over it for the entire stroke. What capture did buy — events
       * continuing when the pointer wanders off the element — is replaced by
       * the document-level fallback below, which is ours rather than the
       * browser's.
       */
      if (e.pointerType === "mouse") {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // An optimisation, not a requirement.
        }
      }
      // Fingers navigate, the stylus draws, and neither does the other's job.
      // Palm rejection then needs no heuristic at all: a palm is a touch, and a
      // touch cannot draw, whatever else is happening on the glass.
      if (e.pointerType === "touch") {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        logInput("down", e, pointersRef.current.size === 2 ? "pinch" : "pan · touch never draws");
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
          panStateRef.current = null;
        } else if (pointersRef.current.size === 1) {
          panStateRef.current = { x: e.clientX, y: e.clientY, panX: state.panX, panY: state.panY };
        }
        return;
      }

      // Pen and mouse from here. A stylus never pans and never pinches — it has
      // exactly one job.
      const inFlight = drawingRef.current;
      if (inFlight && inFlight.pointerId !== e.pointerId) {
        // The previous pointer's release never reached us: capture was refused,
        // or it came up over the rail. Close that stroke out and take this one,
        // rather than losing both.
        logInput("down", e, `closing orphan #${inFlight.pointerId}`);
        finishStrokeRef.current?.();
      }

      // Belt and braces: with nothing in flight, nothing should still be tracked.
      if (!drawingRef.current && !panStateRef.current && !pinchRef.current) {
        pointersRef.current.clear();
      }
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Laser: transient, broadcast, never stored.
      if (e.altKey) {
        const p = toMediaNorm(e.clientX, e.clientY);
        lasersRef.current = [
          ...lasersRef.current.filter((l) => l.client !== "self"),
          { ...p, color: author.color, at: Date.now(), client: "self" },
        ];
        session.send({ a: "laser", x: p.x, y: p.y, client: channel.clientId });
        logInput("down", e, "laser");
        return;
      }

      // Pan: space-drag, middle button, or the select tool. Mouse only — a
      // stylus does not pan even when the select tool is active.
      if (e.pointerType !== "pen" && (spaceRef.current || e.button === 1 || tools.tool === "select")) {
        panStateRef.current = { x: e.clientX, y: e.clientY, panX: state.panX, panY: state.panY };
        logInput("down", e, "pan (mouse)");
        return;
      }

      // The select tool is the pan tool. A stylus does not pan, so with it
      // chosen a stylus does nothing at all — it must not fall through and
      // start a stroke whose tool is "select".
      if (tools.tool === "select") {
        logInput("down", e, "ignored · select tool, stylus never pans");
        return;
      }

      const p = toMediaNorm(e.clientX, e.clientY);

      if (tools.tool === "erase") {
        void annotations.eraseAt(state.frame, p.x, p.y, 0.02);
        logInput("down", e, "erase");
        return;
      }

      if (tools.tool === "text") {
        setTextPrompt({ x: p.x, y: p.y, value: "" });
        logInput("down", e, "text");
        return;
      }

      smoother.current.reset();
      const [sx, sy] = smoother.current.push(p.x, p.y);
      drawingRef.current = {
        id: `${author.id}-${Date.now().toString(36)}`,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        points: [sx, sy],
        pressure: e.pointerType === "pen" ? [e.pressure] : [],
        sent: 0,
        tool: tools.tool as StrokeTool,
      };
      hoverRef.current = { x: p.x, y: p.y, down: true };
      logInput("down", e, `START ${tools.tool}${e.pointerType === "mouse" ? " · captured" : ""}`);
      viewer.invalidate();
    },
    [state, tools.tool, toMediaNorm, annotations, author, session, channel.clientId, viewer, logInput],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      // The stylus cursor: updated before every early return below, because a
      // hovering pen takes the "nothing in flight" path and would otherwise
      // never move.
      if (e.pointerType === "pen") {
        const h = toMediaNorm(e.clientX, e.clientY);
        hoverRef.current = { x: h.x, y: h.y, down: e.buttons !== 0 };
        viewer.invalidate();

        // If capture slipped away mid-stroke, take it back. Losing it is how a
        // letter goes missing: the remaining moves are delivered somewhere
        // else, and the first sign is the cursor freezing where the stroke
        // began.
        const el = overlayRef.current;
        const d = drawingRef.current;
        if (el && d && d.pointerId === e.pointerId && !el.hasPointerCapture(e.pointerId)) {
          try {
            el.setPointerCapture(e.pointerId);
            logInput("move", e, "recaptured — capture had slipped");
          } catch {
            // Nothing to be done; the log line above is the diagnosis either way.
          }
        }
      }

      // A stylus neither pans nor pinches, so it skips both branches outright.
      // Without this it would drive a pan that a finger had started.
      const navigates = e.pointerType !== "pen";

      // Pinch
      const pinch = pinchRef.current;
      if (navigates && pinch && pointersRef.current.size >= 2) {
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
        logInput("move", e, "pinch");
        return;
      }

      // Pan
      const pan = panStateRef.current;
      if (navigates && pan) {
        dispatch({
          a: "view",
          panX: pan.panX + (e.clientX - pan.x),
          panY: pan.panY + (e.clientY - pan.y),
        });
        logInput("move", e, "pan");
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

      // A finger has no other business here; it cannot draw.
      if (e.pointerType === "touch") {
        logInput("move", e, "drop · touch cannot draw");
        return;
      }

      const d = drawingRef.current;
      // A stroke belongs to the pointer that began it — nothing else may extend
      // it, whatever stray events arrive.
      if (!d) {
        logInput("move", e, "drop · nothing in flight");
        return;
      }
      if (d.pointerId !== e.pointerId) {
        // iPadOS gives hover and contact *different* pointer ids — hover comes
        // in as #1, contact as some large number — so an id switch mid-stroke
        // is a real possibility rather than a stray event. A pen move with the
        // tip down, while a pen stroke is in flight, is that stroke: adopt it
        // rather than dropping the rest of the letter on the floor.
        if (e.buttons !== 0 && d.pointerType === "pen") {
          logInput("move", e, `adopted · id changed from #${d.pointerId}`);
          d.pointerId = e.pointerId;
        } else {
          logInput("move", e, `drop · stroke is #${d.pointerId}`);
          return;
        }
      }

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

      logInput("move", e);

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
    [dispatch, toMediaNorm, annotations, inkColor, tools.width, author.color, session, channel.clientId, viewer, logInput],
  );

  const finishStroke = useCallback(async () => {
    const d = drawingRef.current;
    drawingRef.current = null;
    if (!d || d.points.length < 2) {
      logNote("up", `no commit · ${d ? d.points.length / 2 : 0} pts, needs 2`);
      return;
    }

    annotations.endInk(d.id);

    // A tap with a shape tool is an accident, not a zero-size rectangle.
    if (d.tool !== "pen" && d.tool !== "highlight" && d.points.length >= 4) {
      const dx = Math.abs(d.points[2] - d.points[0]);
      const dy = Math.abs(d.points[3] - d.points[1]);
      if (dx < 0.004 && dy < 0.004) {
        logNote("up", "no commit · shape tap, too small");
        viewer.invalidate();
        return;
      }
    }

    const points =
      d.tool === "pen" || d.tool === "highlight" ? simplify(d.points, 0.0012) : d.points;
    const [frameIn, frameOut] = holdRange(state.frame);

    const res = await annotations.commit({
      tool: d.tool,
      color: inkColor,
      width: tools.width,
      frameIn,
      frameOut,
      points,
      pressure: d.pressure.length === d.points.length / 2 ? d.pressure : undefined,
      layers: state.composite ? undefined : Object.keys(state.layers).filter((k) => state.layers[k]),
    } as Omit<Stroke, "localId" | "authorId">);
    logNote(
      "up",
      res.ok
        ? `SAVED id=${res.id ?? "?"} · ${res.points} pts on frame ${res.frame}`
        : `NOT SAVED · ${res.why}`,
    );
    viewer.invalidate();
  }, [annotations, holdRange, state, inkColor, tools.width, viewer, logNote]);

  finishStrokeRef.current = () => void finishStroke();

  /**
   * Cancel is the interesting one: the system taking a gesture away is exactly
   * how a stroke disappears without anybody doing anything wrong. It must not
   * be logged as an ordinary release.
   */
  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      logInput("cancel", e, "system took gesture");
      onPointerUpRef.current?.(e);
    },
    [logInput],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;

      if (e.pointerType === "touch") {
        logInput("up", e, "touch · nav only");
        // Lifting one of two fingers: keep panning from the one still down,
        // re-anchored, rather than stopping dead until both are lifted.
        const rest = [...pointersRef.current.values()];
        panStateRef.current =
          rest.length === 1
            ? { x: rest[0].x, y: rest[0].y, panX: state.panX, panY: state.panY }
            : null;
        return; // a finger never ends a stroke
      }

      // Only the pointer that started the stroke may end it.
      const d = drawingRef.current;
      if (d && d.pointerId !== e.pointerId) {
        logInput("up", e, `ignored · stroke is #${d.pointerId}`);
        return;
      }
      logInput("up", e, d ? `END ${d.points.length / 2} pts` : "no stroke in flight");

      if (hoverRef.current) hoverRef.current = { ...hoverRef.current, down: false };
      panStateRef.current = null;
      void finishStroke();
    },
    [finishStroke, state.panX, state.panY, logInput],
  );

  /**
   * Capture taken away mid-gesture — iPadOS does this when it decides a touch
   * belongs to the system. Drop the pointer so it cannot haunt the next stroke;
   * the stroke itself is finished normally rather than abandoned.
   */
  const onLostCapture = useCallback(
    (e: React.PointerEvent) => {
      logInput("lost", e, "capture taken away");
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;
    },
    [logInput],
  );

  onPointerUpRef.current = onPointerUp;
  onPointerMoveRef.current = onPointerMove;

  /**
   * Stop iPadOS Scribble eating alternate strokes.
   *
   * Scribble watches Apple Pencil input at the system level and swallows the
   * events when a run of strokes starts to look like handwriting — which is
   * exactly what a critique note is. It does this over a `<canvas>` as happily
   * as over a text field, so nothing in the page can opt out by being the wrong
   * sort of element. The events never reach the browser at all, which is why
   * every diagnostic here showed a letter with no `down`, no moves and no
   * cancel: not dropped, never delivered.
   *
   * The documented workaround is a non-passive `touchmove` listener that calls
   * preventDefault. React attaches touch listeners passively, so this has to be
   * done by hand. WebKit bug 217430; the alternative is asking every user to
   * turn Scribble off in Settings.
   */
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const swallow = (e: TouchEvent) => e.preventDefault();
    el.addEventListener("touchmove", swallow, { passive: false });
    return () => el.removeEventListener("touchmove", swallow);
  }, []);

  /**
   * What pointer capture used to do, done by hand.
   *
   * With a stroke in flight, a pen move or release that lands on some other
   * element still belongs to that stroke — the pen wandered over the rail, or
   * off the stage edge. Without this, removing capture would truncate a stroke
   * at the boundary instead of losing it to a stale capture; both are wrong.
   * Only events the overlay did *not* receive are handled here, so nothing is
   * processed twice.
   */
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const stray = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.target === overlay) return;
      const d = drawingRef.current;
      if (!d) return;
      const ev = e as unknown as React.PointerEvent;
      if (e.type === "pointermove") onPointerMoveRef.current?.(ev);
      else onPointerUpRef.current?.(ev);
    };
    const listener = stray as EventListener;
    document.addEventListener("pointermove", listener, true);
    document.addEventListener("pointerup", listener, true);
    return () => {
      document.removeEventListener("pointermove", listener, true);
      document.removeEventListener("pointerup", listener, true);
    };
  }, []);

  /** The cursor belongs to the stage; it does not linger once the pen leaves. */
  const onPointerLeave = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType !== "pen") return;
      hoverRef.current = null;
      viewer.invalidate();
    },
    [viewer],
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
          dispatch({ a: "guides", mode: order[(order.indexOf(state.guides) + 1) % order.length] });
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
        case "d":
          setShowLog((v) => !v);
          break;

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
        ...noSelect,
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
          // Deliberately not scrollable, and this is load-bearing.
          //
          // A scroll container around the stage gives iPadOS something to
          // arbitrate: it holds pencil input back while it decides whether the
          // drag belongs to the page. A capture of a lost letter showed exactly
          // that — no contact events reached the page at all, and even the hover
          // rate collapsed from ~120 Hz to ~8 Hz for its duration.
          //
          // The stage absorbs the shortfall instead. Below its floor the
          // controls clip rather than scroll, which is the lesser evil: a
          // cramped window is rare, losing a letter mid-word is not.
          minHeight: 0,
          overflow: "hidden",
          touchAction: "none",
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
        {/* The keyboard shortcut is no use on the device this is for. */}
        <button
          onClick={() => setShowLog((v) => !v)}
          style={{ ...textButton(showLog), flexShrink: 0 }}
          title="Input log — every pointer event and what it did  D"
        >
          ⌁
        </button>
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
            onPointerCancel={onPointerCancel}
            onLostPointerCapture={onLostCapture}
            onPointerLeave={onPointerLeave}
            onPointerOut={onPointerLeave}
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

          {showLog && (
            <InputLog
              entries={logEntries}
              onClear={() => {
                logRef.current = [];
                setLogEntries([]);
              }}
              onClose={() => setShowLog(false)}
              onSend={adapter.sendDiagnostics}
            />
          )}

          {textPrompt && (
            <TextEntry
              onCancel={() => setTextPrompt(null)}
              onCommit={async (value) => {
                const [frameIn, frameOut] = holdRange(state.frame);
                setTextPrompt(null);
                if (!value.trim()) return;
                const res = await annotations.commit({
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
            guides={state.guides}
            onFlip={(h, v) => dispatch({ a: "flip", h, v })}
            onRotate={() =>
              dispatch({ a: "rotate", deg: (((state.rotate + 90) % 360) as 0 | 90 | 180 | 270) })
            }
            onZoom={setZoom}
            onGuides={(mode) => dispatch({ a: "guides", mode })}
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
            ...selectableText,
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
