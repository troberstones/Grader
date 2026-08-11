"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Action, Envelope } from "../core/actions";
import { isBroadcast, shouldApply } from "../core/actions";
import { detectBudget, type Budget } from "../core/budget";
import { needsResync, projectFrame, type TransportSnapshot } from "../core/clock";
import { fold, step } from "../core/fold";
import { initialStateFor, reduceViewer } from "../core/reducer";
import { DEFAULT_VIEWER_STATE, type ReviewItem, type ViewerState } from "../core/types";
import { GLRenderer, type ViewParams } from "../render/gl";
import { createSource, DecodedVideoSource, VideoElementSource } from "../sources";
import type { CacheStats, FrameSource, SourceContext } from "../sources/types";
import { LayeredSource } from "../sources/layered";
import type { SessionApi } from "./useSession";

export interface ViewerApi {
  state: ViewerState;
  item: ReviewItem | null;
  items: ReviewItem[];
  source: FrameSource | null;
  stats: CacheStats | null;
  dispatch: (action: Action, opts?: { broadcast?: boolean }) => void;
  /** Frame stepping that respects loop mode. */
  stepFrame: (delta: number) => void;
  glReady: boolean;
  glError: string | null;
  viewParams: () => ViewParams;
  /** Force a redraw when something outside viewer state changed. */
  invalidate: () => void;
  fallbackNotice: string | null;
}

export interface UseViewerOptions {
  items: ReviewItem[];
  session: SessionApi;
  glCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Draws annotations, guides and live ink on top of the rendered frame. */
  drawOverlay: (params: ViewParams, frame: number) => void;
  initial?: Partial<ViewerState>;
  pdfWorkerUrl?: string;
  forcedBudget?: keyof ReturnType<typeof budgetKeys>;
  /** Frames carrying annotations, for pause-on-annotated. */
  annotatedFrames: number[];
  onFrameChange?: (frame: number) => void;
}

function budgetKeys() {
  return { workstation: 1, laptopLarge: 1, laptopSmall: 1, tablet: 1, conservative: 1 };
}

export function useViewer(opts: UseViewerOptions): ViewerApi {
  const {
    items,
    session,
    glCanvasRef,
    overlayCanvasRef,
    containerRef,
    drawOverlay,
    initial,
    pdfWorkerUrl = "/pdf.worker.min.mjs",
    annotatedFrames,
    onFrameChange,
  } = opts;

  const budget: Budget = useMemo(
    () => detectBudget(opts.forcedBudget ? { forced: opts.forcedBudget } : {}),
    [opts.forcedBudget],
  );

  const [state, setState] = useState<ViewerState>(() =>
    initialStateFor(items, initial, DEFAULT_VIEWER_STATE),
  );
  const [glReady, setGlReady] = useState(false);
  const [glError, setGlError] = useState<string | null>(null);
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  // The render loop reads the session through a ref so that role changes,
  // presence updates and peer latency never restart it. A rAF loop that is
  // cancelled and recreated on every render drops frames and resets its own
  // pacing state.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const annotatedRef = useRef(annotatedFrames);
  annotatedRef.current = annotatedFrames;
  const drawOverlayRef = useRef(drawOverlay);
  drawOverlayRef.current = drawOverlay;

  const rendererRef = useRef<GLRenderer | null>(null);
  const sourcesRef = useRef(new Map<string, FrameSource>());
  const rafRef = useRef<number | null>(null);
  const dirtyRef = useRef(true);
  const transportRef = useRef<TransportSnapshot>({
    playing: false,
    frame: state.frame,
    rate: 1,
    at: Date.now(),
  });
  const lastAnnotatedStop = useRef(-1);

  const item = items[state.itemIndex] ?? null;

  const sourceCtx: SourceContext = useMemo(
    () => ({
      maxCacheWidth: budget.maxCacheWidth,
      ramBudget: budget.ram,
      viewportWidth: containerRef.current?.clientWidth
        ? containerRef.current.clientWidth * (window.devicePixelRatio || 1)
        : 1600,
      pdfWorkerUrl,
    }),
    [budget, pdfWorkerUrl, containerRef],
  );

  const invalidate = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  // ── Source lifecycle ────────────────────────────────────────────────────────
  const getSource = useCallback(
    (target: ReviewItem): FrameSource => {
      const existing = sourcesRef.current.get(target.id);
      if (existing) return existing;

      let src = createSource(target, sourceCtx, budget);

      // A WebCodecs failure must not lose the review — fall back to <video>.
      if (src instanceof DecodedVideoSource) {
        void src.ready().catch((e) => {
          if (sourcesRef.current.get(target.id) !== src) return;
          setFallbackNotice(
            `${target.label}: frame cache unavailable (${e instanceof Error ? e.message : e}) — using video playback`,
          );
          src.dispose();
          const fb = new VideoElementSource(target);
          sourcesRef.current.set(target.id, fb);
          fb.onChange(invalidate);
          void fb.ready().catch(() => {});
          invalidate();
        });
      } else {
        void src.ready().catch(() => {});
      }

      src.onChange(invalidate);
      sourcesRef.current.set(target.id, src);
      return src;
    },
    [sourceCtx, budget, invalidate],
  );

  const source = item ? sourcesRef.current.get(item.id) ?? null : null;

  useEffect(() => {
    // An item we already know is broken gets no source — attempting to decode
    // it again would only produce a second, less informative error.
    if (!item || item.unavailable) return;
    getSource(item);
    invalidate();

    // Warm the next few items so navigation is instant — but only stills and
    // pages. Prefetching a video would start a second decoder holding its own
    // gigabyte of frames, and with prefetchItems > 1 that multiplies. Videos
    // are decoded when you actually open them.
    const ahead = budget.prefetchItems;
    for (let d = 1; d <= ahead; d++) {
      const next = itemsRef.current[state.itemIndex + d];
      if (next && next.kind !== "video") getSource(next);
    }

    // Drop sources well outside the prefetch window.
    for (const [id, src] of [...sourcesRef.current]) {
      const idx = itemsRef.current.findIndex((i) => i.id === id);
      if (idx === -1 || Math.abs(idx - state.itemIndex) > ahead + 1) {
        src.dispose();
        sourcesRef.current.delete(id);
        rendererRef.current?.purge(`frame:${id}:`);
        rendererRef.current?.purge(`layer:`);
      }
    }
  }, [item, state.itemIndex, getSource, budget.prefetchItems, invalidate]);

  useEffect(() => {
    const map = sourcesRef.current;
    return () => {
      for (const s of map.values()) s.dispose();
      map.clear();
    };
  }, []);

  // ── Renderer ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = glCanvasRef.current;
    if (!canvas) return;
    const r = new GLRenderer(canvas);
    r.vramBudget = budget.vram;
    const ok = r.init(() => {
      // Context loss is expected near the cap; rebuild rather than surrender.
      setGlError("GPU context was lost — rebuilding");
      invalidate();
      setTimeout(() => setGlError(null), 2500);
    });
    if (!ok) {
      setGlError("WebGL2 unavailable in this browser");
      return;
    }
    rendererRef.current = r;
    setGlReady(true);
    invalidate();
    return () => {
      r.dispose();
      rendererRef.current = null;
      setGlReady(false);
    };
  }, [glCanvasRef, budget.vram, invalidate]);

  // ── Transport snapshot ──────────────────────────────────────────────────────
  const resetTransport = useCallback(
    (playing: boolean, frame: number, rate: number) => {
      transportRef.current = {
        playing,
        frame,
        rate,
        at: session.clock.sharedNow(),
      };
    },
    [session.clock],
  );

  // ── Dispatch ────────────────────────────────────────────────────────────────
  const dispatch = useCallback(
    (action: Action, dispatchOpts: { broadcast?: boolean } = {}) => {
      const before = stateRef.current;
      const next = reduceViewer(before, action, { items: itemsRef.current });

      if (next !== before) {
        stateRef.current = next;
        setState(next);
        invalidate();
      }

      // Any action that changes the playhead or its motion restarts the clock
      // projection, otherwise followers extrapolate from a stale origin.
      if (
        action.a === "play" ||
        action.a === "pause" ||
        action.a === "seek" ||
        action.a === "goto" ||
        action.a === "rate" ||
        action.a === "loop" ||
        action.a === "fps"
      ) {
        resetTransport(next.playing, next.frame, next.rate);
      }
      if (action.a === "transport") {
        transportRef.current = {
          playing: action.playing,
          frame: action.frame,
          rate: action.rate,
          // A remote timestamp is only meaningful once the clocks have been
          // measured against each other. Before that, anchor to our own now:
          // the cost is one network hop of lag (milliseconds on a LAN) instead
          // of the two machines' full clock skew (potentially seconds).
          at: session.clock.synced ? action.at : session.clock.sharedNow(),
        };
      }

      const shouldSend =
        dispatchOpts.broadcast !== false &&
        isBroadcast(action.a, { isMaster: session.isMaster, followView: session.followView });

      if (shouldSend) {
        // Transport travels as a clock-anchored snapshot rather than a bare
        // frame number — that is what keeps followers smooth without
        // per-frame traffic.
        if (action.a === "play" || action.a === "pause" || action.a === "seek") {
          session.send({
            a: "transport",
            playing: next.playing,
            frame: next.frame,
            rate: next.rate,
            at: session.clock.sharedNow(),
          });
        } else {
          session.send(action);
        }
      }
    },
    [invalidate, resetTransport, session],
  );

  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  // ── Remote actions ──────────────────────────────────────────────────────────
  useEffect(() => {
    return session.subscribe((e: Envelope) => {
      const s = sessionRef.current;
      if (!shouldApply(e.a, { role: s.role, followView: s.followView })) return;
      dispatchRef.current(e as Action, { broadcast: false });
    });
    // subscribe is stable; role/followView are read live from the ref so a
    // role change does not resubscribe (and drop queued events).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.subscribe]);

  const stepFrame = useCallback(
    (delta: number) => {
      const st = stateRef.current;
      const n = itemsRef.current[st.itemIndex]?.frameCount ?? 1;
      dispatchRef.current({ a: "seek", frame: step(st.frame, delta, n, st.loop) });
    },
    [],
  );

  const viewParams = useCallback((): ViewParams => {
    const st = stateRef.current;
    const it = itemsRef.current[st.itemIndex];
    const canvas = glCanvasRef.current;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const cw = Math.max(1, Math.round((containerRef.current?.clientWidth ?? canvas?.width ?? 1) * dpr));
    const ch = Math.max(1, Math.round((containerRef.current?.clientHeight ?? canvas?.height ?? 1) * dpr));
    return {
      canvasWidth: cw,
      canvasHeight: ch,
      mediaWidth: it?.width ?? 1,
      mediaHeight: it?.height ?? 1,
      zoom: st.zoom,
      panX: st.panX * dpr,
      panY: st.panY * dpr,
      flipH: st.flipH,
      flipV: st.flipV,
      rotate: st.rotate,
      color: st.color,
    };
  }, [glCanvasRef, containerRef]);

  // ── Render loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let running = true;
    let lastStatsAt = 0;

    const loop = () => {
      if (!running) return;
      rafRef.current = requestAnimationFrame(loop);

      const st = stateRef.current;
      const it = itemsRef.current[st.itemIndex];
      const renderer = rendererRef.current;
      if (!it || !renderer || renderer.contextLost) return;

      const src = sourcesRef.current.get(it.id);
      if (!src) return;

      // ── advance the playhead ────────────────────────────────────────────────
      let frame = st.frame;
      if (st.playing) {
        if (src instanceof VideoElementSource && src.isPlayingNatively) {
          // The element owns the clock while it plays natively; seeking 24×/s
          // would thrash it.
          frame = src.currentFrame();
        } else {
          frame = projectFrame(
            transportRef.current,
            sessionRef.current.clock.sharedNow(),
            st.fps,
            it.frameCount,
            st.loop,
          );
        }

        if (st.loop === "off" && frame >= it.frameCount - 1) {
          dispatchRef.current({ a: "pause" }, { broadcast: sessionRef.current.isMaster });
          frame = it.frameCount - 1;
        }

        if (frame !== st.frame) {
          // Pause-on-annotated: a single-frame note at 24 fps is on screen for
          // 42 ms, so stopping on it is the only way to actually read it.
          if (
            st.pauseOnAnnotated &&
            frame !== lastAnnotatedStop.current &&
            annotatedRef.current.includes(frame)
          ) {
            lastAnnotatedStop.current = frame;
            dispatchRef.current({ a: "seek", frame }, { broadcast: sessionRef.current.isMaster });
            dispatchRef.current({ a: "pause" }, { broadcast: sessionRef.current.isMaster });
          } else {
            stateRef.current = { ...st, frame };
            setState(stateRef.current);
            onFrameChange?.(frame);
          }
          dirtyRef.current = true;
        }
      } else if (src instanceof VideoElementSource) {
        src.setTransport(false, st.rate, st.loop);
      }

      if (src instanceof VideoElementSource) {
        src.setTransport(st.playing, st.rate, st.loop);
        // A follower running native playback still needs correcting when it
        // drifts away from the master's projection.
        if (st.playing && !sessionRef.current.isMaster && sessionRef.current.role === "follower") {
          const target = projectFrame(
            transportRef.current,
            sessionRef.current.clock.sharedNow(),
            st.fps,
            it.frameCount,
            st.loop,
          );
          if (needsResync(src.currentFrame(), target, it.frameCount, st.loop)) {
            void src.request(target);
          }
        }
      }

      src.prefetch(frame, 30);

      // Detect a stage resize here rather than trusting the ResizeObserver
      // alone. Switching file types mounts or unmounts the layer panel, which
      // changes the stage width via a React render that the observer may not
      // report before the next tick — and the early-return below would then
      // leave a stale, mis-scaled frame stretched across the new size.
      const canvasEl = glCanvasRef.current;
      if (canvasEl) {
        const want = viewParams();
        if (canvasEl.width !== want.canvasWidth || canvasEl.height !== want.canvasHeight) {
          dirtyRef.current = true;
        }
      }

      if (!dirtyRef.current) {
        // Video elements and in-flight decodes keep the frame moving even when
        // nothing in React changed.
        const ref = src.peek(frame);
        if (!ref || ref.exact) return;
      }
      dirtyRef.current = false;

      // ── draw ────────────────────────────────────────────────────────────────
      const params = viewParams();
      renderer.beginFrame(params);

      if (src instanceof LayeredSource && !st.composite && src.manifest()) {
        const stack = src.layerStack(st.layers, st.soloLayer);
        if (stack.length) renderer.drawLayers(stack, 0);
        else {
          const ref = src.peek(0);
          if (ref) {
            renderer.draw(`frame:${it.id}:0`, ref.tex, ref.version, {
              x: 0, y: 0, w: it.width, h: it.height,
            });
          }
        }
      } else {
        // Onion skin first, so the live frame sits on top.
        if (st.onionSkin > 0 && it.frameCount > 1) {
          for (let d = st.onionSkin; d >= 1; d--) {
            for (const off of [-d, d]) {
              const f = fold(frame + off, it.frameCount, st.loop);
              if (f === frame) continue;
              const ghost = src.peek(f);
              if (!ghost?.exact) continue;
              renderer.draw(`frame:${it.id}:${ghost.frame}`, ghost.tex, ghost.version, {
                x: 0, y: 0, w: it.width, h: it.height,
              }, { opacity: 0.18 / d });
            }
          }
        }

        const ref = src.peek(frame);
        if (ref) {
          renderer.draw(`frame:${it.id}:${ref.frame}`, ref.tex, ref.version, {
            x: 0, y: 0, w: it.width, h: it.height,
          });
        }
      }

      drawOverlayRef.current(params, frame);

      const now = performance.now();
      if (now - lastStatsAt > 400) {
        lastStatsAt = now;
        setStats(src.stats());
      }
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // Deliberately not depending on `session`: it is read through
    // sessionRef so the loop is created once and runs uninterrupted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewParams, onFrameChange]);

  // Resize invalidates the fit scale.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const overlay = overlayCanvasRef.current;
      if (overlay) {
        overlay.width = Math.round(el.clientWidth * dpr);
        overlay.height = Math.round(el.clientHeight * dpr);
      }
      invalidate();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, overlayCanvasRef, invalidate]);

  return {
    state,
    item,
    items,
    source,
    stats,
    dispatch,
    stepFrame,
    glReady,
    glError,
    viewParams,
    invalidate,
    fallbackNotice,
  };
}
