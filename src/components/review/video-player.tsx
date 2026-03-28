"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Play,
  Pause,
  Repeat,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface VideoPlayerHandle {
  pause: () => void;
  seekToFrame: (frame: number) => void;
}

interface VideoPlayerProps {
  src: string;
  fps?: number;
  zoom?: number;
  annotationOverlay?: ReactNode;
  /** Set of frame numbers that have saved annotations — shown as markers on the ruler */
  annotatedFrames?: Set<number>;
  hasPrevAnnotation?: boolean;
  hasNextAnnotation?: boolean;
  onZoomChange?: (zoom: number) => void;
  onPrevAnnotation?: () => void;
  onNextAnnotation?: () => void;
  onFrameChange?: (frame: number) => void;
  onReady?: (width: number, height: number, duration: number, fps: number) => void;
}

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
const MAX_VIDEO_DIM = 1920;

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({
    src, fps: fpsProp = 30, zoom = 1, annotationOverlay,
    annotatedFrames, hasPrevAnnotation, hasNextAnnotation,
    onZoomChange, onPrevAnnotation, onNextAnnotation,
    onFrameChange, onReady,
  }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const timelineRef = useRef<HTMLDivElement>(null);
    const videoAreaRef = useRef<HTMLDivElement>(null);

    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [fps, setFps] = useState(fpsProp);
    const [loop, setLoop] = useState(false);
    const [speed, setSpeed] = useState(1);
    // videoSize holds capped logical dimensions (what the canvas is sized to)
    const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
    // areaSize is the available display area (from ResizeObserver)
    const [areaSize, setAreaSize] = useState({ width: 0, height: 0 });
    const [scrubbing, setScrubbing] = useState(false);
    // Alt/Option key held — enables drag-to-scrub anywhere on the video area
    const [altHeld, setAltHeld] = useState(false);
    const [altScrubbing, setAltScrubbing] = useState(false);
    const altScrubStartRef = useRef({ x: 0, time: 0 });

    const lastFrameRef = useRef(-1);

    // Zoom ref + pending scroll for zoom-around-cursor
    const zoomRef = useRef(zoom);
    useEffect(() => { zoomRef.current = zoom; }, [zoom]);
    const pendingScrollRef = useRef<{ cx: number; cy: number; ratio: number } | null>(null);

    useImperativeHandle(ref, () => ({
      pause: () => { videoRef.current?.pause(); setPlaying(false); },
      seekToFrame: (frame: number) => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = frame / fps;
      },
    }));

    // ── Read container size synchronously on mount ────────────────────────────
    // Must run before any async events (loadedmetadata) so isReady is never
    // blocked on the ResizeObserver's first async callback.
    useLayoutEffect(() => {
      const el = videoAreaRef.current;
      if (!el) return;
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setAreaSize({ width, height });
    }, []);

    // ── Track video display area size (keeps it current on resize) ────────────
    useEffect(() => {
      const el = videoAreaRef.current;
      if (!el) return;
      const ro = new ResizeObserver(([entry]) => {
        setAreaSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    // ── Reset derived state when src changes (student switch) ─────────────────
    // This hides the old video immediately so we show "Loading…" rather than
    // a black frame from the previous student's video element state.
    useEffect(() => {
      setVideoSize({ width: 0, height: 0 });
      setCurrentTime(0);
      setDuration(0);
      setPlaying(false);
      lastFrameRef.current = -1;
    }, [src]);

    // ── Cached-video fix: loadedmetadata may have fired before React attached ──
    // When the browser serves the video from cache (readyState ≥ 1 with valid
    // dimensions), the event fires synchronously before our listener is wired.
    // This effect is declared AFTER the src-reset effect so it runs after the
    // state has been zeroed — giving us the real dimensions as the final write.
    useEffect(() => {
      const v = videoRef.current;
      if (!v || v.readyState < 1 || !v.videoWidth) return;
      handleLoadedMetadata();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Scroll → zoom around cursor ───────────────────────────────────────────
    useEffect(() => {
      const el = videoAreaRef.current;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const prev = zoomRef.current;
        // Trackpad pinch sends ctrlKey with small deltas; plain scroll sends larger deltas
        const sensitivity = (e.ctrlKey || e.metaKey) ? 300 : 150;
        const next = Math.max(0.25, Math.min(4, prev * Math.exp(-e.deltaY / sensitivity)));
        pendingScrollRef.current = { cx, cy, ratio: next / prev };
        onZoomChange?.(next);
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Keep cursor-under point stationary after zoom re-renders
    useLayoutEffect(() => {
      const adj = pendingScrollRef.current;
      if (!adj) return;
      pendingScrollRef.current = null;
      const el = videoAreaRef.current;
      if (!el) return;
      el.scrollLeft = (el.scrollLeft + adj.cx) * adj.ratio - adj.cx;
      el.scrollTop  = (el.scrollTop  + adj.cy) * adj.ratio - adj.cy;
    }, [zoom]);

    // ── Alt/Option key tracker ────────────────────────────────────────────────
    useEffect(() => {
      const down = (e: KeyboardEvent) => { if (e.altKey) setAltHeld(true); };
      const up   = (e: KeyboardEvent) => { if (!e.altKey) setAltHeld(false); };
      const blur = () => setAltHeld(false); // window lost focus — key state unknown
      window.addEventListener("keydown", down);
      window.addEventListener("keyup",   up);
      window.addEventListener("blur",    blur);
      return () => {
        window.removeEventListener("keydown", down);
        window.removeEventListener("keyup",   up);
        window.removeEventListener("blur",    blur);
      };
    }, []);

    // ── Alt-drag scrub (global move/up while altScrubbing) ────────────────────
    useEffect(() => {
      if (!altScrubbing) return;
      document.body.style.userSelect = "none";
      const move = (e: MouseEvent) => {
        const v = videoRef.current;
        if (!v) return;
        // 8 px per frame — precise, like Blender's T-drag
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
      const up = () => {
        setAltScrubbing(false);
        document.body.style.userSelect = "";
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup",   up);
      return () => {
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup",   up);
      };
    }, [altScrubbing, fps, onFrameChange]);

    // ── Derived values ────────────────────────────────────────────────────────
    const currentFrame = Math.round(currentTime * fps);
    const totalFrames = Math.round(duration * fps);
    const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

    // isReady: both layout size and video dimensions are known
    const isReady = videoSize.width > 0 && areaSize.width > 0;

    // Scale to fit area, then apply user zoom
    const fitScale =
      isReady
        ? Math.min(areaSize.width / videoSize.width, areaSize.height / videoSize.height)
        : 1;
    const totalScale = fitScale * zoom;
    const scaledVW = videoSize.width * totalScale;
    const scaledVH = videoSize.height * totalScale;
    // Center offset: push to middle when content is smaller than the area
    const offsetX = Math.max(0, (areaSize.width - scaledVW) / 2);
    const offsetY = Math.max(0, (areaSize.height - scaledVH) / 2);

    function formatTime(sec: number) {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      const f = Math.round((sec % 1) * fps);
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(f).padStart(2, "0")}`;
    }

    // ── Video events ──────────────────────────────────────────────────────────
    function handleLoadedMetadata() {
      const v = videoRef.current;
      if (!v) return;
      setDuration(v.duration);
      // Cap to MAX_VIDEO_DIM on the longest side so the Fabric canvas isn't huge
      const nw = v.videoWidth;
      const nh = v.videoHeight;
      const capS = Math.min(1, MAX_VIDEO_DIM / Math.max(nw, nh, 1));
      const cw = Math.round(nw * capS);
      const ch = Math.round(nh * capS);
      setVideoSize({ width: cw, height: ch });
      setFps(fpsProp);
      onReady?.(cw, ch, v.duration, fpsProp);
      // Seek to 0 so the browser decodes the first frame immediately,
      // eliminating the black-video flash before frame data arrives.
      v.currentTime = 0;
    }

    function handleTimeUpdate() {
      const v = videoRef.current;
      if (!v || scrubbing) return;
      const t = v.currentTime;
      setCurrentTime(t);
      const frame = Math.round(t * fps);
      if (frame !== lastFrameRef.current) {
        lastFrameRef.current = frame;
        onFrameChange?.(frame);
      }
    }

    function handleEnded() {
      if (!loop) setPlaying(false);
    }

    // ── Controls ──────────────────────────────────────────────────────────────
    function togglePlay() {
      const v = videoRef.current;
      if (!v) return;
      if (playing) { v.pause(); setPlaying(false); }
      else { v.play(); setPlaying(true); }
    }

    function stepFrame(delta: 1 | -1) {
      const v = videoRef.current;
      if (!v) return;
      v.pause();
      setPlaying(false);
      const newTime = Math.max(0, Math.min(v.duration, v.currentTime + delta / fps));
      v.currentTime = newTime;
      setCurrentTime(newTime);
      const frame = Math.round(newTime * fps);
      lastFrameRef.current = frame;
      onFrameChange?.(frame);
    }

    function seekToStart() {
      const v = videoRef.current;
      if (!v) return;
      v.pause(); setPlaying(false);
      v.currentTime = 0; setCurrentTime(0);
      lastFrameRef.current = 0;
      onFrameChange?.(0);
    }

    function seekToEnd() {
      const v = videoRef.current;
      if (!v) return;
      v.pause(); setPlaying(false);
      v.currentTime = v.duration;
    }

    function startAltScrub(e: React.MouseEvent) {
      const v = videoRef.current;
      if (!v) return;
      e.preventDefault();
      v.pause(); setPlaying(false);
      altScrubStartRef.current = { x: e.clientX, time: v.currentTime };
      setAltScrubbing(true);
    }

    function setPlaybackSpeed(s: number) {
      setSpeed(s);
      if (videoRef.current) videoRef.current.playbackRate = s;
    }

    function toggleLoop() {
      const next = !loop;
      setLoop(next);
      if (videoRef.current) videoRef.current.loop = next;
    }

    // ── Timeline scrubbing ────────────────────────────────────────────────────
    const seekFromPointer = useCallback((clientX: number) => {
      const el = timelineRef.current;
      const v = videoRef.current;
      if (!el || !v) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const newTime = ratio * v.duration;
      v.currentTime = newTime;
      setCurrentTime(newTime);
      const frame = Math.round(newTime * fps);
      lastFrameRef.current = frame;
      onFrameChange?.(frame);
    }, [fps, onFrameChange]);

    useEffect(() => {
      if (!scrubbing) return;
      // Prevent text selection / element highlighting while dragging
      document.body.style.userSelect = "none";
      const move = (e: MouseEvent | TouchEvent) => {
        const x = "touches" in e ? e.touches[0].clientX : e.clientX;
        seekFromPointer(x);
      };
      const up = () => {
        setScrubbing(false);
        document.body.style.userSelect = "";
      };
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

    // ── Timeline tick marks ───────────────────────────────────────────────────
    const timelineTicks = (() => {
      if (totalFrames <= 0) return null;
      // Pick the coarsest interval that still gives ≤ 14 labels
      const candidates = [1, 2, 5, 10, 24, 30, 48, 60, 100, 120, 240, 300, 600, 1200];
      const interval = candidates.find((i) => totalFrames / i <= 14) ?? Math.ceil(totalFrames / 12);
      const items = [];
      for (let f = 0; f <= totalFrames; f += interval) {
        const x = (f / totalFrames) * 100;
        items.push(
          <div key={f} className="absolute top-0 bottom-0" style={{ left: `${x}%` }}>
            <div className="w-px h-3 bg-white/10" />
          </div>
        );
        items.push(
          <span
            key={`l${f}`}
            className="absolute top-1 text-[10px] leading-none tabular-nums text-muted-foreground/50 pl-1"
            style={{ left: `${x}%` }}
          >
            {f}
          </span>
        );
      }
      return items;
    })();

    return (
      <div className="flex flex-col w-full h-full">
        {/* ── Video + overlay ───────────────────────────────────────────────── */}
        <div
          ref={videoAreaRef}
          className={cn("flex-1 min-h-0 bg-black", altHeld && !altScrubbing && "cursor-ew-resize")}
          style={{ overflow: "auto", position: "relative" }}
        >
          {/*
           * Single <video> element — always in the DOM at the same tree position.
           * Keeping one stable element avoids the two-branch switching pattern
           * that caused a new element to be created on every transition
           * (which starts black until the browser decodes the first frame).
           *
           * When not ready: display:none (hidden but still loading/buffering).
           * When ready: absolutely positioned with the same transform applied to
           * the annotation canvas so they stay pixel-perfect in alignment.
           */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            src={src}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            preload="metadata"
            playsInline
            style={isReady ? {
              position: "absolute",
              left: offsetX,
              top: offsetY,
              width: scaledVW,
              height: scaledVH,
              display: "block",
              userSelect: "none",
            } : { display: "none" }}
          />

          {/* Annotation overlay + scroll spacer — rendered after video in DOM
              order so the canvas stacks on top without needing explicit z-index */}
          {isReady ? (
            <>
              {/* Spacer in normal flow — defines scroll dimensions */}
              <div
                style={{
                  width: Math.max(scaledVW, areaSize.width),
                  height: Math.max(scaledVH, areaSize.height),
                }}
              />
              {/* Annotation canvas, scaled to match the video */}
              <div
                style={{
                  position: "absolute",
                  left: offsetX,
                  top: offsetY,
                  width: scaledVW,
                  height: scaledVH,
                  pointerEvents: "none", // let video handle its own events; canvas gets events via Fabric
                }}
              >
                <div
                  style={{
                    transform: `scale(${totalScale})`,
                    transformOrigin: "top left",
                    width: videoSize.width,
                    height: videoSize.height,
                    position: "relative",
                    pointerEvents: "auto",
                  }}
                >
                  {annotationOverlay && (
                    <div className="absolute inset-0">{annotationOverlay}</div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
              Loading…
            </div>
          )}

          {/* Alt/Option-drag scrub overlay — floats on top of annotation canvas */}
          {altHeld && (
            <div
              className="absolute inset-0 cursor-ew-resize"
              style={{ zIndex: 40 }}
              onMouseDown={startAltScrub}
              title="Drag left/right to scrub"
            />
          )}
        </div>

        {/* ── Controls ──────────────────────────────────────────────────────── */}
        <div className="shrink-0 bg-background border-t px-3 py-2 space-y-2">
          {/* ── Blender-style frame ruler timeline ─────────────────────────── */}
          <div
            ref={timelineRef}
            className="relative select-none cursor-col-resize overflow-hidden rounded bg-[oklch(0.085_0_0)] border border-white/5"
            style={{ height: 48 }}
            onMouseDown={(e) => { e.preventDefault(); setScrubbing(true); seekFromPointer(e.clientX); }}
            onTouchStart={(e) => { setScrubbing(true); seekFromPointer(e.touches[0].clientX); }}
          >
            {/* Subtle progress fill */}
            <div
              className="absolute inset-y-0 left-0 bg-primary/6 transition-none pointer-events-none"
              style={{ width: `${pct}%` }}
            />

            {/* Tick marks + frame number labels */}
            {timelineTicks}

            {/* Annotation markers — small orange nubs at bottom of ruler */}
            {annotatedFrames && totalFrames > 0 && Array.from(annotatedFrames).map((f) => (
              <div
                key={`ann-${f}`}
                className="absolute bottom-0 w-1 h-2 rounded-t-sm bg-primary/70 -translate-x-1/2 pointer-events-none"
                style={{ left: `${(f / totalFrames) * 100}%` }}
              />
            ))}

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 pointer-events-none"
              style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
            >
              {/* Badge */}
              <div className="absolute top-1 left-1/2 -translate-x-1/2">
                <div className="bg-primary text-primary-foreground text-[10px] font-mono font-semibold px-1.5 py-[3px] rounded-sm leading-none whitespace-nowrap shadow-sm">
                  {currentFrame}
                </div>
              </div>
              {/* Vertical line below badge */}
              <div className="absolute left-1/2 -translate-x-1/2 w-px bg-primary/80" style={{ top: 20, bottom: 0 }} />
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

            {/* Annotation jump buttons */}
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
              onClick={toggleLoop}
              title={loop ? "Loop on" : "Loop off"}
              className={cn(
                "ml-1 p-1 rounded transition-colors",
                loop ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"
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
                      : "text-muted-foreground hover:bg-muted"
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
                    fps === f ? "bg-muted text-foreground" : "hover:bg-muted/50"
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Timecode */}
          <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
            <span>{formatTime(currentTime)}</span>
            <span className="bg-muted px-2 py-0.5 rounded font-mono">
              frame {currentFrame} / {totalFrames}
            </span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>
    );
  }
);
