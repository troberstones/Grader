import type { Action } from "./actions";
import { fold } from "./fold";
import type { ReviewItem, ViewerState } from "./types";

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
      const next: ViewerState = {
        ...state,
        itemIndex: item,
        frame: clamp(Math.round(action.frame), 0, n - 1),
      };
      if (item !== state.itemIndex) {
        // A new item resets framing and layer overrides, but deliberately keeps
        // colour, loop mode, fps and flips — those are review preferences the
        // user set once and expects to persist across a roster.
        next.zoom = 1;
        next.panX = 0;
        next.panY = 0;
        next.fit = "fit";
        next.layers = {};
        next.soloLayer = null;
        next.composite = true;
        const fps = ctx.items[item]?.fps;
        if (fps && fps > 0) next.fps = fps;
      }
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
      return {
        ...state,
        zoom: action.zoom !== undefined ? clamp(action.zoom, ZOOM_MIN, ZOOM_MAX) : state.zoom,
        panX: action.panX ?? state.panX,
        panY: action.panY ?? state.panY,
        fit: action.fit ?? (action.zoom !== undefined || action.panX !== undefined ? "free" : state.fit),
      };

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
  return {
    ...merged,
    itemIndex: index,
    frame: clamp(merged.frame ?? 0, 0, Math.max(0, (item?.frameCount ?? 1) - 1)),
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
