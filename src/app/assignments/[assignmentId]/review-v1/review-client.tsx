"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ZoomIn, ZoomOut, Radio } from "lucide-react";
import { StudentNavBar } from "@/components/shared/student-nav-bar";
import { useGrading } from "@/components/shared/grading-context";
import { useGlobalSync } from "@/components/shared/global-sync";
import { useAnnotations } from "@/hooks/use-annotations";
import { UploadZone } from "@/components/review/upload-zone";
import { AnnotationToolbar, type AnnotationTool } from "@/components/review/annotation-toolbar";
import { AnnotationCanvas, type AnnotationCanvasHandle } from "@/components/review/annotation-canvas";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/review/video-player";
import { CanvasVideoPlayer, type CanvasVideoPlayerHandle } from "@/components/review/canvas-video-player";
import { ToneAdjustPopover, toneCssFilter, DEFAULT_TONE, type ToneAdjust } from "@/components/review/tone-adjust";
import { updateSubmissionMeta, type SubmissionRow } from "@/actions/submissions";
import type { getAssignment } from "@/actions/assignments";

type Assignment = NonNullable<Awaited<ReturnType<typeof getAssignment>>>;

interface ReviewClientProps {
  assignment: Assignment;
  initialSubmissions: Record<number, SubmissionRow[]>;
}

// Used only by the +/- buttons; trackpad pinch uses continuous exponential zoom
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const MAX_CANVAS_DIM = 2048;

export function ReviewV1Client({ assignment, initialSubmissions }: ReviewClientProps) {
  const router = useRouter();
  const {
    students,
    selectedStudentId,
    setSelectedStudentId,
    selectHandlerRef,
  } = useGrading();
  const { broadcast, subscribe } = useGlobalSync();

  // Separate flags prevent one remote event from consuming the other's echo guard.
  // e.g. a remote seek fires pause() → onPlayStateChange, which would consume a
  // shared flag before seekToFrame → onFrameChange had a chance to check it.
  const remoteSeekRef = useRef(false);   // guards onFrameChange re-broadcast
  const remotePlayRef = useRef(false);   // guards onPlayStateChange re-broadcast

  // Master flag: only the master device broadcasts playback events.
  // Prevents race conditions when both devices try to sync simultaneously.
  const [isMaster, setIsMaster] = useState(false);
  const isMasterRef = useRef(isMaster);
  isMasterRef.current = isMaster;

  const [submissions, setSubmissions] = useState<Record<number, SubmissionRow[]>>(initialSubmissions);
  const [fileIndex, setFileIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [tone, setTone] = useState<ToneAdjust>(DEFAULT_TONE);
  const [mediaSize, setMediaSize] = useState({ width: 0, height: 0 });
  /** A/B flag: false = original HTML player, true = canvas-transform player */
  const [useCanvasPlayer, setUseCanvasPlayer] = useState(false);

  // Tool state
  const [activeTool, setActiveTool] = useState<AnnotationTool>("pen");
  const [activeColor, setActiveColor] = useState("#ef4444");
  const [strokeWidth, setStrokeWidth] = useState(4);

  const canvasRef = useRef<AnnotationCanvasHandle>(null);
  const videoRef = useRef<VideoPlayerHandle>(null);
  // Combined handle for the canvas-based player (satisfies both refs structurally)
  const canvasVideoRef = useRef<CanvasVideoPlayerHandle>(null);
  const mediaAreaRef = useRef<HTMLDivElement>(null);

  /**
   * Returns the active annotation handle regardless of which player is mounted.
   * CanvasVideoPlayerHandle is a structural superset of AnnotationCanvasHandle.
   */
  function getAnnotationHandle(): AnnotationCanvasHandle | null {
    return useCanvasPlayer
      ? (canvasVideoRef.current as unknown as AnnotationCanvasHandle | null)
      : canvasRef.current;
  }

  /** Returns the active video control handle. */
  const useCanvasPlayerRef = useRef(useCanvasPlayer);
  useCanvasPlayerRef.current = useCanvasPlayer;
  function getVideoHandle(): VideoPlayerHandle | null {
    return useCanvasPlayerRef.current ? canvasVideoRef.current : videoRef.current;
  }

  const selectedStudent = students.find((s) => s.id === selectedStudentId) ?? null;
  const studentFiles = selectedStudentId ? (submissions[selectedStudentId] ?? []) : [];
  const submission = studentFiles[fileIndex] ?? null;

  // ── Annotation state — all owned by the hook ─────────────────────────────
  const {
    annotationMap,
    currentFrame,
    isDirty,
    saving,
    annotatedFrames,
    hasPrevAnnotation,
    hasNextAnnotation,
    markDirty,
    handleCanvasReady,
    handleFrameChange,
    loadForSubmission,
    handleSave,
    flushCurrentFrame,
    resetForNewMedia,
    queueAnnotationLoad,
    reloadAnnotations,
  // For canvas player the combined ref satisfies AnnotationCanvasHandle structurally
  } = useAnnotations(
    useCanvasPlayer
      ? (canvasVideoRef as unknown as RefObject<AnnotationCanvasHandle | null>)
      : canvasRef,
    // After annotations are saved locally, broadcast so other devices reload
    (submissionId) => {
      if (!selectedStudentId) return;
      broadcast({ type: "annotation-saved", assignmentId: assignment.id, studentId: selectedStudentId });
      void submissionId; // used by the hook internally
    },
  );

  // ── Zoom helpers ──────────────────────────────────────────────────────────
  const handleZoomChange = useCallback((z: number) => {
    setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)));
  }, []);

  function zoomIn() {
    setZoom((prev) => {
      const next = ZOOM_STEPS.find((z) => z > prev + 0.01);
      return next ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
    });
  }
  function zoomOut() {
    setZoom((prev) => {
      const next = [...ZOOM_STEPS].reverse().find((z) => z < prev - 0.01);
      return next ?? ZOOM_STEPS[0];
    });
  }

  // ── Cross-device sync: receive playback + annotation events ──────────────
  // Keep stable refs so we can access current state inside the subscription
  const submissionRef = useRef(submission);
  submissionRef.current = submission;

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "playback-master" && event.assignmentId === assignment.id) {
        // Another device claimed master — release control here
        setIsMaster(false);
        isMasterRef.current = false;
      } else if (event.type === "playback" && event.assignmentId === assignment.id) {
        // Only follow remote playback when this device is NOT master
        if (isMasterRef.current) return;
        if (event.playing) {
          remotePlayRef.current = true;
          getVideoHandle()?.play();
        } else {
          // Seek: guard onFrameChange only (don't call pause — that fires
          // onPlayStateChange and would consume the wrong flag)
          remoteSeekRef.current = true;
          getVideoHandle()?.seekToFrame(event.frame);
        }
      } else if (event.type === "annotation-saved" && event.assignmentId === assignment.id) {
        const sub = submissionRef.current;
        if (sub && event.studentId === selectedStudentId) {
          void reloadAnnotations(sub.id);
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, assignment.id, selectedStudentId, reloadAnnotations]);

  // ── Intercepted video callbacks that broadcast to other devices ───────────
  function handleFrameChangeWithSync(frame: number) {
    const isRemote = remoteSeekRef.current;
    remoteSeekRef.current = false;
    void handleFrameChange(frame);
    if (!isRemote && isMasterRef.current) {
      broadcast({ type: "playback", assignmentId: assignment.id, studentId: selectedStudentId ?? 0, frame, playing: false });
    }
  }

  function handlePlayStateChangeWithSync(playing: boolean) {
    if (remotePlayRef.current) {
      remotePlayRef.current = false;
      return;
    }
    if (isMasterRef.current) {
      broadcast({ type: "playback", assignmentId: assignment.id, studentId: selectedStudentId ?? 0, frame: currentFrame ?? 0, playing });
    }
  }

  function handleTakeMasterControl() {
    setIsMaster(true);
    isMasterRef.current = true;
    // Tell all other devices to release — they will stop broadcasting
    broadcast({ type: "playback-master", assignmentId: assignment.id });
  }

  // ── On mount: load first student's annotations ────────────────────────────
  useEffect(() => {
    if (!selectedStudentId) return;
    const sub = submissions[selectedStudentId]?.[0] ?? null;
    const frame = sub?.mediaType === "video" ? 0 : null;
    loadForSubmission(sub?.id ?? null, frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Student selection ─────────────────────────────────────────────────────
  async function handleStudentSelect(studentId: number) {
    if (studentId === selectedStudentId) return;
    await flushCurrentFrame(submission?.id ?? null);

    setSelectedStudentId(studentId);
    setFileIndex(0);

    const sub = submissions[studentId]?.[0] ?? null;
    const frame = sub?.mediaType === "video" ? 0 : null;
    await loadForSubmission(sub?.id ?? null, frame);
  }

  // Stable wrapper + local ref pattern so the handler never goes stale
  const selectGuardRef = useRef<(id: number) => void>(() => {});
  selectGuardRef.current = (id) => { handleStudentSelect(id); };

  useLayoutEffect(() => {
    selectHandlerRef.current = (id) => selectGuardRef.current(id);
    return () => { selectHandlerRef.current = (id) => setSelectedStudentId(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Video ready (capture logical dimensions for canvas overlay) ───────────
  async function handleVideoReady(width: number, height: number, duration: number, fps: number) {
    if (!useCanvasPlayer) {
      // HTML player: AnnotationCanvas may reinitialize Fabric if dimensions change.
      // Queue the annotation so it reloads once Fabric fires onReady.
      if (mediaSize.width > 0 && (mediaSize.width !== width || mediaSize.height !== height)) {
        const json = annotationMap.get(currentFrame) ?? null;
        queueAnnotationLoad(json);
      }
      setMediaSize({ width, height });
    }
    // Canvas player manages its own Fabric viewport — no mediaSize tracking needed.
    if (submission) {
      await updateSubmissionMeta(submission.id, {
        fps,
        duration,
        frameCount: Math.round(duration * fps),
      }).catch(() => {});
    }
  }

  // ── File upload ───────────────────────────────────────────────────────────
  async function handleUpload(file: File) {
    if (!selectedStudentId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("assignmentId", String(assignment.id));
      fd.append("studentId", String(selectedStudentId));

      const res = await fetch("/api/submissions/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Upload failed");
      }
      const { submission: newSub } = await res.json();
      setSubmissions((prev) => {
        const existing = prev[selectedStudentId] ?? [];
        const idx = existing.findIndex((s) => s.fileName === newSub.fileName);
        const updated = idx >= 0
          ? existing.map((s, i) => (i === idx ? newSub : s))
          : [...existing, newSub];
        return { ...prev, [selectedStudentId]: updated };
      });
      const newIdx = (() => {
        const files = submissions[selectedStudentId] ?? [];
        const i = files.findIndex((s) => s.fileName === newSub.fileName);
        return i >= 0 ? i : files.length;
      })();
      setFileIndex(newIdx);

      const frame = newSub.mediaType === "video" ? 0 : null;
      setMediaSize({ width: 0, height: 0 });
      resetForNewMedia(frame, newSub.id);
      await getAnnotationHandle()?.loadFrame(null);
      toast.success("Submission uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // ── Annotation frame navigation (uses hook's annotationMap) ──────────────
  function goPrevAnnotation() {
    const frames = [...annotationMap.keys()]
      .filter((k): k is number => k !== null)
      .sort((a, b) => a - b);
    const prev = [...frames].reverse().find((f) => f < (currentFrame ?? 0));
    if (prev !== undefined) getVideoHandle()?.seekToFrame(prev);
  }
  function goNextAnnotation() {
    const frames = [...annotationMap.keys()]
      .filter((k): k is number => k !== null)
      .sort((a, b) => a - b);
    const next = frames.find((f) => f > (currentFrame ?? 0));
    if (next !== undefined) getVideoHandle()?.seekToFrame(next);
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  const currentIdx = students.findIndex((s) => s.id === selectedStudentId);
  const prevStudent = currentIdx > 0 ? students[currentIdx - 1] : null;
  const nextStudent = currentIdx < students.length - 1 ? students[currentIdx + 1] : null;

  async function goToFile(index: number) {
    const files = selectedStudentId ? (submissions[selectedStudentId] ?? []) : [];
    if (index < 0 || index >= files.length) return;
    await flushCurrentFrame(submission?.id ?? null);
    setFileIndex(index);
    const sub = files[index];
    const frame = sub.mediaType === "video" ? 0 : null;
    setMediaSize({ width: 0, height: 0 });
    await loadForSubmission(sub.id, frame);
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyHandlerRef.current = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;

      const isVideo = submission?.mediaType === "video";

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          if (prevStudent) handleStudentSelect(prevStudent.id);
          break;
        case "ArrowDown":
          e.preventDefault();
          if (nextStudent) handleStudentSelect(nextStudent.id);
          break;
        case "ArrowLeft":
          if (!isVideo) break;
          e.preventDefault();
          if (e.shiftKey) goPrevAnnotation();
          else getVideoHandle()?.seekToFrame(Math.max(0, (currentFrame ?? 0) - 1));
          break;
        case "ArrowRight":
          if (!isVideo) break;
          e.preventDefault();
          if (e.shiftKey) goNextAnnotation();
          else getVideoHandle()?.seekToFrame((currentFrame ?? 0) + 1);
          break;
        case ",":
          e.preventDefault();
          void goToFile(fileIndex - 1);
          break;
        case ".":
          e.preventDefault();
          void goToFile(fileIndex + 1);
          break;
        case "[":
          setStrokeWidth((w) => Math.max(1, w - 1));
          break;
        case "]":
          setStrokeWidth((w) => Math.min(40, w + 1));
          break;
        case "t":
          e.preventDefault();
          router.push(`/assignments/${assignment.id}?studentId=${selectedStudentId ?? ""}`);
          break;
      }
    };
  }); // no dep array — runs every render to stay fresh

  useEffect(() => {
    const dispatch = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", dispatch);
    return () => window.removeEventListener("keydown", dispatch);
  }, []); // registered once

  const submissionUrl = submission ? `/api/submissions/${submission.id}/file` : null;
  const canvasFps = submission?.fps ?? 30;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full">
      {/* ── Center: media viewer ───────────────────────────────────── */}
      <div ref={mediaAreaRef} className="flex-1 min-w-0 flex flex-col overflow-hidden bg-muted/20">
        {selectedStudent && (
          <>
            <StudentNavBar
              actions={
                submission ? (
                  <div className="flex items-center gap-0.5">
                    {studentFiles.length > 1 && (
                      <div className="flex items-center gap-0.5 pr-1.5 mr-0.5 border-r">
                        <button
                          onClick={() => void goToFile(fileIndex - 1)}
                          disabled={fileIndex === 0}
                          className="p-1 rounded hover:bg-muted disabled:opacity-25 transition-colors text-xs"
                          title="Previous file (,)"
                        >‹</button>
                        <span className="text-xs tabular-nums text-muted-foreground w-10 text-center">
                          {fileIndex + 1} / {studentFiles.length}
                        </span>
                        <button
                          onClick={() => void goToFile(fileIndex + 1)}
                          disabled={fileIndex === studentFiles.length - 1}
                          className="p-1 rounded hover:bg-muted disabled:opacity-25 transition-colors text-xs"
                          title="Next file (.)"
                        >›</button>
                      </div>
                    )}
                    <button
                      onClick={zoomOut}
                      disabled={zoom <= ZOOM_STEPS[0]}
                      className="p-1.5 rounded hover:bg-muted disabled:opacity-25 transition-colors"
                      title="Zoom out (Ctrl+scroll)"
                    >
                      <ZoomOut className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setZoom(1)}
                      className="text-xs tabular-nums w-10 text-center py-0.5 rounded hover:bg-muted transition-colors"
                      title="Reset to fit"
                    >
                      {zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}
                    </button>
                    <button
                      onClick={zoomIn}
                      disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                      className="p-1.5 rounded hover:bg-muted disabled:opacity-25 transition-colors"
                      title="Zoom in (Ctrl+scroll)"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </button>
                    {/* Playback master toggle */}
                    <button
                      onClick={isMaster ? () => setIsMaster(false) : handleTakeMasterControl}
                      className={`ml-1 pl-1.5 border-l flex items-center gap-1 text-xs px-1.5 py-0.5 rounded transition-colors ${
                        isMaster
                          ? "text-primary hover:bg-muted"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                      title={isMaster ? "You control playback sync — click to release" : "Click to take playback control"}
                    >
                      <Radio className={`h-3.5 w-3.5 ${isMaster ? "animate-pulse" : ""}`} />
                      {isMaster ? "Master" : "Follow"}
                    </button>
                    {/* A/B renderer toggle */}
                    <button
                      onClick={() => setUseCanvasPlayer((p) => !p)}
                      className="pl-1.5 border-l text-xs px-1.5 py-0.5 rounded hover:bg-muted transition-colors text-muted-foreground"
                      title={useCanvasPlayer ? "Switch to HTML video renderer" : "Switch to canvas renderer (experimental)"}
                    >
                      {useCanvasPlayer ? "Canvas" : "HTML5"}
                    </button>
                    <div className="pl-1.5 border-l">
                      <ToneAdjustPopover value={tone} onChange={setTone} />
                    </div>
                  </div>
                ) : undefined
              }
            />

            {!submission ? (
              <UploadZone
                submissionType={assignment.submissionType as "image" | "video" | "any"}
                onUpload={handleUpload}
                uploading={uploading}
                studentName={selectedStudent.name}
              />
            ) : submission.mediaType === "image" ? (
              <ImageViewer
                key={`${selectedStudentId ?? 0}-${fileIndex}`}
                src={submissionUrl!}
                zoom={zoom}
                onZoomChange={handleZoomChange}
                canvasRef={canvasRef}
                tool={activeTool}
                color={activeColor}
                strokeWidth={strokeWidth}
                onDirty={markDirty}
                onCanvasReady={handleCanvasReady}
                tone={tone}
              />
            ) : useCanvasPlayer ? (
              <div className="flex-1 min-h-0">
                {/* Canvas renderer: draws video + annotations entirely on canvas.
                    No CSS transforms. Fabric viewport transform aligns strokes. */}
                <CanvasVideoPlayer
                  ref={canvasVideoRef}
                  src={submissionUrl!}
                  fps={canvasFps}
                  zoom={zoom}
                  tool={activeTool}
                  color={activeColor}
                  strokeWidth={strokeWidth}
                  onDirty={markDirty}
                  onCanvasReady={handleCanvasReady}
                  annotatedFrames={annotatedFrames}
                  hasPrevAnnotation={hasPrevAnnotation}
                  hasNextAnnotation={hasNextAnnotation}
                  onZoomChange={handleZoomChange}
                  onPrevAnnotation={goPrevAnnotation}
                  onNextAnnotation={goNextAnnotation}
                  onFrameChange={handleFrameChangeWithSync}
                  onPlayStateChange={handlePlayStateChangeWithSync}
                  onReady={handleVideoReady}
                  tone={tone}
                />
              </div>
            ) : (
              <div className="flex-1 min-h-0">
                <VideoPlayer
                  ref={videoRef}
                  src={submissionUrl!}
                  fps={canvasFps}
                  zoom={zoom}
                  annotatedFrames={annotatedFrames}
                  hasPrevAnnotation={hasPrevAnnotation}
                  hasNextAnnotation={hasNextAnnotation}
                  onZoomChange={handleZoomChange}
                  onPrevAnnotation={goPrevAnnotation}
                  onNextAnnotation={goNextAnnotation}
                  onFrameChange={handleFrameChangeWithSync}
                  onPlayStateChange={handlePlayStateChangeWithSync}
                  onReady={handleVideoReady}
                  tone={tone}
                  annotationOverlay={
                    mediaSize.width > 0 ? (
                      <AnnotationCanvas
                        ref={canvasRef}
                        width={mediaSize.width}
                        height={mediaSize.height}
                        tool={activeTool}
                        color={activeColor}
                        strokeWidth={strokeWidth}
                        onDirty={markDirty}
                        onReady={handleCanvasReady}
                      />
                    ) : null
                  }
                />
              </div>
            )}
          </>
        )}
        {!selectedStudent && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Select a student from the list
          </div>
        )}
      </div>

      {/* ── Right: annotation toolbar ──────────────────────────────── */}
      <AnnotationToolbar
        tool={activeTool}
        color={activeColor}
        strokeWidth={strokeWidth}
        isDirty={isDirty}
        saving={saving}
        onToolChange={setActiveTool}
        onColorChange={setActiveColor}
        onStrokeWidthChange={setStrokeWidth}
        onUndo={() => getAnnotationHandle()?.undo()}
        onClear={() => { getAnnotationHandle()?.clear(); markDirty(); }}
        onSave={() => submission && handleSave(submission.id)}
      />
    </div>
  );
}

// ── ImageViewer ────────────────────────────────────────────────────────────────
// Renders the image at natural resolution (capped to MAX_CANVAS_DIM) with a
// CSS transform that scales it to fit the container, then applies userZoom on top.
// The canvas is always at the same logical dimensions — it never reinitializes
// when the window resizes or when zoom changes, so annotations stay aligned.
function ImageViewer({
  src,
  zoom,
  onZoomChange,
  canvasRef,
  tool,
  color,
  strokeWidth,
  onDirty,
  onCanvasReady,
  tone,
}: {
  src: string;
  zoom: number;
  onZoomChange: (z: number) => void;
  canvasRef: React.RefObject<AnnotationCanvasHandle | null>;
  tool: AnnotationTool;
  color: string;
  strokeWidth: number;
  onDirty: () => void;
  onCanvasReady: () => void;
  tone: ToneAdjust;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [logicalSize, setLogicalSize] = useState({ width: 0, height: 0 });

  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  const pendingScrollRef = useRef<{ cx: number; cy: number; ratio: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
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
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev * Math.exp(-e.deltaY / sensitivity)));
      pendingScrollRef.current = { cx, cy, ratio: next / prev };
      onZoomChange(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After zoom re-render, keep the cursor-under point stationary
  // useLayoutEffect is intentional here — must run synchronously after DOM update
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const adj = pendingScrollRef.current;
    if (!adj) return;
    pendingScrollRef.current = null;
    const el = containerRef.current;
    if (!el) return;
    el.scrollLeft = (el.scrollLeft + adj.cx) * adj.ratio - adj.cx;
    el.scrollTop  = (el.scrollTop  + adj.cy) * adj.ratio - adj.cy;
  }, [zoom]);

  function handleLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const nw = img.naturalWidth || img.offsetWidth;
    const nh = img.naturalHeight || img.offsetHeight;
    if (!nw || !nh) return;
    const s = Math.min(1, MAX_CANVAS_DIM / Math.max(nw, nh));
    setLogicalSize({ width: Math.round(nw * s), height: Math.round(nh * s) });
  }

  const { width: lw, height: lh } = logicalSize;
  const { width: cw, height: ch } = containerSize;

  const fitScale = lw > 0 && cw > 0 && ch > 0 ? Math.min(cw / lw, ch / lh) : 1;
  const totalScale = fitScale * zoom;
  const scaledW = lw * totalScale;
  const scaledH = lh * totalScale;
  const offsetX = Math.max(0, (cw - scaledW) / 2);
  const offsetY = Math.max(0, (ch - scaledH) / 2);

  return (
    <div ref={containerRef} className="flex-1" style={{ overflow: "auto", position: "relative" }}>
      {lw === 0 && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          aria-hidden
          style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
          onLoad={handleLoad}
          draggable={false}
        />
      )}

      {lw > 0 && cw > 0 && (
        <>
          <div style={{ width: Math.max(scaledW, cw), height: Math.max(scaledH, ch) }} />
          <div
            style={{
              position: "absolute",
              left: offsetX,
              top: offsetY,
              width: scaledW,
              height: scaledH,
            }}
          >
            <div
              style={{
                transform: `scale(${totalScale})`,
                transformOrigin: "top left",
                width: lw,
                height: lh,
                position: "relative",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt="Student submission"
                style={{
                  width: lw,
                  height: lh,
                  display: "block",
                  userSelect: "none",
                  filter: toneCssFilter(tone),
                }}
                draggable={false}
                onLoad={handleLoad}
              />
              <div className="absolute inset-0">
                <AnnotationCanvas
                  ref={canvasRef}
                  width={lw}
                  height={lh}
                  tool={tool}
                  color={color}
                  strokeWidth={strokeWidth}
                  onDirty={onDirty}
                  onReady={onCanvasReady}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
