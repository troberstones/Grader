"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getAnnotations, saveAnnotations, type AnnotationFrame } from "@/actions/annotations";
import type { AnnotationCanvasHandle } from "@/components/review/annotation-canvas";

/**
 * Owns all annotation state for the review page:
 *  - annotation map (frame → JSON)
 *  - current frame tracking
 *  - dirty / saving state
 *  - 1.5 s auto-save
 *  - pending-load queue for async canvas readiness
 *
 * Accepts the canvas ref so it can read/write frames without the caller
 * needing to know about internal data shapes.
 */
export function useAnnotations(
  canvasRef: React.RefObject<AnnotationCanvasHandle | null>,
) {
  const [annotationMap, setAnnotationMap] = useState<Map<number | null, string>>(
    new Map(),
  );
  const [currentFrame, setCurrentFrame] = useState<number | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Ref mirrors — used inside timer callbacks and async functions to avoid
  // stale closures without adding them to every dependency array.
  const annotationMapRef = useRef<Map<number | null, string>>(new Map());
  const currentFrameRef = useRef<number | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pending annotation to load once the canvas fires onReady.
  // undefined = nothing pending; null = clear canvas; string = load this JSON.
  const pendingAnnotationRef = useRef<string | null | undefined>(undefined);

  // Keep ref mirrors in sync with state
  useEffect(() => { annotationMapRef.current = annotationMap; }, [annotationMap]);
  useEffect(() => { currentFrameRef.current = currentFrame; }, [currentFrame]);

  // ── Auto-save: 1.5 s after the last stroke ─────────────────────────────────
  // Stored in a separate ref so the timer callback always has the latest
  // submissionId without re-registering the effect.
  const autoSaveSubmissionIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isDirty) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      return;
    }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      const subId = autoSaveSubmissionIdRef.current;
      if (subId === null) return;
      try {
        const json = canvasRef.current?.getCurrentJSON() ?? null;
        const newMap = new Map(annotationMapRef.current);
        if (json) newMap.set(currentFrameRef.current, json);
        else newMap.delete(currentFrameRef.current);
        setAnnotationMap(newMap);
        annotationMapRef.current = newMap;
        const frames: AnnotationFrame[] = Array.from(newMap.entries()).map(
          ([k, v]) => ({ frameNumber: k, annotationData: v }),
        );
        await saveAnnotations(subId, frames);
        setIsDirty(false);
      } catch {
        // Silent — manual save is always available via handleSave
      }
    }, 1500);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

  // ── Canvas-ready callback ────────────────────────────────────────────────
  const handleCanvasReady = useCallback(() => {
    const pending = pendingAnnotationRef.current;
    if (pending !== undefined) {
      pendingAnnotationRef.current = undefined;
      canvasRef.current?.loadFrame(pending ?? null);
    }
  }, [canvasRef]);

  // ── Load annotations for a submission from the server ───────────────────
  const loadForSubmission = useCallback(
    async (submissionId: number | null, initialFrame: number | null) => {
      // Update the submission id used by the auto-save timer
      autoSaveSubmissionIdRef.current = submissionId;

      setCurrentFrame(initialFrame);
      currentFrameRef.current = initialFrame;

      if (submissionId === null) {
        const empty = new Map<number | null, string>();
        setAnnotationMap(empty);
        annotationMapRef.current = empty;
        const loaded = await canvasRef.current?.loadFrame(null);
        if (!loaded) pendingAnnotationRef.current = null;
        return;
      }

      try {
        const frames = await getAnnotations(submissionId);
        const map = new Map<number | null, string>();
        for (const f of frames) map.set(f.frameNumber, f.annotationData);
        setAnnotationMap(map);
        annotationMapRef.current = map;
        const json = map.get(initialFrame) ?? null;
        const loaded = await canvasRef.current?.loadFrame(json);
        if (!loaded) pendingAnnotationRef.current = json ?? null;
      } catch {
        const empty = new Map<number | null, string>();
        setAnnotationMap(empty);
        annotationMapRef.current = empty;
        const loaded = await canvasRef.current?.loadFrame(null);
        if (!loaded) pendingAnnotationRef.current = null;
      }
    },
    [canvasRef],
  );

  // ── Flush current frame to the map (before switching student) ───────────
  const flushCurrentFrame = useCallback(
    async (submissionId: number | null | undefined) => {
      if (!isDirty || !submissionId) return;
      const json = canvasRef.current?.getCurrentJSON() ?? null;
      const newMap = new Map(annotationMapRef.current);
      if (json) newMap.set(currentFrameRef.current, json);
      else newMap.delete(currentFrameRef.current);
      setAnnotationMap(newMap);
      annotationMapRef.current = newMap;
      const frames: AnnotationFrame[] = Array.from(newMap.entries()).map(
        ([k, v]) => ({ frameNumber: k, annotationData: v }),
      );
      await saveAnnotations(submissionId, frames).catch(() => {});
      setIsDirty(false);
    },
    [canvasRef, isDirty],
  );

  // ── Video frame change ────────────────────────────────────────────────────
  const handleFrameChange = useCallback(
    async (frame: number) => {
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
    },
    [canvasRef],
  );

  // ── Manual save ──────────────────────────────────────────────────────────
  const handleSave = useCallback(
    async (submissionId: number) => {
      setSaving(true);
      try {
        const json = canvasRef.current?.getCurrentJSON() ?? null;
        const newMap = new Map(annotationMapRef.current);
        if (json) newMap.set(currentFrameRef.current, json);
        else newMap.delete(currentFrameRef.current);
        setAnnotationMap(newMap);
        annotationMapRef.current = newMap;
        const frames: AnnotationFrame[] = Array.from(newMap.entries()).map(
          ([k, v]) => ({ frameNumber: k, annotationData: v }),
        );
        await saveAnnotations(submissionId, frames);
        setIsDirty(false);
        toast.success("Annotations saved");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      } finally {
        setSaving(false);
      }
    },
    [canvasRef],
  );

  // ── Reset after a new file is uploaded ───────────────────────────────────
  // Clears map and frame state; caller is responsible for reloading the canvas.
  const resetForNewMedia = useCallback(
    (initialFrame: number | null, submissionId: number | null) => {
      autoSaveSubmissionIdRef.current = submissionId;
      setCurrentFrame(initialFrame);
      currentFrameRef.current = initialFrame;
      const empty = new Map<number | null, string>();
      setAnnotationMap(empty);
      annotationMapRef.current = empty;
      setIsDirty(false);
      pendingAnnotationRef.current = null;
    },
    [],
  );

  // ── Queue an annotation JSON to load once the canvas next fires onReady ──
  // Used when video dimensions change between students, which causes Fabric to
  // dispose and reinitialize, clearing any annotation that was already loaded.
  const queueAnnotationLoad = useCallback((json: string | null) => {
    pendingAnnotationRef.current = json;
  }, []);

  // ── Expose markDirty so callers can pass it to the canvas onDirty prop ───
  const markDirty = useCallback(() => setIsDirty(true), []);

  // ── Derived: which frames have annotations (for video timeline) ──────────
  const annotatedFrames = useMemo(() => {
    // Only meaningful for video (currentFrame is a number, not null)
    if (currentFrame === null && annotationMap.size === 0) return undefined;
    const s = new Set<number>();
    for (const [k] of annotationMap) {
      if (k !== null) s.add(k as number);
    }
    return s.size > 0 ? s : undefined;
  }, [annotationMap, currentFrame]);

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

  return {
    // state
    annotationMap,
    currentFrame,
    isDirty,
    saving,
    annotatedFrames,
    hasPrevAnnotation,
    hasNextAnnotation,
    // stable callbacks to wire into canvas / video props
    markDirty,
    handleCanvasReady,
    handleFrameChange,
    // actions
    loadForSubmission,
    handleSave,
    flushCurrentFrame,
    resetForNewMedia,
    queueAnnotationLoad,
  } as const;
}
