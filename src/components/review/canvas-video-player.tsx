"use client";

/**
 * CanvasVideoPlayer — canvas-only alternate implementation for A/B testing.
 *
 * Architecture
 * ────────────
 * Two full-container canvas elements sit on top of each other (absolute, inset:0):
 *   1. Display canvas  — video frames drawn via requestAnimationFrame using
 *                        ctx.setTransform(scale, 0, 0, scale, tx, ty).
 *   2. Fabric canvas   — annotation strokes; uses Fabric's setViewportTransform
 *                        with the same matrix so objects stay pixel-aligned.
 *
 * There are NO CSS transforms anywhere in this component.  Pan and zoom are
 * applied exclusively via canvas/Fabric viewport transforms.
 *
 * Interaction model (Mac trackpad + iPad)
 * ───────────────────────────────────────
 *   Trackpad two-finger scroll (wheel, !ctrlKey)  → pan
 *   Trackpad pinch             (wheel, ctrlKey)   → zoom around cursor
 *   iPad two-finger drag/pinch (touch events)     → combined pan + zoom, 1-to-1
 *   Space + mouse drag                            → pan (Figma-style)
 *   Alt/Option + mouse drag                       → frame scrub
 *
 * Handle interface
 * ────────────────
 * CanvasVideoPlayerHandle merges VideoPlayerHandle and AnnotationCanvasHandle
 * so review-client can pass a single ref to both useAnnotations and the player.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Lock,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnnotationTool } from "./annotation-toolbar";

// ── Fabric loader (module-level cache) ────────────────────────────────────────
let fabricCache: typeof import("fabric") | null = null;
const loadFabric = (): Promise<typeof import("fabric")> =>
  fabricCache
    ? Promise.resolve(fabricCache)
    : import("fabric").then((m) => {
        fabricCache = m;
        return m;
      });

// ── Ramer–Douglas–Peucker stroke simplification ───────────────────────────────
function _perpDist(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function rdpSimplify(
  pts: { x: number; y: number }[],
  epsilon: number,
): { x: number; y: number }[] {
  if (pts.length <= 2) return pts;
  let maxD = 0;
  let maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = _perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      maxI = i;
    }
  }
  if (maxD > epsilon) {
    return [
      ...rdpSimplify(pts.slice(0, maxI + 1), epsilon).slice(0, -1),
      ...rdpSimplify(pts.slice(maxI), epsilon),
    ];
  }
  return [pts[0], pts[pts.length - 1]];
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface CanvasVideoPlayerHandle {
  // Video operations
  pause(): void;
  play(): void;
  seekToFrame(frame: number): void;
  // Annotation operations — mirrors AnnotationCanvasHandle so useAnnotations works
  loadFrame(json: string | null): Promise<boolean>;
  getCurrentJSON(): string | null;
  undo(): void;
  clear(): void;
  hasContent(): boolean;
}

interface CanvasVideoPlayerProps {
  src: string;
  fps?: number;
  zoom?: number;
  // Annotation tool props (owned here, not passed via annotationOverlay ReactNode)
  tool: AnnotationTool;
  color: string;
  strokeWidth: number;
  onDirty: () => void;
  onCanvasReady?: () => void;
  // Video playback
  annotatedFrames?: Set<number>;
  hasPrevAnnotation?: boolean;
  hasNextAnnotation?: boolean;
  onZoomChange?: (zoom: number) => void;
  onPrevAnnotation?: () => void;
  onNextAnnotation?: () => void;
  onFrameChange?: (frame: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  onReady?: (width: number, height: number, duration: number, fps: number) => void;
}

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
const MAX_VIDEO_DIM = 1920;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

export const CanvasVideoPlayer = forwardRef<
  CanvasVideoPlayerHandle,
  CanvasVideoPlayerProps
>(function CanvasVideoPlayer(
  {
    src,
    fps: fpsProp = 30,
    zoom = 1,
    tool,
    color,
    strokeWidth,
    onDirty,
    onCanvasReady,
    annotatedFrames,
    hasPrevAnnotation,
    hasNextAnnotation,
    onZoomChange,
    onPrevAnnotation,
    onNextAnnotation,
    onFrameChange,
    onPlayStateChange,
    onReady,
  },
  ref,
) {
  // ── DOM refs ────────────────────────────────────────────────────────────────
  const hiddenVideoRef = useRef<HTMLVideoElement>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  /** The <canvas> element we hand to Fabric. */
  const fabricCanvasElRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // ── Fabric state ────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricRef = useRef<any>(null);
  const undoStackRef = useRef<string[]>([]);
  const suppressHistoryRef = useRef(false);
  const isDrawingShapeRef = useRef(false);
  const shapeStartRef = useRef({ x: 0, y: 0 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeShapeRef = useRef<any>(null);
  /** Pending annotation to load once Fabric fires onReady (undefined = nothing pending). */
  const pendingAnnotationRef = useRef<string | null | undefined>(undefined);

  // ── Playback state ──────────────────────────────────────────────────────────
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fps, setFps] = useState(fpsProp);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1);

  // Notify caller when play/pause state changes (used for cross-device sync)
  const onPlayStateChangeRef = useRef(onPlayStateChange);
  onPlayStateChangeRef.current = onPlayStateChange;
  useEffect(() => { onPlayStateChangeRef.current?.(playing); }, [playing]);
  const [scrubbing, setScrubbing] = useState(false);
  const [altHeld, setAltHeld] = useState(false);
  const [altScrubbing, setAltScrubbing] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panDragging, setPanDragging] = useState(false);

  // ── Hold mode ────────────────────────────────────────────────────────────
  // When on, drawing an annotation freezes the visible frame (playback keeps
  // decoding/advancing underneath) until playback time reaches another frame
  // that also has an annotation, at which point display jumps to it.
  const [holdMode, setHoldMode] = useState(false);
  const [holding, setHolding] = useState(false);
  const holdModeRef = useRef(holdMode);
  const holdingRef = useRef(false);
  const heldFrameRef = useRef<number | null>(null);
  /** Offscreen snapshot of the video image at the moment hold started. */
  const heldCanvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => { holdModeRef.current = holdMode; }, [holdMode]);

  // ── Layout / transform state ────────────────────────────────────────────────
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  /** Pan offset in pixels relative to the centred-fit position (at zoom 1). */
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // ── Stable refs for use inside event handlers and the rAF loop ──────────────
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef(-1);
  const altScrubStartRef = useRef({ x: 0, time: 0 });
  const panDragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  const prevZoomRef = useRef(zoom);
  const pendingInternalZoomRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const videoSizeRef = useRef({ width: 0, height: 0 });
  const containerSizeRef = useRef({ width: 0, height: 0 });
  // Keep latest tool/color/strokeWidth accessible inside async Fabric init
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const strokeWidthRef = useRef(strokeWidth);

  // Keep refs in sync with state / props
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { videoSizeRef.current = videoSize; }, [videoSize]);
  useEffect(() => { containerSizeRef.current = containerSize; }, [containerSize]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { strokeWidthRef.current = strokeWidth; }, [strokeWidth]);

  // ── Viewport transform computation ──────────────────────────────────────────
  /**
   * Returns the 2-D canvas transform that maps video-space → container-space.
   *
   *   screen = object * scale + (tx, ty)
   *
   * where (tx, ty) centres the video inside the container and applies pan.
   */
  function computeTransform() {
    const vs = videoSizeRef.current;
    const cs = containerSizeRef.current;
    if (!vs.width || !cs.width) return null;
    const fitScale = Math.min(cs.width / vs.width, cs.height / vs.height);
    const scale = fitScale * zoomRef.current;
    const tx = (cs.width - vs.width * scale) / 2 + panRef.current.x;
    const ty = (cs.height - vs.height * scale) / 2 + panRef.current.y;
    return { scale, tx, ty };
  }

  /** Apply current viewport to the Fabric canvas (synchronous, no state). */
  function applyViewportTransform() {
    const fc = fabricRef.current;
    if (!fc) return;
    const t = computeTransform();
    if (!t) return;
    fc.setViewportTransform([t.scale, 0, 0, t.scale, t.tx, t.ty]);
  }

  // ── Display canvas rAF helpers ───────────────────────────────────────────────
  function drawFrame() {
    const canvas = displayCanvasRef.current;
    const video = hiddenVideoRef.current;
    if (!canvas || !video || video.readyState < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const t = computeTransform();
    if (!t) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.setTransform(t.scale, 0, 0, t.scale, t.tx, t.ty);
    // While holding, keep painting the frozen snapshot instead of the (still
    // advancing) live video frame — the underlying video keeps decoding.
    const source = holdingRef.current && heldCanvasRef.current ? heldCanvasRef.current : video;
    ctx.drawImage(source, 0, 0, videoSizeRef.current.width, videoSizeRef.current.height);
    ctx.restore();
  }

  // ── Hold mode helpers ─────────────────────────────────────────────────────
  /** Snapshot the currently-displayed video image into an offscreen canvas. */
  function captureHeldSnapshot() {
    const video = hiddenVideoRef.current;
    const vs = videoSizeRef.current;
    if (!video || !vs.width || !vs.height) return;
    let snap = heldCanvasRef.current;
    if (!snap) {
      snap = document.createElement("canvas");
      heldCanvasRef.current = snap;
    }
    if (snap.width !== vs.width) snap.width = vs.width;
    if (snap.height !== vs.height) snap.height = vs.height;
    const ctx = snap.getContext("2d");
    ctx?.drawImage(video, 0, 0, vs.width, vs.height);
  }

  /** Begin holding display at the frame currently on screen. */
  function startHold() {
    if (!holdModeRef.current || holdingRef.current) return;
    heldFrameRef.current = lastFrameRef.current;
    captureHeldSnapshot();
    holdingRef.current = true;
    setHolding(true);
  }

  /** Release hold — display resumes tracking the live video frame. */
  function releaseHold() {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    heldFrameRef.current = null;
    heldCanvasRef.current = null;
    setHolding(false);
  }

  function stopRaf() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }

  function startRaf() {
    stopRaf();
    const loop = () => {
      drawFrame();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  // ── Fabric canvas helpers ─────────────────────────────────────────────────────
  function pushHistory() {
    const fc = fabricRef.current;
    if (!fc || suppressHistoryRef.current) return;
    undoStackRef.current.push(JSON.stringify(fc.toJSON()));
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
  }

  // ── Imperative handle ────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    // ── Video ──
    pause: () => {
      hiddenVideoRef.current?.pause();
      setPlaying(false);
    },
    play: () => {
      void hiddenVideoRef.current?.play();
      setPlaying(true);
    },
    seekToFrame: (frame: number) => {
      const v = hiddenVideoRef.current;
      if (!v) return;
      releaseHold();
      v.currentTime = frame / fps;
    },

    // ── Annotation ──
    loadFrame: async (json: string | null): Promise<boolean> => {
      const fc = fabricRef.current;
      if (!fc) {
        // Canvas not ready — queue for when onCanvasReady fires
        pendingAnnotationRef.current = json;
        return false;
      }
      suppressHistoryRef.current = true;
      undoStackRef.current = [];
      fc.clear();
      if (json) {
        try {
          const parsed = typeof json === "string" ? JSON.parse(json) : json;
          await fc.loadFromJSON(parsed);
          fc.renderAll();
        } catch {
          // ignore malformed JSON
        }
      }
      suppressHistoryRef.current = false;
      return true;
    },
    getCurrentJSON: (): string | null => {
      const fc = fabricRef.current;
      if (!fc) return null;
      const json = fc.toJSON();
      if (!json.objects || json.objects.length === 0) return null;
      return JSON.stringify(json);
    },
    undo: () => {
      const fc = fabricRef.current;
      if (!fc || undoStackRef.current.length === 0) return;
      suppressHistoryRef.current = true;
      const prev = undoStackRef.current.pop()!;
      fc.loadFromJSON(JSON.parse(prev)).then(() => {
        fc.renderAll();
        suppressHistoryRef.current = false;
      });
    },
    clear: () => {
      const fc = fabricRef.current;
      if (!fc) return;
      pushHistory();
      fc.clear();
      fc.renderAll();
      onDirty();
    },
    hasContent: (): boolean => {
      const fc = fabricRef.current;
      if (!fc) return false;
      return (fc.getObjects?.() ?? []).length > 0;
    },
  }));

  // ── Container size: sync on mount ────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (width > 0 && height > 0) {
      setContainerSize({ width, height });
      containerSizeRef.current = { width, height };
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainerSize({ width, height });
      containerSizeRef.current = { width, height };
      // Resize Fabric canvas to match container
      const fc = fabricRef.current;
      if (fc) {
        fc.setDimensions({ width, height });
        applyViewportTransform();
        fc.renderAll();
      }
      // Resize display canvas
      const dc = displayCanvasRef.current;
      if (dc) {
        dc.width = width;
        dc.height = height;
        drawFrame();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reset when src changes ───────────────────────────────────────────────────
  useEffect(() => {
    setVideoSize({ width: 0, height: 0 });
    videoSizeRef.current = { width: 0, height: 0 };
    setCurrentTime(0);
    setDuration(0);
    setPlaying(false);
    setPan({ x: 0, y: 0 });
    panRef.current = { x: 0, y: 0 };
    lastFrameRef.current = -1;
    releaseHold();
    stopRaf();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // ── Cached-video fix: loadedmetadata may have fired before React attached ──
  // Declared AFTER the src-reset effect so it runs last on mount, overwriting
  // the zero state with the real video dimensions if already available.
  useEffect(() => {
    const v = hiddenVideoRef.current;
    if (!v || v.readyState < 1 || !v.videoWidth) return;
    handleLoadedMetadata();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── rAF loop: start/stop with playing state ──────────────────────────────────
  useEffect(() => {
    if (playing) {
      startRaf();
    } else {
      stopRaf();
      drawFrame();
    }
    return stopRaf;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => stopRaf, []);

  // ── Fabric canvas initialisation ─────────────────────────────────────────────
  // Reruns whenever containerSize changes so the Fabric canvas is correctly sized.
  // Once Fabric is already alive we just resize it; we only init from scratch once.
  useEffect(() => {
    const { width, height } = containerSize;
    if (!width || !height || !fabricCanvasElRef.current) return;
    if (fabricRef.current) {
      // Already initialised — just resize + re-apply transform
      fabricRef.current.setDimensions({ width, height });
      applyViewportTransform();
      fabricRef.current.renderAll();
      return;
    }

    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fc: any;

    (async () => {
      const fabric = await loadFabric();
      if (cancelled || !fabricCanvasElRef.current) return;

      fc = new fabric.Canvas(fabricCanvasElRef.current, {
        width,
        height,
        isDrawingMode: false,
        selection: false,
      });

      // Position the Fabric wrapper so getBoundingClientRect() matches the container.
      // Fabric inserts a wrapping <div> around the two canvas elements; give it the
      // same absolute-inset layout the raw canvas element has.
      const wrapper = fc.wrapperEl as HTMLElement | undefined;
      if (wrapper) {
        Object.assign(wrapper.style, {
          position: "absolute",
          inset: "0",
          width: "100%",
          height: "100%",
        });
      }

      fabricRef.current = fc;

      // Apply initial viewport so newly drawn objects appear at the right position
      applyViewportTransform();

      // Brush
      const brush = new fabric.PencilBrush(fc);
      brush.color = colorRef.current;
      brush.width = strokeWidthRef.current;
      fc.freeDrawingBrush = brush;
      fc.isDrawingMode = toolRef.current === "pen";
      fc.selection = toolRef.current === "select";

      // History / dirty events
      fc.on("path:created", (e: any) => {
        onDirty();
        // RDP simplification
        const path = e.path;
        if (!path?.path || path.path.length < 4) return;
        const pts: { x: number; y: number }[] = (path.path as any[][]).map((cmd) => ({
          x: cmd[cmd.length - 2] as number,
          y: cmd[cmd.length - 1] as number,
        }));
        const simplified = rdpSimplify(pts, 2.5);
        if (simplified.length >= pts.length) return;
        const newPath: any[][] = [["M", simplified[0].x, simplified[0].y]];
        for (let i = 1; i < simplified.length - 1; i++) {
          const c = simplified[i];
          const n = simplified[i + 1];
          newPath.push(["Q", c.x, c.y, (c.x + n.x) / 2, (c.y + n.y) / 2]);
        }
        newPath.push(["L", simplified[simplified.length - 1].x, simplified[simplified.length - 1].y]);
        path.path = newPath;
        path.setCoords?.();
        fc.renderAll();
      });
      fc.on("object:added", () => { if (!suppressHistoryRef.current) { onDirty(); startHold(); } });
      fc.on("object:modified", () => { if (!suppressHistoryRef.current) { onDirty(); startHold(); } });
      fc.on("object:removed", () => { if (!suppressHistoryRef.current) onDirty(); });

      // If a loadFrame() call arrived before Fabric was ready, honour it now
      const pending = pendingAnnotationRef.current;
      if (pending !== undefined) {
        pendingAnnotationRef.current = undefined;
        suppressHistoryRef.current = true;
        if (pending) {
          try {
            await fc.loadFromJSON(JSON.parse(pending));
            fc.renderAll();
          } catch { /* ignore */ }
        }
        suppressHistoryRef.current = false;
      }

      onCanvasReady?.();
    })();

    return () => {
      cancelled = true;
      fc?.dispose();
      fabricRef.current = null;
      undoStackRef.current = [];
    };
  // Only create the Fabric instance once (when the container first becomes non-zero).
  // Subsequent container size changes are handled by the ResizeObserver above
  // which calls setWidth/setHeight on the live canvas instead of recreating it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!(containerSize.width && containerSize.height)]);

  // ── Sync tool changes to Fabric ───────────────────────────────────────────────
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    fc.off("mouse:down");
    fc.off("mouse:move");
    fc.off("mouse:up");
    isDrawingShapeRef.current = false;
    activeShapeRef.current = null;

    fc.isDrawingMode = tool === "pen";
    fc.selection = tool === "select";
    fc.getObjects?.().forEach((obj: any) => { obj.selectable = tool === "select"; });

    if (tool === "pen") {
      if (fc.freeDrawingBrush) {
        fc.freeDrawingBrush.color = color;
        fc.freeDrawingBrush.width = strokeWidth;
      }
      return;
    }

    if (tool === "text") {
      fc.on("mouse:down", async (opt: any) => {
        const fabric = await loadFabric();
        const ptr = fc.getViewportPoint(opt.e);
        pushHistory();
        const text = new fabric.IText("Edit text", {
          left: ptr.x,
          top: ptr.y,
          fill: color,
          fontSize: 18,
          fontFamily: "Arial, sans-serif",
          editable: true,
        });
        fc.add(text);
        fc.setActiveObject(text);
        text.enterEditing?.();
        text.selectAll?.();
        fc.renderAll();
      });
      return;
    }

    if (tool === "rect" || tool === "circle" || tool === "arrow") {
      fc.on("mouse:down", async (opt: any) => {
        if (opt.target) return;
        const fabric = await loadFabric();
        const ptr = fc.getViewportPoint(opt.e);
        pushHistory();
        isDrawingShapeRef.current = true;
        shapeStartRef.current = { x: ptr.x, y: ptr.y };

        const shapeOpts = {
          left: ptr.x, top: ptr.y,
          fill: "transparent", stroke: color, strokeWidth,
          selectable: false, evented: false,
        };

        if (tool === "rect") {
          activeShapeRef.current = new fabric.Rect({ ...shapeOpts, width: 0, height: 0 });
        } else if (tool === "circle") {
          activeShapeRef.current = new fabric.Ellipse({ ...shapeOpts, rx: 0, ry: 0, originX: "left", originY: "top" });
        } else {
          activeShapeRef.current = new fabric.Line(
            [ptr.x, ptr.y, ptr.x, ptr.y],
            { ...shapeOpts, strokeLineCap: "round" },
          );
        }
        if (activeShapeRef.current) fc.add(activeShapeRef.current);
      });

      fc.on("mouse:move", (opt: any) => {
        if (!isDrawingShapeRef.current || !activeShapeRef.current) return;
        const ptr = fc.getViewportPoint(opt.e);
        const dx = ptr.x - shapeStartRef.current.x;
        const dy = ptr.y - shapeStartRef.current.y;
        if (tool === "rect") {
          activeShapeRef.current.set({
            width: Math.abs(dx), height: Math.abs(dy),
            left: dx < 0 ? ptr.x : shapeStartRef.current.x,
            top: dy < 0 ? ptr.y : shapeStartRef.current.y,
          });
        } else if (tool === "circle") {
          activeShapeRef.current.set({
            rx: Math.abs(dx) / 2, ry: Math.abs(dy) / 2,
            left: dx < 0 ? ptr.x : shapeStartRef.current.x,
            top: dy < 0 ? ptr.y : shapeStartRef.current.y,
          });
        } else {
          activeShapeRef.current.set({ x2: ptr.x, y2: ptr.y });
        }
        fc.renderAll();
      });

      fc.on("mouse:up", async (opt: any) => {
        if (!isDrawingShapeRef.current) return;
        isDrawingShapeRef.current = false;
        const ptr = fc.getViewportPoint(opt.e);
        const dx = ptr.x - shapeStartRef.current.x;
        const dy = ptr.y - shapeStartRef.current.y;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
          if (activeShapeRef.current) fc.remove(activeShapeRef.current);
          activeShapeRef.current = null;
          undoStackRef.current.pop();
          return;
        }
        if (tool === "arrow") {
          const fabric = await loadFabric();
          const x1 = shapeStartRef.current.x;
          const y1 = shapeStartRef.current.y;
          const angle = Math.atan2(ptr.y - y1, ptr.x - x1);
          const hLen = Math.min(20, Math.hypot(dx, dy) * 0.3);
          const headPath = `M ${ptr.x} ${ptr.y} L ${ptr.x - hLen * Math.cos(angle - 0.5)} ${ptr.y - hLen * Math.sin(angle - 0.5)} L ${ptr.x - hLen * Math.cos(angle + 0.5)} ${ptr.y - hLen * Math.sin(angle + 0.5)} Z`;
          const head = new fabric.Path(headPath, {
            fill: color, stroke: color, strokeWidth: 1,
            selectable: false, evented: false,
          });
          fc.add(head);
        }
        activeShapeRef.current = null;
        fc.renderAll();
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, color, strokeWidth]);

  // Keep brush color/width in sync without reinit
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc?.freeDrawingBrush) return;
    fc.freeDrawingBrush.color = color;
    fc.freeDrawingBrush.width = strokeWidth;
  }, [color, strokeWidth]);

  // ── Apply viewport transform whenever pan or zoom changes ─────────────────────
  // This keeps the Fabric canvas aligned with the display canvas.
  useEffect(() => {
    applyViewportTransform();
    fabricRef.current?.renderAll();
    if (!playing) drawFrame();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pan, zoom, videoSize, containerSize]);

  // ── External zoom change (zoom buttons) ──────────────────────────────────────
  useEffect(() => {
    if (pendingInternalZoomRef.current !== null) {
      pendingInternalZoomRef.current = null;
      prevZoomRef.current = zoom;
      return;
    }
    // Zoom around the view centre — scale pan proportionally
    const ratio = zoom / prevZoomRef.current;
    setPan((prev) => ({ x: prev.x * ratio, y: prev.y * ratio }));
    prevZoomRef.current = zoom;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // ── Derived values ────────────────────────────────────────────────────────────
  const isReady = videoSize.width > 0 && containerSize.width > 0;
  const currentFrame = Math.round(currentTime * fps);
  const totalFrames = Math.round(duration * fps);
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ── Wheel: pan or zoom around cursor ──────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      // Cursor relative to container centre
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;

      if (e.ctrlKey) {
        // Trackpad pinch / Ctrl+scroll → zoom around cursor
        const prevZoom = zoomRef.current;
        const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prevZoom * Math.exp(-e.deltaY / 300)));
        const ratio = newZoom / prevZoom;
        const p = panRef.current;
        // Keep the content point under the cursor stationary after zoom
        const newPan = {
          x: cx * (1 - ratio) + p.x * ratio,
          y: cy * (1 - ratio) + p.y * ratio,
        };
        pendingInternalZoomRef.current = newZoom;
        panRef.current = newPan;
        setPan(newPan);
        onZoomChange?.(newZoom);
      } else {
        // Two-finger scroll → pan
        const newPan = {
          x: panRef.current.x - e.deltaX,
          y: panRef.current.y - e.deltaY,
        };
        panRef.current = newPan;
        setPan(newPan);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Touch: 2-finger simultaneous pan + pinch (iPad) ──────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let initPan = { x: 0, y: 0 };
    let initZoom = 1;
    let initMid = { x: 0, y: 0 };
    let initDist = 1;
    let active = false;

    function getMidDist(e: TouchEvent) {
      // el is non-null here: guarded by `if (!el) return` above
      const rect = el!.getBoundingClientRect();
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      return {
        mid: {
          x: (t0.clientX + t1.clientX) / 2 - rect.left - rect.width / 2,
          y: (t0.clientY + t1.clientY) / 2 - rect.top - rect.height / 2,
        },
        dist: Math.max(1, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY)),
      };
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      active = true;
      initPan = { ...panRef.current };
      initZoom = zoomRef.current;
      const { mid, dist } = getMidDist(e);
      initMid = mid;
      initDist = dist;
    }

    function onTouchMove(e: TouchEvent) {
      if (!active || e.touches.length !== 2) return;
      e.preventDefault();
      const { mid, dist } = getMidDist(e);
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, initZoom * (dist / initDist)));
      const ratio = newZoom / initZoom;
      // Single formula handles both pan and pinch simultaneously:
      // keeps the content point under initMid fixed at mid
      const newPan = {
        x: mid.x - (initMid.x - initPan.x) * ratio,
        y: mid.y - (initMid.y - initPan.y) * ratio,
      };
      pendingInternalZoomRef.current = newZoom;
      panRef.current = newPan;
      setPan(newPan);
      onZoomChange?.(newZoom);
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) active = false;
    }

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Space key (pan mode) ──────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
      if (e.code === "Space") { e.preventDefault(); setSpaceHeld(true); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setSpaceHeld(false); };
    const blur = () => setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // ── Space+drag / middle-mouse drag: pan ───────────────────────────────────────
  useEffect(() => {
    if (!panDragging) return;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    const move = (e: MouseEvent) => {
      const newPan = {
        x: panDragStartRef.current.panX + e.clientX - panDragStartRef.current.x,
        y: panDragStartRef.current.panY + e.clientY - panDragStartRef.current.y,
      };
      panRef.current = newPan;
      setPan(newPan);
    };
    const up = () => setPanDragging(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [panDragging]);

  // ── Alt/Option key ────────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.altKey) setAltHeld(true); };
    const up = (e: KeyboardEvent) => { if (!e.altKey) setAltHeld(false); };
    const blur = () => setAltHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // ── Alt-drag scrub ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!altScrubbing) return;
    document.body.style.userSelect = "none";
    const move = (e: MouseEvent) => {
      const v = hiddenVideoRef.current;
      if (!v) return;
      const deltaTime = (e.clientX - altScrubStartRef.current.x) / (8 * fps);
      const newTime = Math.max(0, Math.min(v.duration, altScrubStartRef.current.time + deltaTime));
      v.currentTime = newTime;
      setCurrentTime(newTime);
      const frame = Math.round(newTime * fps);
      if (frame !== lastFrameRef.current) {
        lastFrameRef.current = frame;
        onFrameChange?.(frame);
      }
    };
    const up = () => { setAltScrubbing(false); document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [altScrubbing, fps, onFrameChange]);

  // ── Video events ──────────────────────────────────────────────────────────────
  function handleLoadedMetadata() {
    const v = hiddenVideoRef.current;
    if (!v) return;
    setDuration(v.duration);
    const nw = v.videoWidth;
    const nh = v.videoHeight;
    const capS = Math.min(1, MAX_VIDEO_DIM / Math.max(nw, nh, 1));
    const cw = Math.round(nw * capS);
    const ch = Math.round(nh * capS);
    setVideoSize({ width: cw, height: ch });
    videoSizeRef.current = { width: cw, height: ch };
    setFps(fpsProp);
    onReady?.(cw, ch, v.duration, fpsProp);
    v.currentTime = 0;
  }

  function handleTimeUpdate() {
    const v = hiddenVideoRef.current;
    if (!v || scrubbing) return;
    const t = v.currentTime;
    setCurrentTime(t);
    const frame = Math.round(t * fps);

    if (holdingRef.current) {
      // Display stays frozen; underlying playback keeps advancing. Only
      // release once time reaches a *different* frame that itself has an
      // annotation — that's the frame we jump display to.
      if (frame !== heldFrameRef.current && annotatedFrames?.has(frame)) {
        releaseHold();
        lastFrameRef.current = frame;
        onFrameChange?.(frame);
        drawFrame();
      }
      return;
    }

    if (!playingRef.current) drawFrame();
    if (frame !== lastFrameRef.current) {
      lastFrameRef.current = frame;
      onFrameChange?.(frame);
    }
  }

  function handleSeeked() {
    if (!playingRef.current) drawFrame();
  }

  function handleCanPlay() {
    if (!playingRef.current) drawFrame();
  }

  function handleEnded() {
    if (!loop) { setPlaying(false); stopRaf(); }
    drawFrame();
  }

  // ── Playback controls ─────────────────────────────────────────────────────────
  function togglePlay() {
    const v = hiddenVideoRef.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); }
    else { v.play(); setPlaying(true); }
  }

  function stepFrame(delta: 1 | -1) {
    const v = hiddenVideoRef.current;
    if (!v) return;
    releaseHold();
    v.pause(); setPlaying(false);
    const newTime = Math.max(0, Math.min(v.duration, v.currentTime + delta / fps));
    v.currentTime = newTime;
    setCurrentTime(newTime);
    const frame = Math.round(newTime * fps);
    lastFrameRef.current = frame;
    onFrameChange?.(frame);
  }

  function seekToStart() {
    const v = hiddenVideoRef.current;
    if (!v) return;
    releaseHold();
    v.pause(); setPlaying(false);
    v.currentTime = 0; setCurrentTime(0);
    lastFrameRef.current = 0;
    onFrameChange?.(0);
  }

  function seekToEnd() {
    const v = hiddenVideoRef.current;
    if (!v) return;
    releaseHold();
    v.pause(); setPlaying(false);
    v.currentTime = v.duration;
  }

  function startAltScrub(e: React.MouseEvent) {
    const v = hiddenVideoRef.current;
    if (!v) return;
    e.preventDefault();
    releaseHold();
    v.pause(); setPlaying(false);
    altScrubStartRef.current = { x: e.clientX, time: v.currentTime };
    setAltScrubbing(true);
  }

  function setPlaybackSpeed(s: number) {
    setSpeed(s);
    if (hiddenVideoRef.current) hiddenVideoRef.current.playbackRate = s;
  }

  function toggleLoop() {
    const next = !loop;
    setLoop(next);
    if (hiddenVideoRef.current) hiddenVideoRef.current.loop = next;
  }

  // ── Timeline scrubbing ────────────────────────────────────────────────────────
  const seekFromPointer = useCallback(
    (clientX: number) => {
      const el = timelineRef.current;
      const v = hiddenVideoRef.current;
      if (!el || !v || !isFinite(v.duration) || v.duration === 0) return;
      releaseHold();
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const newTime = ratio * v.duration;
      v.currentTime = newTime;
      setCurrentTime(newTime);
      const frame = Math.round(newTime * fps);
      lastFrameRef.current = frame;
      onFrameChange?.(frame);
    },
    [fps, onFrameChange],
  );

  useEffect(() => {
    if (!scrubbing) return;
    document.body.style.userSelect = "none";
    const move = (e: MouseEvent | TouchEvent) => {
      const x = "touches" in e ? e.touches[0].clientX : e.clientX;
      seekFromPointer(x);
    };
    const up = () => { setScrubbing(false); document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", move);
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
    return () => {
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchend", up);
    };
  }, [scrubbing, seekFromPointer]);

  // ── Timeline tick marks ───────────────────────────────────────────────────────
  const timelineTicks = (() => {
    if (totalFrames <= 0) return null;
    const candidates = [1, 2, 5, 10, 24, 30, 48, 60, 100, 120, 240, 300, 600, 1200];
    const interval =
      candidates.find((i) => totalFrames / i <= 14) ?? Math.ceil(totalFrames / 12);
    const items = [];
    for (let f = 0; f <= totalFrames; f += interval) {
      const x = (f / totalFrames) * 100;
      items.push(
        <div key={f} className="absolute top-0 bottom-0" style={{ left: `${x}%` }}>
          <div className="w-px h-3 bg-white/10" />
        </div>,
      );
      items.push(
        <span
          key={`l${f}`}
          className="absolute top-1 text-[10px] leading-none tabular-nums text-muted-foreground/50 pl-1"
          style={{ left: `${x}%` }}
        >
          {f}
        </span>,
      );
    }
    return items;
  })();

  function formatTime(sec: number) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const f = Math.round((sec % 1) * fps);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(f).padStart(2, "0")}`;
  }

  // ── Container pointer-down ────────────────────────────────────────────────────
  function handleContainerMouseDown(e: React.MouseEvent) {
    if (altHeld) { startAltScrub(e); return; }
    if (spaceHeld || e.button === 1) {
      e.preventDefault();
      panDragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      setPanDragging(true);
    }
    // Left-click with no modifier: let the Fabric canvas handle drawing
  }

  const containerCursor = altHeld && !altScrubbing
    ? "ew-resize"
    : panDragging ? "grabbing"
    : spaceHeld ? "grab"
    : "default";

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col w-full h-full">
      {/* ── Video + annotation area ────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 bg-black overflow-hidden relative"
        style={{ cursor: containerCursor }}
        onMouseDown={handleContainerMouseDown}
      >
        {/* Decoding-only video element — never shown */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={hiddenVideoRef}
          src={src}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onSeeked={handleSeeked}
          onCanPlay={handleCanPlay}
          onEnded={handleEnded}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          preload="metadata"
          playsInline
          style={{ display: "none" }}
        />

        {/*
         * Display canvas — draws video frames with ctx.setTransform().
         * Sized to the container (not the video); the transform positions
         * the video content within it.
         */}
        <canvas
          ref={displayCanvasRef}
          width={containerSize.width}
          height={containerSize.height}
          style={{ position: "absolute", inset: 0, display: "block" }}
        />

        {/*
         * Fabric annotation canvas — same container size as the display canvas.
         * setViewportTransform() maps video-space object coordinates to the same
         * screen position as the video pixels drawn on the display canvas.
         *
         * Fabric wraps this element in its own container div; we style that div
         * to be absolute/inset:0 during initialization so getBoundingClientRect()
         * returns the correct offset for pointer-event mapping.
         */}
        <canvas
          ref={fabricCanvasElRef}
          style={{ position: "absolute", inset: 0, display: "block" }}
        />

        {!isReady && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs pointer-events-none">
            Loading…
          </div>
        )}

        {/* Alt-drag scrub overlay — sits above the Fabric canvas */}
        {altHeld && (
          <div
            className="absolute inset-0 cursor-ew-resize"
            style={{ zIndex: 40 }}
            onMouseDown={startAltScrub}
            title="Drag left/right to scrub"
          />
        )}

        {/* Space-held pan overlay */}
        {spaceHeld && !panDragging && (
          <div
            className="absolute inset-0 cursor-grab"
            style={{ zIndex: 30 }}
            onMouseDown={(e) => {
              e.preventDefault();
              panDragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
              setPanDragging(true);
            }}
          />
        )}
      </div>

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-background border-t px-3 py-2 space-y-2">
        {/* Frame ruler */}
        <div
          ref={timelineRef}
          className="relative select-none cursor-col-resize overflow-hidden rounded bg-[oklch(0.085_0_0)] border border-white/5"
          style={{ height: 48 }}
          onMouseDown={(e) => { e.preventDefault(); setScrubbing(true); seekFromPointer(e.clientX); }}
          onTouchStart={(e) => { setScrubbing(true); seekFromPointer(e.touches[0].clientX); }}
        >
          <div
            className="absolute inset-y-0 left-0 bg-primary/6 transition-none pointer-events-none"
            style={{ width: `${pct}%` }}
          />
          {timelineTicks}
          {annotatedFrames &&
            totalFrames > 0 &&
            Array.from(annotatedFrames).map((f) => (
              <div
                key={`ann-${f}`}
                className="absolute bottom-0 w-1 h-2 rounded-t-sm bg-primary/70 -translate-x-1/2 pointer-events-none"
                style={{ left: `${(f / totalFrames) * 100}%` }}
              />
            ))}
          <div
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
          >
            <div className="absolute top-1 left-1/2 -translate-x-1/2">
              <div className="bg-primary text-primary-foreground text-[10px] font-mono font-semibold px-1.5 py-[3px] rounded-sm leading-none whitespace-nowrap shadow-sm">
                {currentFrame}
              </div>
            </div>
            <div
              className="absolute left-1/2 -translate-x-1/2 w-px bg-primary/80"
              style={{ top: 20, bottom: 0 }}
            />
          </div>
        </div>

        {/* Buttons row */}
        <div className="flex items-center gap-1">
          <button onClick={seekToStart} title="Jump to start" className="p-1 text-muted-foreground hover:text-foreground">
            <SkipBack className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => stepFrame(-1)} title="Back 1 frame  (←)" className="p-1 text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={togglePlay}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
          </button>
          <button onClick={() => stepFrame(1)} title="Forward 1 frame  (→)" className="p-1 text-muted-foreground hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button onClick={seekToEnd} title="Jump to end" className="p-1 text-muted-foreground hover:text-foreground">
            <SkipForward className="h-3.5 w-3.5" />
          </button>

          {(onPrevAnnotation || onNextAnnotation) && (
            <div className="flex items-center gap-0.5 ml-1 pl-1.5 border-l">
              <button
                onClick={onPrevAnnotation}
                disabled={!hasPrevAnnotation}
                title="Previous annotated frame  (Shift+←)"
                className="p-1 rounded transition-colors disabled:opacity-25 text-primary hover:bg-primary/10"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
              <button
                onClick={onNextAnnotation}
                disabled={!hasNextAnnotation}
                title="Next annotated frame  (Shift+→)"
                className="p-1 rounded transition-colors disabled:opacity-25 text-primary hover:bg-primary/10"
              >
                <ChevronsRight className="h-4 w-4" />
              </button>
            </div>
          )}

          <button
            onClick={() => {
              const next = !holdMode;
              setHoldMode(next);
              if (!next) releaseHold();
            }}
            title={
              holding
                ? "Hold mode: frame held until playback reaches the next annotated frame"
                : holdMode
                ? "Hold mode on — drawing will freeze the frame"
                : "Hold mode off — drawing doesn't freeze the frame"
            }
            className={cn(
              "p-1 rounded transition-colors",
              holdMode ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground",
              holding && "animate-pulse",
            )}
          >
            <Lock className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={toggleLoop}
            title={loop ? "Loop on" : "Loop off"}
            className={cn(
              "ml-1 p-1 rounded transition-colors",
              loop ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Repeat className="h-3.5 w-3.5" />
          </button>

          <div className="ml-auto flex items-center gap-0.5">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setPlaybackSpeed(s)}
                className={cn(
                  "text-xs px-1.5 py-0.5 rounded transition-colors",
                  speed === s
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {s}×
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 ml-2 text-xs text-muted-foreground">
            <span>fps:</span>
            {[24, 30, 60].map((f) => (
              <button
                key={f}
                onClick={() => setFps(f)}
                className={cn(
                  "px-1 py-0.5 rounded",
                  fps === f ? "bg-muted text-foreground" : "hover:bg-muted/50",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Timecode */}
        <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
          <span className="flex items-center gap-1.5">
            {formatTime(currentTime)}
            {holding && (
              <span className="flex items-center gap-1 text-primary font-semibold">
                <Lock className="h-3 w-3" /> held @ {heldFrameRef.current}
              </span>
            )}
          </span>
          <span className="bg-muted px-2 py-0.5 rounded font-mono">
            frame {currentFrame} / {totalFrames}
          </span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
});
