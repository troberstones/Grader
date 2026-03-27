"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clock, Circle, Users, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadZone } from "@/components/review/upload-zone";
import { AnnotationToolbar, type AnnotationTool } from "@/components/review/annotation-toolbar";
import { AnnotationCanvas, type AnnotationCanvasHandle } from "@/components/review/annotation-canvas";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/review/video-player";
import { getAnnotations, saveAnnotations, type AnnotationFrame } from "@/actions/annotations";
import { updateSubmissionMeta } from "@/actions/submissions";
import type { getAssignment } from "@/actions/assignments";
import type { StudentWithGrade } from "@/actions/grades";

type Assignment = NonNullable<Awaited<ReturnType<typeof getAssignment>>>;

type SubmissionRow = {
  id: number;
  assignmentId: number;
  studentId: number;
  filePath: string;
  fileName: string;
  fileType: string;
  fileSize: number | null;
  mediaType: string;
  fps: number | null;
  duration: number | null;
  frameCount: number | null;
  submittedAt: string;
};

interface ReviewClientProps {
  assignment: Assignment;
  students: StudentWithGrade[];
  initialSubmissions: Record<number, SubmissionRow>;
}

// Used only by the +/- buttons; trackpad pinch uses continuous exponential zoom
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const MAX_CANVAS_DIM = 2048;

export function ReviewClient({ assignment, students, initialSubmissions }: ReviewClientProps) {
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(students[0]?.id ?? null);
  const [submissions, setSubmissions] = useState<Record<number, SubmissionRow>>(initialSubmissions);
  const [annotationMap, setAnnotationMap] = useState<Map<number | null, string>>(new Map());
  const [currentFrame, setCurrentFrame] = useState<number | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [zoom, setZoom] = useState(1);

  // Tool state
  const [activeTool, setActiveTool] = useState<AnnotationTool>("pen");
  const [activeColor, setActiveColor] = useState("#ef4444");
  const [strokeWidth, setStrokeWidth] = useState(4);

  // Canvas size for video overlay (set from VideoPlayer's onReady with capped dims)
  const [mediaSize, setMediaSize] = useState({ width: 0, height: 0 });

  const canvasRef = useRef<AnnotationCanvasHandle>(null);
  const videoRef = useRef<VideoPlayerHandle>(null);
  const mediaAreaRef = useRef<HTMLDivElement>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref mirror of submission for use inside timer callbacks (avoids stale closure)
  const submissionRef = useRef<SubmissionRow | null>(null);

  // Pending annotation to load once the canvas fires onReady.
  // undefined = nothing pending; null = load empty; string = load this JSON.
  const pendingAnnotationRef = useRef<string | null | undefined>(undefined);
  // Ref mirrors for async callbacks
  const annotationMapRef = useRef<Map<number | null, string>>(new Map());
  const currentFrameRef = useRef<number | null>(null);

  const selectedStudent = students.find((s) => s.id === selectedStudentId) ?? null;
  const submission = selectedStudentId ? submissions[selectedStudentId] ?? null : null;

  // ── Keep refs in sync ─────────────────────────────────────────────────────
  useEffect(() => { annotationMapRef.current = annotationMap; }, [annotationMap]);
  useEffect(() => { currentFrameRef.current = currentFrame; }, [currentFrame]);
  useEffect(() => { submissionRef.current = submission; }, [submission]);

  // ── Auto-save: 1.5 s after the last stroke, silently persist ─────────────
  useEffect(() => {
    if (!isDirty) {
      if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
      return;
    }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      const sub = submissionRef.current;
      if (!sub) return;
      try {
        const json = canvasRef.current?.getCurrentJSON() ?? null;
        const newMap = new Map(annotationMapRef.current);
        if (json) newMap.set(currentFrameRef.current, json);
        else newMap.delete(currentFrameRef.current);
        setAnnotationMap(newMap);
        annotationMapRef.current = newMap;
        const frames: AnnotationFrame[] = Array.from(newMap.entries()).map(([k, v]) => ({
          frameNumber: k,
          annotationData: v,
        }));
        await saveAnnotations(sub.id, frames);
        setIsDirty(false);
      } catch {
        // Silent — manual save is always available
      }
    }, 1500);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

  // ── Canvas ready callback: load any pending annotation ───────────────────
  const handleCanvasReady = useCallback(() => {
    const pending = pendingAnnotationRef.current;
    if (pending !== undefined) {
      pendingAnnotationRef.current = undefined;
      canvasRef.current?.loadFrame(pending ?? null);
    }
  }, []);

  // ── Load annotations for a submission ────────────────────────────────────
  const loadStudentAnnotations = useCallback(async (sub: SubmissionRow | null, frame: number | null) => {
    if (!sub) {
      setAnnotationMap(new Map());
      annotationMapRef.current = new Map();
      const loaded = await canvasRef.current?.loadFrame(null);
      if (!loaded) pendingAnnotationRef.current = null;
      return;
    }
    try {
      const frames = await getAnnotations(sub.id);
      const map = new Map<number | null, string>();
      for (const f of frames) map.set(f.frameNumber, f.annotationData);
      setAnnotationMap(map);
      annotationMapRef.current = map;
      const json = map.get(frame) ?? null;
      const loaded = await canvasRef.current?.loadFrame(json);
      if (!loaded) pendingAnnotationRef.current = json ?? null;
    } catch {
      setAnnotationMap(new Map());
      annotationMapRef.current = new Map();
      const loaded = await canvasRef.current?.loadFrame(null);
      if (!loaded) pendingAnnotationRef.current = null;
    }
  }, []);

  // On mount: load first student's annotations
  useEffect(() => {
    if (!selectedStudentId) return;
    const sub = submissions[selectedStudentId] ?? null;
    const frame = sub?.mediaType === "video" ? 0 : null;
    setCurrentFrame(frame);
    currentFrameRef.current = frame;
    setMediaSize({ width: 0, height: 0 });
    loadStudentAnnotations(sub, frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zoom is now handled inside each viewer (ImageViewer / VideoPlayer) so they
  // can zoom around the cursor position. This is just the setter they call back up.
  const handleZoomChange = useCallback((z: number) => {
    setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)));
  }, []);

  // ── Auto-save current frame before switching student ─────────────────────
  async function flushCurrentFrame() {
    if (!isDirty || !submission) return;
    const json = canvasRef.current?.getCurrentJSON() ?? null;
    const newMap = new Map(annotationMapRef.current);
    if (json) newMap.set(currentFrameRef.current, json);
    else newMap.delete(currentFrameRef.current);
    setAnnotationMap(newMap);
    annotationMapRef.current = newMap;
    const frames: AnnotationFrame[] = Array.from(newMap.entries()).map(([k, v]) => ({
      frameNumber: k,
      annotationData: v,
    }));
    await saveAnnotations(submission.id, frames).catch(() => {});
    setIsDirty(false);
  }

  // ── Student selection ─────────────────────────────────────────────────────
  async function selectStudent(studentId: number) {
    if (studentId === selectedStudentId) return;
    await flushCurrentFrame();

    setSelectedStudentId(studentId);
    setMediaSize({ width: 0, height: 0 });
    setIsDirty(false);
    pendingAnnotationRef.current = undefined;

    const sub = submissions[studentId] ?? null;
    const frame = sub?.mediaType === "video" ? 0 : null;
    setCurrentFrame(frame);
    currentFrameRef.current = frame;
    await loadStudentAnnotations(sub, frame);
  }

  // ── Frame change (video scrubbing) ────────────────────────────────────────
  async function handleFrameChange(frame: number) {
    if (frame === currentFrameRef.current) return;
    const json = canvasRef.current?.getCurrentJSON() ?? null;
    const newMap = new Map(annotationMapRef.current);
    if (json) newMap.set(currentFrameRef.current, json);
    else newMap.delete(currentFrameRef.current);
    setAnnotationMap(newMap);
    annotationMapRef.current = newMap;
    setCurrentFrame(frame);
    currentFrameRef.current = frame;
    setIsDirty(false);
    await canvasRef.current?.loadFrame(newMap.get(frame) ?? null);
  }

  // ── Video ready (get logical size for canvas) ─────────────────────────────
  async function handleVideoReady(width: number, height: number, duration: number, fps: number) {
    setMediaSize({ width, height });
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
      setSubmissions((prev) => ({ ...prev, [selectedStudentId]: newSub }));

      const frame = newSub.mediaType === "video" ? 0 : null;
      setCurrentFrame(frame);
      currentFrameRef.current = frame;
      setMediaSize({ width: 0, height: 0 });
      setAnnotationMap(new Map());
      annotationMapRef.current = new Map();
      pendingAnnotationRef.current = null;
      await canvasRef.current?.loadFrame(null);
      toast.success("Submission uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // ── Save annotations ──────────────────────────────────────────────────────
  async function handleSave() {
    if (!submission) return;
    setSaving(true);
    try {
      const json = canvasRef.current?.getCurrentJSON() ?? null;
      const newMap = new Map(annotationMapRef.current);
      if (json) newMap.set(currentFrameRef.current, json);
      else newMap.delete(currentFrameRef.current);
      setAnnotationMap(newMap);
      annotationMapRef.current = newMap;
      const frames: AnnotationFrame[] = Array.from(newMap.entries()).map(([k, v]) => ({
        frameNumber: k,
        annotationData: v,
      }));
      await saveAnnotations(submission.id, frames);
      setIsDirty(false);
      toast.success("Annotations saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // ── Navigation (derived early — used by keyboard handler below) ──────────
  const currentIdx = students.findIndex((s) => s.id === selectedStudentId);
  const prevStudent = currentIdx > 0 ? students[currentIdx - 1] : null;
  const nextStudent = currentIdx < students.length - 1 ? students[currentIdx + 1] : null;

  // ── Annotation frame navigation ──────────────────────────────────────────
  function goPrevAnnotation() {
    const frames = [...annotationMapRef.current.keys()]
      .filter((k): k is number => k !== null)
      .sort((a, b) => a - b);
    const prev = [...frames].reverse().find((f) => f < (currentFrameRef.current ?? 0));
    if (prev !== undefined) videoRef.current?.seekToFrame(prev);
  }
  function goNextAnnotation() {
    const frames = [...annotationMapRef.current.keys()]
      .filter((k): k is number => k !== null)
      .sort((a, b) => a - b);
    const next = frames.find((f) => f > (currentFrameRef.current ?? 0));
    if (next !== undefined) videoRef.current?.seekToFrame(next);
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // Handler ref pattern: window listener registered once, body refreshed every
  // render so it always closes over the latest state + derived values.
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyHandlerRef.current = (e: KeyboardEvent) => {
      // Don't intercept while typing in inputs or Fabric's hidden IText textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;

      const isVideo = submissionRef.current?.mediaType === "video";

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          if (prevStudent) selectStudent(prevStudent.id);
          break;
        case "ArrowDown":
          e.preventDefault();
          if (nextStudent) selectStudent(nextStudent.id);
          break;
        case "ArrowLeft":
          if (!isVideo) break;
          e.preventDefault();
          if (e.shiftKey) goPrevAnnotation();
          else videoRef.current?.seekToFrame(Math.max(0, (currentFrameRef.current ?? 0) - 1));
          break;
        case "ArrowRight":
          if (!isVideo) break;
          e.preventDefault();
          if (e.shiftKey) goNextAnnotation();
          else videoRef.current?.seekToFrame((currentFrameRef.current ?? 0) + 1);
          break;
        case "[":
          setStrokeWidth((w) => Math.max(1, w - 1));
          break;
        case "]":
          setStrokeWidth((w) => Math.min(40, w + 1));
          break;
      }
    };
  }); // no dep array — runs every render to stay fresh

  useEffect(() => {
    const dispatch = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", dispatch);
    return () => window.removeEventListener("keydown", dispatch);
  }, []); // registered once

  // ── Annotated frames set (for timeline markers) ───────────────────────────
  const annotatedFrames = useMemo(() => {
    if (submission?.mediaType !== "video") return undefined;
    const s = new Set<number>();
    for (const [k] of annotationMap) {
      if (k !== null) s.add(k as number);
    }
    return s;
  }, [annotationMap, submission?.mediaType]);

  // ── Zoom helpers ──────────────────────────────────────────────────────────
  function zoomIn() {
    setZoom((prev) => {
      // Find first step strictly above current (handles mid-step values from pinch)
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

  // ── Annotation nav availability ───────────────────────────────────────────
  const hasPrevAnnotation = useMemo(() => {
    if (!annotatedFrames) return false;
    const cur = currentFrame ?? 0;
    return [...annotatedFrames].some((f) => f < cur);
  }, [annotatedFrames, currentFrame]);

  const hasNextAnnotation = useMemo(() => {
    if (!annotatedFrames) return false;
    const cur = currentFrame ?? 0;
    return [...annotatedFrames].some((f) => f > cur);
  }, [annotatedFrames, currentFrame]);

  const submissionUrl = submission ? `/api/submissions/${submission.id}/file` : null;
  const canvasFps = submission?.fps ?? 30;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="flex -mx-6 border-t"
      style={{ height: "calc(100vh - 180px)" }}
    >
      {/* ── Left: student list ──────────────────────────────────────── */}
      <div className="w-56 shrink-0 border-r flex flex-col">
        <div className="px-3 py-2 border-b">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            {students.length} students
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {students.map((student) => {
            const hasSub = !!submissions[student.id];
            const status = student.grade?.status ?? "ungraded";
            return (
              <button
                key={student.id}
                onClick={() => selectStudent(student.id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 text-sm border-b last:border-b-0 transition-colors hover:bg-muted/50",
                  student.id === selectedStudentId && "bg-primary/8 border-l-2 border-l-primary"
                )}
              >
                <div className="flex items-center gap-2">
                  <StatusIcon status={status} />
                  <span className="flex-1 truncate font-medium">{student.sortName}</span>
                </div>
                <div className="ml-6 text-xs text-muted-foreground mt-0.5">
                  {hasSub ? (
                    <span className="text-green-600">
                      {submissions[student.id]?.mediaType === "video" ? "🎬" : "🖼"} Submitted
                    </span>
                  ) : (
                    <span className="opacity-50">No submission</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Center: media viewer ───────────────────────────────────── */}
      <div ref={mediaAreaRef} className="flex-1 min-w-0 flex flex-col overflow-hidden bg-muted/20">
        {selectedStudent && (
          <>
            {/* Student nav + zoom controls */}
            <div className="shrink-0 px-4 py-2 border-b flex items-center gap-3 bg-background">
              <Button
                variant="ghost" size="icon"
                onClick={() => prevStudent && selectStudent(prevStudent.id)}
                disabled={!prevStudent}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium flex-1 text-center">
                {selectedStudent.name}
                <span className="text-muted-foreground ml-2 text-xs">
                  ({currentIdx + 1}/{students.length})
                </span>
              </span>
              <Button
                variant="ghost" size="icon"
                onClick={() => nextStudent && selectStudent(nextStudent.id)}
                disabled={!nextStudent}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>

              {/* Zoom controls */}
              {submission && (
                <div className="flex items-center gap-1 ml-2 border-l pl-3">
                  <button
                    onClick={zoomOut}
                    disabled={zoom <= ZOOM_STEPS[0]}
                    className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors"
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
                    className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors"
                    title="Zoom in (Ctrl+scroll)"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Media area */}
            {!submission ? (
              <UploadZone
                submissionType={assignment.submissionType as "image" | "video" | "any"}
                onUpload={handleUpload}
                uploading={uploading}
                studentName={selectedStudent.name}
              />
            ) : submission.mediaType === "image" ? (
              // key forces full remount on student change so naturalSize resets and
              // the old canvas never bleeds through to the next student
              <ImageViewer
                key={selectedStudentId ?? 0}
                src={submissionUrl!}
                zoom={zoom}
                onZoomChange={handleZoomChange}
                canvasRef={canvasRef}
                tool={activeTool}
                color={activeColor}
                strokeWidth={strokeWidth}
                onDirty={() => setIsDirty(true)}
                onCanvasReady={handleCanvasReady}
              />
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
                  onFrameChange={handleFrameChange}
                  onReady={handleVideoReady}
                  annotationOverlay={
                    mediaSize.width > 0 ? (
                      <AnnotationCanvas
                        ref={canvasRef}
                        width={mediaSize.width}
                        height={mediaSize.height}
                        tool={activeTool}
                        color={activeColor}
                        strokeWidth={strokeWidth}
                        onDirty={() => setIsDirty(true)}
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
        onUndo={() => canvasRef.current?.undo()}
        onClear={() => { canvasRef.current?.clear(); setIsDirty(true); }}
        onSave={handleSave}
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
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  // Capped logical dimensions — canvas is always this size
  const [logicalSize, setLogicalSize] = useState({ width: 0, height: 0 });

  // Ref of current zoom for wheel handler (avoids stale closure)
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // Stored cursor info so the layout-effect can reposition scroll after zoom
  const pendingScrollRef = useRef<{ cx: number; cy: number; ratio: number } | null>(null);

  // Track the container so fitScale updates on window resize
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

  // Ctrl/Cmd-scroll → zoom around cursor position
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left; // cursor in viewport coords
      const cy = e.clientY - rect.top;
      const prev = zoomRef.current;
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev * Math.exp(-e.deltaY / 300)));
      pendingScrollRef.current = { cx, cy, ratio: next / prev };
      onZoomChange(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After zoom re-render, keep the cursor-under point stationary
  useLayoutEffect(() => {
    const adj = pendingScrollRef.current;
    if (!adj) return;
    pendingScrollRef.current = null;
    const el = containerRef.current;
    if (!el) return;
    // (scrollLeft + cx) is the scroll-space coordinate under the cursor.
    // Multiply by ratio to get the new scroll-space coord, then subtract cx.
    el.scrollLeft = (el.scrollLeft + adj.cx) * adj.ratio - adj.cx;
    el.scrollTop  = (el.scrollTop  + adj.cy) * adj.ratio - adj.cy;
  }, [zoom]);

  function handleLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const nw = img.naturalWidth || img.offsetWidth;
    const nh = img.naturalHeight || img.offsetHeight;
    if (!nw || !nh) return;
    // Cap longest side to MAX_CANVAS_DIM so Fabric.js canvas isn't huge
    const s = Math.min(1, MAX_CANVAS_DIM / Math.max(nw, nh));
    setLogicalSize({ width: Math.round(nw * s), height: Math.round(nh * s) });
  }

  const { width: lw, height: lh } = logicalSize;
  const { width: cw, height: ch } = containerSize;

  // fitScale makes the image fill the container at zoom=1
  const fitScale = lw > 0 && cw > 0 && ch > 0 ? Math.min(cw / lw, ch / lh) : 1;
  const totalScale = fitScale * zoom;
  const scaledW = lw * totalScale;
  const scaledH = lh * totalScale;

  // Center offset: when content is smaller than the viewport, push it to the middle.
  // When content is larger, offset is 0 so scrolling starts from the edge.
  const offsetX = Math.max(0, (cw - scaledW) / 2);
  const offsetY = Math.max(0, (ch - scaledH) / 2);

  return (
    <div ref={containerRef} className="flex-1" style={{ overflow: "auto", position: "relative" }}>
      {/* Invisible probe image: load fires once to capture natural dimensions */}
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
          {/*
           * Spacer div — sits in normal flow and defines the scroll area.
           * flex / justify-content:center + overflow:auto has a known browser
           * bug where content past the left/top edge is unreachable. Using an
           * explicit spacer in normal flow and an absolutely positioned content
           * wrapper avoids that entirely.
           */}
          <div style={{ width: Math.max(scaledW, cw), height: Math.max(scaledH, ch) }} />

          {/* Content wrapper — absolutely centered when small, top-left when zoomed */}
          <div
            style={{
              position: "absolute",
              left: offsetX,
              top: offsetY,
              width: scaledW,
              height: scaledH,
            }}
          >
            {/*
             * The transform scales image + canvas together from the top-left corner.
             * Canvas dimensions never change — no Fabric.js reinit on zoom or resize.
             * Fabric.js uses getBoundingClientRect() for mouse hit-testing which
             * correctly reflects the CSS transform, so annotations always line up.
             */}
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
                style={{ width: lw, height: lh, display: "block", userSelect: "none" }}
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

function StatusIcon({ status }: { status: string }) {
  if (status === "graded") return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
  if (status === "in_progress") return <Clock className="h-3.5 w-3.5 text-yellow-500 shrink-0" />;
  return <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
}
