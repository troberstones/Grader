"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
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
  onFrameChange?: (frame: number) => void;
  onReady?: (width: number, height: number, duration: number, fps: number) => void;
}

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
const MAX_VIDEO_DIM = 1920;

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ src, fps: fpsProp = 30, zoom = 1, annotationOverlay, onFrameChange, onReady }, ref) {
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

    const lastFrameRef = useRef(-1);

    useImperativeHandle(ref, () => ({
      pause: () => { videoRef.current?.pause(); setPlaying(false); },
      seekToFrame: (frame: number) => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = frame / fps;
      },
    }));

    // ── Track video display area size ─────────────────────────────────────────
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

    // ── Derived values ────────────────────────────────────────────────────────
    const currentFrame = Math.round(currentTime * fps);
    const totalFrames = Math.round(duration * fps);
    const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

    // Scale to fit area, then apply user zoom
    const fitScale =
      videoSize.width > 0 && areaSize.width > 0 && areaSize.height > 0
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
      const move = (e: MouseEvent | TouchEvent) => {
        const x = "touches" in e ? e.touches[0].clientX : e.clientX;
        seekFromPointer(x);
      };
      const up = () => setScrubbing(false);
      window.addEventListener("mousemove", move);
      window.addEventListener("touchmove", move);
      window.addEventListener("mouseup", up);
      window.addEventListener("touchend", up);
      return () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("touchmove", move);
        window.removeEventListener("mouseup", up);
        window.removeEventListener("touchend", up);
      };
    }, [scrubbing, seekFromPointer]);

    return (
      <div className="flex flex-col w-full h-full">
        {/* ── Video + overlay ───────────────────────────────────────────────── */}
        <div
          ref={videoAreaRef}
          className="flex-1 min-h-0 bg-black"
          style={{ overflow: "auto", position: "relative" }}
        >
          {videoSize.width > 0 && areaSize.width > 0 ? (
            <>
              {/* Spacer in normal flow — defines scroll dimensions without the
                  flex justify-content:center overflow/clipping bug */}
              <div
                style={{
                  width: Math.max(scaledVW, areaSize.width),
                  height: Math.max(scaledVH, areaSize.height),
                }}
              />
              {/* Content absolutely positioned: centered when smaller, top-left when zoomed */}
              <div
                style={{
                  position: "absolute",
                  left: offsetX,
                  top: offsetY,
                  width: scaledVW,
                  height: scaledVH,
                }}
              >
                <div
                  style={{
                    transform: `scale(${totalScale})`,
                    transformOrigin: "top left",
                    width: videoSize.width,
                    height: videoSize.height,
                    position: "relative",
                  }}
                >
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video
                    ref={videoRef}
                    src={src}
                    style={{ width: videoSize.width, height: videoSize.height, display: "block" }}
                    onLoadedMetadata={handleLoadedMetadata}
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={handleEnded}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    preload="metadata"
                    playsInline
                  />
                  {annotationOverlay && (
                    <div className="absolute inset-0">{annotationOverlay}</div>
                  )}
                </div>
              </div>
            </>
          ) : (
            /* Loading placeholder — video hasn't reported dimensions yet */
            <>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                ref={videoRef}
                src={src}
                className="hidden"
                onLoadedMetadata={handleLoadedMetadata}
                preload="metadata"
              />
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
                Loading…
              </div>
            </>
          )}
        </div>

        {/* ── Controls ──────────────────────────────────────────────────────── */}
        <div className="shrink-0 bg-background border-t px-3 py-2 space-y-2">
          {/* Timeline */}
          <div
            ref={timelineRef}
            className="relative h-6 flex items-center cursor-pointer group"
            onMouseDown={(e) => { setScrubbing(true); seekFromPointer(e.clientX); }}
            onTouchStart={(e) => { setScrubbing(true); seekFromPointer(e.touches[0].clientX); }}
          >
            <div className="absolute inset-x-0 h-1.5 rounded-full bg-muted group-hover:h-2 transition-all">
              <div
                className="h-full rounded-full bg-primary transition-none"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div
              className="absolute w-3 h-3 rounded-full bg-primary shadow border-2 border-background -translate-x-1/2"
              style={{ left: `${pct}%` }}
            />
          </div>

          {/* Buttons row */}
          <div className="flex items-center gap-1">
            <button onClick={seekToStart} title="Start" className="p-1 text-muted-foreground hover:text-foreground">
              <SkipBack className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => stepFrame(-1)} title="Back 1 frame" className="p-1 text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={togglePlay}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
            </button>
            <button onClick={() => stepFrame(1)} title="Forward 1 frame" className="p-1 text-muted-foreground hover:text-foreground">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button onClick={seekToEnd} title="End" className="p-1 text-muted-foreground hover:text-foreground">
              <SkipForward className="h-3.5 w-3.5" />
            </button>

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
