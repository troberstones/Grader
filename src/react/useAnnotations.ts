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
  const inkPending = useRef<{
    id: string;
    tool: StrokeTool;
    color: number;
    width: number;
    pts: number[];
  } | null>(null);
  const inkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemRef = useRef(itemId);
  itemRef.current = itemId;

  // ── Load ────────────────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    if (!itemId) {
      setStrokes([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { strokes: rows, head } = await adapter.getStrokes(itemId);
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
        setLiveInk((prev) => prev.filter((l) => l.id !== e.s.localId));
      } else if (e.a === "ink") {
        // No author check here. `author.id` is the signed-in instructor, not the
        // device — one instructor on an iPad and a Mac has the same id on both,
        // so filtering on it threw away every remote stroke as a false echo.
        // Real self-echo is already dropped by the transport, which compares the
        // sender's client id before any of this runs.
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
        const localIds = new Set(e.localIds ?? []);
        setStrokes((prev) =>
          prev.filter(
            (s) => !localIds.has(s.localId) && !(typeof s.id === "number" && e.ids.includes(s.id)),
          ),
        );
      }
    });
  }, [subscribe]);

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
          // The undo stack holds the pre-save object, so without this an undo
          // of the stroke you just drew has no server id to delete: it vanished
          // from your screen and stayed in the database and on every peer.
          const pending = undoStack.current.find((s) => s.localId === localId);
          if (pending) {
            pending.id = saved.id;
            pending.seq = saved.seq;
          }
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
      const localIds = targets.map((s) => s.localId);
      const gone = new Set(localIds);
      setStrokes((prev) => prev.filter((s) => !gone.has(s.localId)));
      send({ a: "erase", ids, localIds, itemId });
      if (ids.length) {
        try {
          await adapter.deleteStrokes(itemId, ids);
        } catch (e) {
          setError(e instanceof Error ? e.message : "failed to erase");
        }
      }
    },
    [adapter, itemId, send],
  );

  /** Stroke-level erase: cheaper than pixel erase and stays vector. */
  const eraseAt = useCallback(
    async (frame: number, x: number, y: number, radius: number) => {
      const hits = strokes.filter((s) => {
        if (s.frameIn > frame || s.frameOut < frame) return false;
        if (s.authorId !== author.id) return false; // never erase someone else's
        if (s.points.length === 2) return Math.hypot(s.points[0] - x, s.points[1] - y) <= radius;
        // Against segments, not points. `simplify` reduces a straight stroke to
        // its two endpoints, so a point test cannot touch the middle of a long
        // line — you click straight through it.
        for (let i = 0; i + 3 < s.points.length; i += 2) {
          if (distToSegment(x, y, s.points[i], s.points[i + 1], s.points[i + 2], s.points[i + 3]) <= radius) {
            return true;
          }
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
  /**
   * Ink is throttled, but the caller hands over each tail exactly once — the
   * old code *dropped* anything arriving inside the window, so the room watched
   * a line with holes in it. Buffer instead and flush on the next tick: same
   * message rate, no lost points.
   */
  const flushInk = useCallback(() => {
    if (inkTimer.current !== null) {
      clearTimeout(inkTimer.current);
      inkTimer.current = null;
    }
    const p = inkPending.current;
    inkPending.current = null;
    if (!p || p.pts.length === 0) return;
    lastInkSent.current = Date.now();
    send({
      a: "ink",
      id: p.id,
      author: author.id,
      tool: p.tool,
      color: p.color,
      width: p.width,
      pts: p.pts,
    });
  }, [send, author.id]);

  const streamInk = useCallback(
    (ink: Omit<LiveInk, "updatedAt" | "author">) => {
      // A new stroke started before the old one drained: never merge two
      // strokes' tails into one message.
      if (inkPending.current && inkPending.current.id !== ink.id) flushInk();

      const pending = inkPending.current;
      if (pending) pending.pts.push(...ink.points);
      else {
        inkPending.current = {
          id: ink.id,
          tool: ink.tool,
          color: ink.color,
          width: ink.width,
          pts: [...ink.points],
        };
      }

      const wait = INK_THROTTLE_MS - (Date.now() - lastInkSent.current);
      if (wait <= 0) flushInk();
      else if (inkTimer.current === null) inkTimer.current = setTimeout(flushInk, wait);
    },
    [flushInk],
  );

  useEffect(() => () => {
    if (inkTimer.current !== null) clearTimeout(inkTimer.current);
  }, []);

  const endInk = useCallback(
    (id: string) => {
      // Drain the tail before the terminator, or the last few points arrive
      // after the receiver has already dropped the stroke.
      flushInk();
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
    [flushInk, send, author.id],
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

  // Markers used to be their own state, maintained incrementally on the way in
  // and refetched on the way out — which meant every path that removed a stroke
  // had to remember to fix them, and the remote erase path did not. They are a
  // group-by over strokes and nothing more, so derive them and the drift is
  // structurally impossible.
  const markers = useMemo(() => markersFrom(strokes), [strokes]);

  const annotatedFrames = useMemo(
    () => [...new Set(strokes.map((s) => s.frameIn))].sort((a, b) => a - b),
    [strokes],
  );

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

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** One marker per start frame, holding to the furthest note that starts there. */
function markersFrom(strokes: Stroke[]): FrameMarker[] {
  const byFrame = new Map<number, FrameMarker>();
  for (const s of strokes) {
    const m = byFrame.get(s.frameIn);
    if (m) {
      m.count += 1;
      m.frameOut = Math.max(m.frameOut, s.frameOut);
    } else {
      byFrame.set(s.frameIn, { frameIn: s.frameIn, frameOut: s.frameOut, count: 1 });
    }
  }
  return [...byFrame.values()].sort((a, b) => a.frameIn - b.frameIn);
}
