import type { Action } from "./actions";
import { fold } from "./fold";
import type { ItemView, ReviewItem, ViewerState } from "./types";

export interface ReduceContext {
  items: ReviewItem[];
  /** This device's answer to "mirror the master's zoom and pan". */
  followView?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 32;

function frameCountAt(ctx: ReduceContext, index: number): number {
  return Math.max(1, ctx.items[index]?.frameCount ?? 1);
}

/** Media whose frames are moments in time, as opposed to pages or a single image. */
function isTimeBased(item: ReviewItem): boolean {
  return item.frameCount > 1 && (item.kind === "video" || item.kind === "sequence");
}

/** Same aspect ratio, to within a pixel of rounding at ingest. */
function sameShape(a: ReviewItem, b: ReviewItem): boolean {
  return Math.abs(a.width * b.height - b.width * a.height) <= Math.max(a.width, b.width);
}

/**
 * The shared playhead as of right now. It only moves when the user moved it:
 * sitting on a short clip's last frame because the playhead is past its end is
 * not a move, and must not drag the long clip back to that frame.
 */
function livePlayhead(state: ViewerState, from: ReviewItem | undefined): number {
  if (from && isTimeBased(from) && state.frame !== clamp(state.playhead, 0, from.frameCount - 1)) {
    return state.frame;
  }
  return state.playhead;
}

/**
 * The frame an item opens on if switched to right now — and so also the frame
 * a compare pane shows it at, which is what makes swapping the panes a no-op
 * for the eye.
 *
 * Time-based media share the playhead: frame 5 of one render against frame 5
 * of the next. A page number means nothing to a video and vice versa, so pages
 * and stills keep their own place and leave the playhead alone.
 */
export function resumeFrame(state: ViewerState, items: ReviewItem[], index: number): number {
  if (index === state.itemIndex) return state.frame;
  const to = items[index];
  if (!to) return 0;
  const frame = isTimeBased(to)
    ? livePlayhead(state, items[state.itemIndex])
    : state.remembered[to.id]?.frame ?? 0;
  return clamp(frame, 0, Math.max(1, to.frameCount) - 1);
}

/** A file nobody has looked at yet. */
export const FRESH_VIEW: ItemView = {
  frame: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
  fit: "fit",
  layers: {},
  soloLayer: null,
  composite: true,
};

type Framing = Pick<ItemView, "zoom" | "panX" | "panY" | "fit">;

function framed(prev: Framing, next: Partial<Framing>): Framing {
  return {
    zoom: next.zoom !== undefined ? clamp(next.zoom, ZOOM_MIN, ZOOM_MAX) : prev.zoom,
    panX: next.panX ?? prev.panX,
    panY: next.panY ?? prev.panY,
    fit: next.fit ?? (next.zoom !== undefined || next.panX !== undefined ? "free" : prev.fit),
  };
}

function viewOf(s: ViewerState): ItemView {
  return {
    frame: s.frame,
    zoom: s.zoom,
    panX: s.panX,
    panY: s.panY,
    fit: s.fit,
    layers: s.layers,
    soloLayer: s.soloLayer,
    composite: s.composite,
  };
}

/**
 * Pure viewer-state reducer. Annotation, presence and ephemeral actions fall
 * through untouched — they are handled by their own stores, because they are
 * not view state and must not force a re-render of the render loop's inputs.
 */
export function reduceViewer(
  state: ViewerState,
  action: Action,
  ctx: ReduceContext,
): ViewerState {
  switch (action.a) {
    case "goto": {
      const item = clamp(action.item, 0, Math.max(0, ctx.items.length - 1));
      const n = frameCountAt(ctx, item);
      if (item === state.itemIndex) {
        if (action.frame === undefined) return state;
        return { ...state, frame: clamp(Math.round(action.frame), 0, n - 1) };
      }

      // Switching files is how two pieces get compared, so it must be a round
      // trip: leave frame 5 zoomed into a corner, look at the other file, come
      // back to frame 5 zoomed into that corner. Colour, loop mode, fps and
      // flips were never reset — those are review preferences set once for a
      // whole roster.
      const from = ctx.items[state.itemIndex];
      const to = ctx.items[item];
      const remembered = from
        ? { ...state.remembered, [from.id]: viewOf(state) }
        : state.remembered;
      const back = to ? remembered[to.id] : undefined;

      let playhead = livePlayhead(state, from);
      let frame = resumeFrame(state, ctx.items, item);
      if (action.frame !== undefined) {
        frame = clamp(Math.round(action.frame), 0, n - 1);
        if (to && isTimeBased(to)) playhead = frame;
      }

      const next: ViewerState = {
        ...state,
        itemIndex: item,
        frame,
        playhead,
        remembered,
        // Layer ids belong to one file.
        layers: back?.layers ?? {},
        soloLayer: back?.soloLayer ?? null,
        composite: back?.composite ?? true,
      };
      if (state.linkView && from && to && sameShape(from, to)) {
        // Same shape, same framing: zoom into a detail and flip between two
        // versions of it. Zoom is relative to fit and pan is in screen pixels,
        // so this lines up at any resolution — but "100%" is only still 100%
        // when the pixel sizes match too.
        if (state.fit === "actual" && from.width !== to.width) next.fit = "free";
      } else {
        next.zoom = back?.zoom ?? 1;
        next.panX = back?.panX ?? 0;
        next.panY = back?.panY ?? 0;
        next.fit = back?.fit ?? "fit";
      }
      const fps = to?.fps;
      if (fps && fps > 0) next.fps = fps;
      return next;
    }

    case "seek": {
      const n = frameCountAt(ctx, state.itemIndex);
      return { ...state, frame: fold(Math.round(action.frame), n, state.loop) };
    }

    case "play":
      return state.playing ? state : { ...state, playing: true };

    case "pause":
      return state.playing ? { ...state, playing: false } : state;

    case "transport": {
      const n = frameCountAt(ctx, state.itemIndex);
      return {
        ...state,
        playing: action.playing,
        rate: action.rate,
        frame: fold(Math.round(action.frame), n, state.loop),
      };
    }

    case "rate":
      return { ...state, rate: clamp(action.rate, 0.1, 8) };

    case "loop":
      return { ...state, loop: action.mode };

    case "fps":
      return { ...state, fps: clamp(action.fps, 1, 120) };

    case "flip":
      return {
        ...state,
        flipH: action.h ?? state.flipH,
        flipV: action.v ?? state.flipV,
      };

    case "rotate":
      return { ...state, rotate: action.deg };

    case "view":
      return { ...state, ...framed(state, action) };

    case "viewOf": {
      const prev = state.remembered[action.item] ?? FRESH_VIEW;
      return {
        ...state,
        remembered: { ...state.remembered, [action.item]: { ...prev, ...framed(prev, action) } },
      };
    }

    case "color":
      return { ...state, color: { ...state.color, ...action.patch } };

    case "guides":
      return { ...state, guides: action.mode };

    case "layers": {
      const next = { ...state };
      if (action.visible) next.layers = { ...state.layers, ...action.visible };
      if (action.solo !== undefined) next.soloLayer = action.solo;
      if (action.composite !== undefined) next.composite = action.composite;
      // Touching layer visibility implies you want to see the layer stack, not
      // the flattened composite — otherwise the toggles appear to do nothing.
      if (action.visible || action.solo !== undefined) next.composite = false;
      return next;
    }

    case "opts":
      return { ...state, ...action.patch };

    case "sync": {
      const s = action.s;
      const item = clamp(s.itemIndex, 0, Math.max(0, ctx.items.length - 1));
      const next: ViewerState = {
        ...state,
        itemIndex: item,
        frame: item === state.itemIndex ? state.frame : clamp(state.frame, 0, frameCountAt(ctx, item) - 1),
        flipH: s.flipH,
        flipV: s.flipV,
        rotate: s.rotate,
        color: s.color,
        guides: s.guides,
        layers: s.layers,
        soloLayer: s.soloLayer,
        composite: s.composite,
        // The playhead is deliberately absent: it is clock-projected, and a
        // snapshot arriving 5 s late would drag a follower backwards.
        ...(ctx.followView
          ? { zoom: s.zoom, panX: s.panX, panY: s.panY, fit: s.fit }
          : null),
      };
      // A heartbeat that always returned a new object would redraw and
      // re-render every peer on every beat, forever.
      return sameViewerState(state, next) ? state : next;
    }

    default:
      return state;
  }
}

/** Convenience for the initial state of a freshly opened item. */
export function initialStateFor(
  items: ReviewItem[],
  partial?: Partial<ViewerState>,
  base?: ViewerState,
): ViewerState {
  const fallback = base ?? ({} as ViewerState);
  const merged = { ...fallback, ...partial } as ViewerState;
  const index = clamp(merged.itemIndex ?? 0, 0, Math.max(0, items.length - 1));
  const item = items[index];
  const frame = clamp(merged.frame ?? 0, 0, Math.max(0, (item?.frameCount ?? 1) - 1));
  return {
    ...merged,
    itemIndex: index,
    frame,
    // A restored view carries its own: the shared playhead may sit past the
    // end of the clip it was left on.
    playhead: partial?.playhead ?? frame,
    fps: item?.fps && item.fps > 0 ? item.fps : merged.fps,
  };
}

/** Shallow, with the two nested objects compared field-wise. */
function sameViewerState(a: ViewerState, b: ViewerState): boolean {
  for (const k of Object.keys(b) as (keyof ViewerState)[]) {
    if (k === "color") {
      const x = a.color;
      const y = b.color;
      if (
        x.transform !== y.transform ||
        x.exposure !== y.exposure ||
        x.saturation !== y.saturation ||
        x.blur !== y.blur ||
        x.channel !== y.channel ||
        x.lut !== y.lut
      ) {
        return false;
      }
      continue;
    }
    if (k === "layers") {
      const x = a.layers;
      const y = b.layers;
      const xs = Object.keys(x);
      const ys = Object.keys(y);
      if (xs.length !== ys.length || ys.some((id) => x[id] !== y[id])) return false;
      continue;
    }
    if (a[k] !== b[k]) return false;
  }
  return true;
}
