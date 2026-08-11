"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Action, Envelope } from "../core/actions";
import { decodeStroke, encodeStroke, fromBase64, toBase64 } from "../core/strokes";
import type { Author, FrameMarker, Stroke, StrokeTool } from "../core/types";
import type { ReviewDataAdapter } from "../adapter/types";

/**
 * Stroke store for the current item.
 *
 * Append-only with soft deletes, which buys four things at once: incremental
 * sync via `seq`, no last-writer-wins clobbering between two devices drawing at
 * the same time, per-author visibility, and cheap timeline markers.
 */

export interface LiveInk {
  id: string;
  author: string;
  tool: StrokeTool;
  color: number;
  width: number;
  points: number[];
  updatedAt: number;
}

export interface AnnotationApi {
  strokes: Stroke[];
  markers: FrameMarker[];
  liveInk: LiveInk[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  hiddenAuthors: Set<string>;
  toggleAuthor: (id: string) => void;
  /** Strokes visible on a given frame, honouring hold ranges. */
  visibleOn: (frame: number) => Stroke[];
  /** Distinct frames carrying annotations, for prev/next navigation. */
  annotatedFrames: number[];
  commit: (stroke: Omit<Stroke, "localId" | "authorId">) => Promise<void>;
  eraseAt: (frame: number, x: number, y: number, radius: number) => Promise<boolean>;
  clearFrame: (frame: number) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  /** Push in-progress points to the room without committing. */
  streamInk: (ink: Omit<LiveInk, "updatedAt" | "author">) => void;
  endInk: (id: string) => void;
  reload: () => Promise<void>;
}

const INK_THROTTLE_MS = 50;

export function useAnnotations(
  adapter: ReviewDataAdapter,
  itemId: string | null,
  author: Author,
  send: (a: Action) => void,
  subscribe: (h: (e: Envelope) => void) => () => void,
): AnnotationApi {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [markers, setMarkers] = useState<FrameMarker[]>([]);
  const [liveInk, setLiveInk] = useState<LiveInk[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hiddenAuthors, setHiddenAuthors] = useState<Set<string>>(new Set());

  const headSeq = useRef(0);
  const undoStack = useRef<Stroke[]>([]);
  const redoStack = useRef<Stroke[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);
  const lastInkSent = useRef(0);
  const itemRef = useRef(itemId);
  itemRef.current = itemId;

  // ── Load ────────────────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    if (!itemId) {
      setStrokes([]);
      setMarkers([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [{ strokes: rows, head }, marks] = await Promise.all([
        adapter.getStrokes(itemId),
        adapter.getMarkers(itemId),
      ]);
      if (itemRef.current !== itemId) return; // navigated away mid-flight
      headSeq.current = head;
      setStrokes(
        rows.map((r) =>
          decodeStroke(fromBase64(r.b), {
            id: r.id,
            seq: r.seq,
            localId: r.localId,
            frameIn: r.frameIn,
            frameOut: r.frameOut,
            authorId: r.authorId,
            createdAt: r.createdAt,
          }),
        ),
      );
      setMarkers(marks);
      undoStack.current = [];
      redoStack.current = [];
      setUndoDepth(0);
      setRedoDepth(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load annotations");
    } finally {
      setLoading(false);
    }
  }, [adapter, itemId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ── Remote traffic ──────────────────────────────────────────────────────────
  useEffect(() => {
    return subscribe((e) => {
      if (e.a === "stroke") {
        if (e.s.itemId !== itemRef.current) return;
        const decoded = decodeStroke(fromBase64(e.s.b), {
          id: e.s.id,
          seq: e.s.seq,
          localId: e.s.localId,
          frameIn: e.s.frameIn,
          frameOut: e.s.frameOut,
          authorId: e.s.authorId,
          createdAt: new Date().toISOString(),
        });
        setStrokes((prev) =>
          prev.some((s) => s.localId === decoded.localId) ? prev : [...prev, decoded],
        );
        setMarkers((prev) => mergeMarker(prev, decoded));
        setLiveInk((prev) => prev.filter((l) => l.id !== e.s.localId));
      } else if (e.a === "ink") {
        if (e.author === author.id) return; // our own echo
        setLiveInk((prev) => {
          const existing = prev.find((l) => l.id === e.id);
          if (e.done) return prev.filter((l) => l.id !== e.id);
          if (!existing) {
            return [
              ...prev,
              {
                id: e.id,
                author: e.author,
                tool: e.tool,
                color: e.color,
                width: e.width,
                points: e.pts,
                updatedAt: Date.now(),
              },
            ];
          }
          return prev.map((l) =>
            l.id === e.id
              ? { ...l, points: [...l.points, ...e.pts], updatedAt: Date.now() }
              : l,
          );
        });
      } else if (e.a === "erase") {
        if (e.itemId !== itemRef.current) return;
        setStrokes((prev) => prev.filter((s) => !s.id || !e.ids.includes(s.id)));
      }
    });
  }, [subscribe, author.id]);

  // Drop live ink from a peer that vanished mid-stroke.
  useEffect(() => {
    const timer = setInterval(() => {
      const cutoff = Date.now() - 8000;
      setLiveInk((prev) => (prev.some((l) => l.updatedAt < cutoff) ? prev.filter((l) => l.updatedAt >= cutoff) : prev));
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  // ── Commit ──────────────────────────────────────────────────────────────────
  const commit = useCallback(
    async (input: Omit<Stroke, "localId" | "authorId">) => {
      if (!itemId) return;
      const localId = `${author.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const stroke: Stroke = {
        ...input,
        localId,
        authorId: author.id,
        createdAt: new Date().toISOString(),
      };

      // Optimistic: the stroke appears instantly, then reconciles with its id.
      setStrokes((prev) => [...prev, stroke]);
      setMarkers((prev) => mergeMarker(prev, stroke));
      undoStack.current.push(stroke);
      redoStack.current = [];
      setUndoDepth(undoStack.current.length);
      setRedoDepth(0);

      const b = toBase64(encodeStroke(stroke));
      send({
        a: "stroke",
        s: {
          localId,
          itemId,
          frameIn: stroke.frameIn,
          frameOut: stroke.frameOut,
          authorId: author.id,
          b,
        },
      });

      setSaving(true);
      try {
        const [saved] = await adapter.appendStrokes(itemId, [
          { localId, frameIn: stroke.frameIn, frameOut: stroke.frameOut, authorId: author.id, b },
        ]);
        if (saved) {
          setStrokes((prev) =>
            prev.map((s) => (s.localId === localId ? { ...s, id: saved.id, seq: saved.seq } : s)),
          );
          headSeq.current = Math.max(headSeq.current, saved.seq);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed to save stroke");
      } finally {
        setSaving(false);
      }
    },
    [adapter, itemId, author.id, send],
  );

  const removeStrokes = useCallback(
    async (targets: Stroke[]) => {
      if (!itemId || targets.length === 0) return;
      const ids = targets.map((s) => s.id).filter((v): v is number => typeof v === "number");
      const localIds = new Set(targets.map((s) => s.localId));
      setStrokes((prev) => prev.filter((s) => !localIds.has(s.localId)));
      if (ids.length) {
        send({ a: "erase", ids, itemId });
        try {
          await adapter.deleteStrokes(itemId, ids);
        } catch (e) {
          setError(e instanceof Error ? e.message : "failed to erase");
        }
      }
      const marks = await adapter.getMarkers(itemId).catch(() => null);
      if (marks && itemRef.current === itemId) setMarkers(marks);
    },
    [adapter, itemId, send],
  );

  /** Stroke-level erase: cheaper than pixel erase and stays vector. */
  const eraseAt = useCallback(
    async (frame: number, x: number, y: number, radius: number) => {
      const hits = strokes.filter((s) => {
        if (s.frameIn > frame || s.frameOut < frame) return false;
        if (s.authorId !== author.id) return false; // never erase someone else's
        for (let i = 0; i < s.points.length; i += 2) {
          if (Math.hypot(s.points[i] - x, s.points[i + 1] - y) <= radius) return true;
        }
        return false;
      });
      if (hits.length === 0) return false;
      undoStack.current.push(...hits);
      setUndoDepth(undoStack.current.length);
      await removeStrokes(hits);
      return true;
    },
    [strokes, author.id, removeStrokes],
  );

  const clearFrame = useCallback(
    async (frame: number) => {
      const hits = strokes.filter(
        (s) => s.frameIn <= frame && s.frameOut >= frame && s.authorId === author.id,
      );
      await removeStrokes(hits);
    },
    [strokes, author.id, removeStrokes],
  );

  const undo = useCallback(async () => {
    const last = undoStack.current.pop();
    setUndoDepth(undoStack.current.length);
    if (!last) return;
    redoStack.current.push(last);
    setRedoDepth(redoStack.current.length);
    await removeStrokes([last]);
  }, [removeStrokes]);

  const redo = useCallback(async () => {
    const last = redoStack.current.pop();
    setRedoDepth(redoStack.current.length);
    if (!last) return;
    const { localId: _l, authorId: _a, id: _i, seq: _s, ...rest } = last;
    await commit(rest as Omit<Stroke, "localId" | "authorId">);
  }, [commit]);

  // ── Live ink ────────────────────────────────────────────────────────────────
  const streamInk = useCallback(
    (ink: Omit<LiveInk, "updatedAt" | "author">) => {
      const now = Date.now();
      if (now - lastInkSent.current < INK_THROTTLE_MS) return;
      lastInkSent.current = now;
      send({
        a: "ink",
        id: ink.id,
        author: author.id,
        tool: ink.tool,
        color: ink.color,
        width: ink.width,
        pts: ink.points,
      });
    },
    [send, author.id],
  );

  const endInk = useCallback(
    (id: string) => {
      send({
        a: "ink",
        id,
        author: author.id,
        tool: "pen",
        color: 0,
        width: 0,
        pts: [],
        done: true,
      });
    },
    [send, author.id],
  );

  const toggleAuthor = useCallback((id: string) => {
    setHiddenAuthors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const visibleOn = useCallback(
    (frame: number) =>
      strokes.filter(
        (s) => s.frameIn <= frame && s.frameOut >= frame && !hiddenAuthors.has(s.authorId),
      ),
    [strokes, hiddenAuthors],
  );

  const annotatedFrames = useMemo(() => {
    const set = new Set<number>();
    for (const m of markers) set.add(m.frameIn);
    for (const s of strokes) set.add(s.frameIn);
    return [...set].sort((a, b) => a - b);
  }, [markers, strokes]);

  return {
    strokes,
    markers,
    liveInk,
    loading,
    saving,
    error,
    hiddenAuthors,
    toggleAuthor,
    visibleOn,
    annotatedFrames,
    commit,
    eraseAt,
    clearFrame,
    undo,
    redo,
    canUndo: undoDepth > 0,
    canRedo: redoDepth > 0,
    streamInk,
    endInk,
    reload,
  };
}

function mergeMarker(markers: FrameMarker[], s: Stroke): FrameMarker[] {
  const existing = markers.find((m) => m.frameIn === s.frameIn);
  if (existing) {
    return markers.map((m) =>
      m.frameIn === s.frameIn
        ? { ...m, count: m.count + 1, frameOut: Math.max(m.frameOut, s.frameOut) }
        : m,
    );
  }
  return [...markers, { frameIn: s.frameIn, frameOut: s.frameOut, count: 1 }].sort(
    (a, b) => a.frameIn - b.frameIn,
  );
}
